const DJSession = require('../models/DJSession');
const Mixtape   = require('../models/Mixtape');
const { getIO, emitNotification } = require('../services/socketService');

// GET /api/dj/active — the current live session for this estate (if any)
exports.getActive = async (req, res) => {
  try {
    const session = await DJSession.findOne({ estateId: req.estateId, isLive: true })
      .lean();
    return res.json({ success: true, data: session || null });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const VALID_KINDS = ['dj', 'announcement', 'prayer', 'chat', 'podcast'];

// POST /api/dj/start — any resident can start a live room. Announcements are
// restricted to estate_manager / super_admin.
exports.start = async (req, res) => {
  try {
    const { title, nowPlaying, kind, message } = req.body;
    let sessionKind = VALID_KINDS.includes(kind) ? kind : 'dj';
    const isStaff = ['estate_manager', 'super_admin'].includes(req.user.role);
    if (sessionKind === 'announcement' && !isStaff) {
      return res.status(403).json({ success: false, message: 'Only estate managers can broadcast announcements' });
    }

    // End any orphaned session the SAME HOST had running
    await DJSession.updateMany(
      { estateId: req.estateId, hostUserId: req.user._id, isLive: true },
      { isLive: false, endedAt: new Date() },
    );

    // If an announcement is starting, pre-empt any active DJ/prayer/chat room
    // (announcements take priority). Resident rooms can coexist.
    if (sessionKind === 'announcement') {
      await DJSession.updateMany(
        { estateId: req.estateId, isLive: true },
        { isLive: false, endedAt: new Date() },
      );
    }

    const session = await DJSession.create({
      estateId:   req.estateId,
      hostUserId: req.user._id,
      hostName:   req.user.name,
      hostPhoto:  req.user.profilePhoto || '',
      title:      title?.trim() || (sessionKind === 'announcement' ? `Announcement from ${req.user.name}` : `${req.user.name}'s Live Set`),
      kind:       sessionKind,
      message:    (message || '').trim(),
      // Announcements may optionally carry a background track; keep nowPlaying for all kinds
      nowPlaying: nowPlaying && nowPlaying.videoId ? nowPlaying : {},
      startedAt:  new Date(),
      isLive:     true,
    });

    const io = getIO();
    if (io) {
      io.to(`estate:${req.estateId}`).emit('dj:started', {
        sessionId: session._id,
        hostName:  session.hostName,
        hostPhoto: session.hostPhoto,
        title:     session.title,
        kind:      session.kind,
        message:   session.message,
        nowPlaying: session.nowPlaying,
        startedAt: session.startedAt,
      });
    }

    // Fire a notification so residents on any page get a toast + bell
    const notifTitles = {
      announcement: '📢 Announcement — tap to listen',
      prayer:       '🙏 Prayer room is live — join',
      chat:         '💬 Live chat room — join in',
      podcast:      '🎧 New podcast live — tap to listen',
      dj:           '🎙️ LIVE in the Lounge — tap to tune in',
    };
    const notifBodies = {
      announcement: `${req.user.name}: ${session.message || session.title}`,
      prayer:       `${req.user.name} just started a prayer session`,
      chat:         `${req.user.name} just opened a chat room`,
      podcast:      `${req.user.name} is live: "${session.title}"`,
      dj:           `${req.user.name} is DJing in the Lounge right now`,
    };
    emitNotification(req.estateId, {
      id:    `dj:${session._id}`,
      type:  sessionKind === 'announcement' ? 'live_announcement' : 'live_dj',
      title: notifTitles[sessionKind] || notifTitles.dj,
      body:  notifBodies[sessionKind] || notifBodies.dj,
      meta:  {
        kind: 'dj_session',
        sessionId: session._id.toString(),
        sessionKind,
        hostUserId: session.hostUserId.toString(),  // frontend uses this to suppress for the host
      },
    });

    return res.status(201).json({ success: true, data: session });
  } catch (err) {
    console.error('[dj.start]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PATCH /api/dj/:id/track — change the now-playing track
exports.updateTrack = async (req, res) => {
  try {
    const { videoId, title, artist, seekSec } = req.body;
    const session = await DJSession.findOne({
      _id: req.params.id, estateId: req.estateId, isLive: true,
    });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (String(session.hostUserId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Only the host can change the track' });
    }

    session.nowPlaying = { videoId, title, artist, startedAt: new Date(), seekSec: seekSec || 0 };
    await session.save();

    const io = getIO();
    if (io) {
      io.to(`estate:${req.estateId}`).emit('dj:track-change', {
        sessionId: session._id,
        nowPlaying: session.nowPlaying,
      });
    }

    return res.json({ success: true, data: session });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/dj/:id/end — end the live set
exports.end = async (req, res) => {
  try {
    const session = await DJSession.findOne({
      _id: req.params.id, estateId: req.estateId, isLive: true,
    });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (String(session.hostUserId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Only the host can end the session' });
    }

    session.isLive = false;
    session.endedAt = new Date();
    await session.save();

    const io = getIO();
    if (io) {
      io.to(`estate:${req.estateId}`).emit('dj:ended', { sessionId: session._id });
    }

    return res.json({ success: true, data: session });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Mixtapes ─────────────────────────────────────────────────────────────────

// GET /api/dj/mixtapes — list for this estate
exports.listMixtapes = async (req, res) => {
  try {
    const items = await Mixtape.find({ estateId: req.estateId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return res.json({ success: true, data: items });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/dj/mixtapes — save a mixtape from a finished session
// body: { sessionId, title, description, coverImage, voiceAudioUrl, voiceDurationSec, setlist, totalDurationSec, peakListeners }
exports.saveMixtape = async (req, res) => {
  try {
    const { sessionId, title, description, coverImage, voiceAudioUrl, voiceDurationSec, setlist, totalDurationSec, peakListeners } = req.body;
    if (!title?.trim()) return res.status(400).json({ success: false, message: 'Title required' });

    let session = null;
    if (sessionId) {
      session = await DJSession.findOne({ _id: sessionId, estateId: req.estateId });
      if (session && String(session.hostUserId) !== String(req.user._id)) {
        return res.status(403).json({ success: false, message: 'Only the host can save this mixtape' });
      }
    }

    const mixtape = await Mixtape.create({
      estateId:         req.estateId,
      sessionId:        session?._id,
      hostUserId:       req.user._id,
      hostName:         req.user.name,
      hostPhoto:        req.user.profilePhoto || '',
      title:            title.trim(),
      description:      description?.trim() || '',
      coverImage:       coverImage || '',
      voiceAudioUrl:    voiceAudioUrl || '',
      voiceDurationSec: Number(voiceDurationSec) || 0,
      setlist:          Array.isArray(setlist) ? setlist : [],
      totalDurationSec: Number(totalDurationSec) || 0,
      peakListeners:    Number(peakListeners) || (session?.peakListeners || 0),
    });

    const io = getIO();
    if (io) {
      io.to(`estate:${req.estateId}`).emit('dj:mixtape-saved', {
        mixtapeId: mixtape._id,
        title: mixtape.title,
        hostName: mixtape.hostName,
      });
    }

    return res.status(201).json({ success: true, data: mixtape });
  } catch (err) {
    console.error('[dj.saveMixtape]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/dj/mixtapes/:id/play — increment play count
exports.recordPlay = async (req, res) => {
  try {
    await Mixtape.updateOne({ _id: req.params.id, estateId: req.estateId }, { $inc: { playCount: 1 } });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// DELETE /api/dj/mixtapes/:id — host or manager deletes a mixtape
exports.deleteMixtape = async (req, res) => {
  try {
    const mix = await Mixtape.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!mix) return res.status(404).json({ success: false, message: 'Mixtape not found' });
    const isHost = String(mix.hostUserId) === String(req.user._id);
    const isManager = ['estate_manager', 'super_admin'].includes(req.user.role);
    if (!isHost && !isManager) return res.status(403).json({ success: false, message: 'Not allowed' });
    await mix.deleteOne();
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
