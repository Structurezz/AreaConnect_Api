const PodcastShow    = require('../models/PodcastShow');
const PodcastEpisode = require('../models/PodcastEpisode');
const { getIO, emitGlobalNotification } = require('../services/socketService');

// ── Admin side ───────────────────────────────────────────────────────────────

// GET /api/podcast/shows — list all (admin)
exports.listShows = async (req, res) => {
  try {
    const shows = await PodcastShow.find()
      .sort({ scheduledAt: -1, createdAt: -1 })
      .limit(200)
      .lean();
    return res.json({ success: true, data: shows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/podcast/shows/:id — detail
exports.getShow = async (req, res) => {
  try {
    const show = await PodcastShow.findById(req.params.id).lean();
    if (!show) return res.status(404).json({ success: false, message: 'Show not found' });
    return res.json({ success: true, data: show });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/podcast/shows — create (schedule or now)
exports.createShow = async (req, res) => {
  try {
    const { title, description, coverImage, scheduledAt, isRecurring, recurrence } = req.body;
    if (!title?.trim()) return res.status(400).json({ success: false, message: 'Title required' });

    const show = await PodcastShow.create({
      hostUserId:  req.user._id,
      hostName:    req.user.name || 'AreaConnect FM',
      title:       title.trim(),
      description: description?.trim() || '',
      coverImage:  coverImage || '',
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      isRecurring: !!isRecurring,
      recurrence:  recurrence || '',
      status:      'scheduled',
    });

    return res.status(201).json({ success: true, data: show });
  } catch (err) {
    console.error('[podcast.createShow]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PATCH /api/podcast/shows/:id — edit metadata (not when live)
exports.updateShow = async (req, res) => {
  try {
    const show = await PodcastShow.findById(req.params.id);
    if (!show) return res.status(404).json({ success: false, message: 'Show not found' });
    if (show.status === 'live') return res.status(400).json({ success: false, message: 'Cannot edit while live' });
    ['title','description','coverImage','scheduledAt','isRecurring','recurrence'].forEach(k => {
      if (req.body[k] !== undefined) show[k] = req.body[k];
    });
    await show.save();
    return res.json({ success: true, data: show });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/podcast/shows/:id/go-live
exports.goLive = async (req, res) => {
  try {
    // End any other live show first
    await PodcastShow.updateMany({ status: 'live' }, { status: 'ended', endedAt: new Date() });

    const show = await PodcastShow.findById(req.params.id);
    if (!show) return res.status(404).json({ success: false, message: 'Show not found' });

    show.status = 'live';
    show.startedAt = new Date();
    show.peakListeners = 0;
    await show.save();

    const io = getIO();
    if (io) {
      // Broadcast to all connected clients across all estates
      io.emit('podcast:started', {
        showId:    show._id,
        title:     show.title,
        hostName:  show.hostName,
        coverImage:show.coverImage,
        startedAt: show.startedAt,
      });
    }

    // Fire a platform-wide notification so every user gets a toast + bell
    emitGlobalNotification({
      id:    `podcast:${show._id}`,
      type:  'live_podcast',
      title: '📻 AreaConnect FM is LIVE — tap to tune in',
      body:  `${show.hostName} just started "${show.title}"`,
      meta:  {
        kind: 'podcast_show',
        showId: show._id.toString(),
        hostUserId: show.hostUserId.toString(),  // frontend suppresses for the host
      },
    });

    return res.json({ success: true, data: show });
  } catch (err) {
    console.error('[podcast.goLive]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/podcast/shows/:id/end  — stop live and optionally archive
// body: { audioUrl, durationSec, guestNames }
exports.endLive = async (req, res) => {
  try {
    const { audioUrl, durationSec, guestNames } = req.body;

    const show = await PodcastShow.findById(req.params.id);
    if (!show) return res.status(404).json({ success: false, message: 'Show not found' });

    show.status = 'ended';
    show.endedAt = new Date();

    let episode = null;
    if (audioUrl) {
      episode = await PodcastEpisode.create({
        showId:      show._id,
        hostUserId:  show.hostUserId,
        hostName:    show.hostName,
        title:       show.title,
        description: show.description,
        coverImage:  show.coverImage,
        audioUrl,
        durationSec: Number(durationSec) || 0,
        guestNames:  Array.isArray(guestNames) ? guestNames : show.guests.filter(g => g.status === 'joined').map(g => g.name),
        peakListeners: show.peakListeners,
        publishedAt: new Date(),
      });
      show.episodeId = episode._id;
    }
    await show.save();

    const io = getIO();
    if (io) io.emit('podcast:ended', { showId: show._id, episodeId: episode?._id || null });

    return res.json({ success: true, data: { show, episode } });
  } catch (err) {
    console.error('[podcast.endLive]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/podcast/shows/:id/invite — admin invites a guest
exports.inviteGuest = async (req, res) => {
  try {
    const { name, estate, phone, email } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, message: 'Guest name required' });

    const show = await PodcastShow.findById(req.params.id);
    if (!show) return res.status(404).json({ success: false, message: 'Show not found' });

    show.guests.push({ name: name.trim(), estate: estate || '', phone: phone || '', email: email || '' });
    await show.save();

    const invite = show.guests[show.guests.length - 1];
    return res.status(201).json({ success: true, data: invite });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/podcast/shows/:id/invites/:inviteId/revoke
exports.revokeInvite = async (req, res) => {
  try {
    const show = await PodcastShow.findById(req.params.id);
    if (!show) return res.status(404).json({ success: false, message: 'Show not found' });
    const invite = show.guests.id(req.params.inviteId);
    if (!invite) return res.status(404).json({ success: false, message: 'Invite not found' });
    invite.status = 'revoked';
    await show.save();
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Public / listener side ───────────────────────────────────────────────────

// GET /api/podcast/live — currently live show, if any (public)
exports.getLive = async (req, res) => {
  try {
    const show = await PodcastShow.findOne({ status: 'live' })
      .select('title hostName coverImage startedAt peakListeners description')
      .lean();
    return res.json({ success: true, data: show || null });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/podcast/upcoming — next scheduled shows (public)
exports.getUpcoming = async (req, res) => {
  try {
    const shows = await PodcastShow.find({ status: 'scheduled', scheduledAt: { $gte: new Date() } })
      .sort({ scheduledAt: 1 })
      .limit(10)
      .select('title hostName coverImage scheduledAt description isRecurring recurrence')
      .lean();
    return res.json({ success: true, data: shows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/podcast/episodes — archived episodes (public)
exports.listEpisodes = async (req, res) => {
  try {
    const items = await PodcastEpisode.find()
      .sort({ publishedAt: -1 })
      .limit(50)
      .lean();
    return res.json({ success: true, data: items });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/podcast/episodes/:id/play
exports.recordEpisodePlay = async (req, res) => {
  try {
    await PodcastEpisode.updateOne({ _id: req.params.id }, { $inc: { playCount: 1 } });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Guest join (public, token-based) ─────────────────────────────────────────

// GET /api/podcast/guest/:token — resolve invite token to show info
exports.resolveGuest = async (req, res) => {
  try {
    const show = await PodcastShow.findOne({ 'guests.inviteToken': req.params.token })
      .select('title hostName coverImage status scheduledAt startedAt guests')
      .lean();
    if (!show) return res.status(404).json({ success: false, message: 'Invite not found' });
    const invite = (show.guests || []).find(g => g.inviteToken === req.params.token);
    if (!invite || invite.status === 'revoked') return res.status(403).json({ success: false, message: 'Invite revoked' });
    return res.json({ success: true, data: {
      showId:   show._id,
      title:    show.title,
      hostName: show.hostName,
      coverImage: show.coverImage,
      status:   show.status,
      scheduledAt: show.scheduledAt,
      startedAt:   show.startedAt,
      guest: { id: invite._id, name: invite.name, estate: invite.estate, status: invite.status },
    }});
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/podcast/guest/:token/join — mark joined
exports.guestJoined = async (req, res) => {
  try {
    const show = await PodcastShow.findOne({ 'guests.inviteToken': req.params.token });
    if (!show) return res.status(404).json({ success: false, message: 'Invite not found' });
    const invite = show.guests.find(g => g.inviteToken === req.params.token);
    if (!invite || invite.status === 'revoked') return res.status(403).json({ success: false, message: 'Invite revoked' });
    invite.status = 'joined';
    invite.joinedAt = new Date();
    await show.save();
    const io = getIO();
    if (io) io.emit('podcast:guest-joined', { showId: show._id, guestId: invite._id, name: invite.name });
    return res.json({ success: true, data: { guestId: invite._id, showId: show._id } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
