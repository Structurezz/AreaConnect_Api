const PodcastShow    = require('../models/PodcastShow');
const PodcastEpisode = require('../models/PodcastEpisode');
const { getIO, emitGlobalNotification, emitNotification, cleanupPodcastShow } = require('../services/socketService');

// Fields the admin hub can set on a show
const SHOW_FIELDS = ['title', 'description', 'coverImage', 'scheduledAt', 'isRecurring', 'recurrence', 'category', 'tags', 'language',
  'seriesName', 'episodeNumber', 'durationMins', 'audience', 'segments', 'notes'];
const RESIDENTS_URL = () => process.env.RESIDENTS_URL || 'https://area-mates.areaconnect.pro';
const guestLink = (token) => `${RESIDENTS_URL()}/live-guest/${token}`;
// Listeners only see shows/episodes meant for everyone or for their estate
const audienceFilter = (user) => {
  const estateId = user?.estateId?._id || user?.estateId;
  if (user?.role === 'super_admin') return {};
  return { $or: [{ 'audience.scope': { $ne: 'estates' } }, ...(estateId ? [{ 'audience.estateIds': estateId }] : [])] };
};

// Send a notification to the show's audience — everyone, or only chosen estates
function notifyAudience(show, notification) {
  if (show.audience?.scope === 'estates' && show.audience.estateIds?.length) {
    show.audience.estateIds.forEach((id) => emitNotification(String(id), notification));
  } else {
    emitGlobalNotification(notification);
  }
}

// ── Admin side ───────────────────────────────────────────────────────────────

// GET /api/podcast/shows — list all (admin)
exports.listShows = async (req, res) => {
  try {
    const q = {};
    if (req.query.status) q.status = req.query.status;
    if (req.query.category) q.category = req.query.category;
    if (req.query.search) q.$or = [{ title: { $regex: req.query.search, $options: 'i' } }, { seriesName: { $regex: req.query.search, $options: 'i' } }];
    const shows = await PodcastShow.find(q)
      .sort({ scheduledAt: -1, createdAt: -1 })
      .limit(300)
      .populate('audience.estateIds', 'name estateCode')
      .lean();
    return res.json({ success: true, data: shows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/podcast/shows/:id — detail
exports.getShow = async (req, res) => {
  try {
    const show = await PodcastShow.findById(req.params.id).populate('audience.estateIds', 'name estateCode').lean();
    if (!show) return res.status(404).json({ success: false, message: 'Show not found' });
    show.guests = (show.guests || []).map((g) => ({ ...g, link: guestLink(g.inviteToken) }));
    const episode = show.episodeId ? await PodcastEpisode.findById(show.episodeId).lean() : null;
    return res.json({ success: true, data: { ...show, episode } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/podcast/shows — create (schedule or now)
exports.createShow = async (req, res) => {
  try {
    const { title } = req.body;
    if (!title?.trim()) return res.status(400).json({ success: false, message: 'Title required' });

    const doc = { hostUserId: req.user._id, hostName: req.body.hostName?.trim() || req.user.name || 'AreaConnect FM', status: 'scheduled' };
    SHOW_FIELDS.forEach((k) => { if (req.body[k] !== undefined) doc[k] = req.body[k]; });
    doc.title = title.trim();
    doc.scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null;
    const show = await PodcastShow.create(doc);

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
    SHOW_FIELDS.concat(['hostName']).forEach(k => {
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
    notifyAudience(show, {
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
        category:    show.category,
        tags:        show.tags,
        seriesName:  show.seriesName,
        episodeNumber: show.episodeNumber,
        audience:    show.audience,
      });
      show.episodeId = episode._id;
    }
    await show.save();

    const io = getIO();
    if (io) io.emit('podcast:ended', { showId: show._id, episodeId: episode?._id || null });
    cleanupPodcastShow(show._id);

    return res.json({ success: true, data: { show, episode } });
  } catch (err) {
    console.error('[podcast.endLive]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/podcast/shows/:id/invite — admin invites a guest
exports.inviteGuest = async (req, res) => {
  try {
    const { name, estate, phone, email, userId, role, title, topic, sendEmail } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, message: 'Guest name required' });

    const show = await PodcastShow.findById(req.params.id);
    if (!show) return res.status(404).json({ success: false, message: 'Show not found' });

    show.guests.push({
      name: name.trim(), estate: estate || '', phone: phone || '', email: (email || '').trim(),
      userId: userId || null, role: role || 'guest', title: title || '', topic: topic || '',
    });
    const invite = show.guests[show.guests.length - 1];

    let emailed = false;
    if (sendEmail !== false && invite.email) {
      try {
        await require('../services/emailService').sendPodcastInviteEmail({
          to: invite.email, name: invite.name, role: invite.role, showTitle: show.title, hostName: show.hostName, topic: invite.topic,
          when: show.scheduledAt ? new Date(show.scheduledAt).toLocaleString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : '',
          link: guestLink(invite.inviteToken),
        });
        invite.emailedAt = new Date(); invite.emailCount = 1; emailed = true;
      } catch (e) { console.error('[podcast invite email]', e.message); }
    }
    await show.save();
    return res.status(201).json({ success: true, data: { ...invite.toObject(), link: guestLink(invite.inviteToken), emailed } });
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
      // hostUserId lets authenticated clients (admin) decide whether to
      // auto-open LiveStudio for the current user as host.
      .select('title hostName hostUserId coverImage startedAt peakListeners description nowPlaying musicVolume')
      .lean();
    return res.json({ success: true, data: show || null });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/podcast/upcoming — next scheduled shows (public)
exports.getUpcoming = async (req, res) => {
  try {
    const shows = await PodcastShow.find({ status: 'scheduled', scheduledAt: { $gte: new Date() }, ...audienceFilter(req.user) })
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
    const items = await PodcastEpisode.find({ isPublished: { $ne: false }, ...audienceFilter(req.user) })
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
      .select('title hostName coverImage status scheduledAt startedAt guests description category durationMins segments seriesName episodeNumber')
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
      description: show.description || '',
      category:    show.category || 'community',
      durationMins: show.durationMins || 45,
      seriesName:  show.seriesName || '',
      episodeNumber: show.episodeNumber || 0,
      segments:    (show.segments || []).map(({ title, minutes, speaker, notes }) => ({ title, minutes, speaker, notes })),
      guest: { id: invite._id, name: invite.name, estate: invite.estate, status: invite.status, role: invite.role || 'guest', title: invite.title || '', topic: invite.topic || '' },
      // Other speakers — names and roles only (this endpoint is public)
      speakers: (show.guests || []).filter((g) => g.status !== 'revoked' && g.inviteToken !== req.params.token)
        .map((g) => ({ name: g.name, role: g.role || 'guest', title: g.title || '', estate: g.estate || '', joined: g.status === 'joined' })),
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
