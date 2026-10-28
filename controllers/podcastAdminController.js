const mongoose = require('mongoose');
const PodcastShow = require('../models/PodcastShow');
const PodcastEpisode = require('../models/PodcastEpisode');
const User = require('../models/User');
const Estate = require('../models/Estate');
const { emitGlobalNotification, emitNotification } = require('../services/socketService');

const RESIDENTS_URL = () => process.env.RESIDENTS_URL || 'https://area-mates.areaconnect.pro';
const guestLink = (token) => `${RESIDENTS_URL()}/live-guest/${token}`;
const fail = (res, err, code = 500, msg = 'Server error') => { if (code === 500) console.error('[podcast admin]', err); return res.status(code).json({ success: false, message: msg }); };

// GET /api/podcast/admin/stats — overview numbers for the hub
exports.stats = async (req, res) => {
  try {
    const now = new Date();
    const monthAgo = new Date(now - 30 * 86400000);
    const [shows, episodes, playsAgg, live, upcoming, byCategory, topEpisodes, guestsAgg, recentEnded] = await Promise.all([
      PodcastShow.countDocuments(),
      PodcastEpisode.countDocuments(),
      PodcastEpisode.aggregate([{ $group: { _id: null, plays: { $sum: '$playCount' }, peak: { $max: '$peakListeners' }, avgPeak: { $avg: '$peakListeners' }, secs: { $sum: '$durationSec' } } }]),
      PodcastShow.findOne({ status: 'live' }).select('title hostName startedAt peakListeners coverImage').lean(),
      PodcastShow.find({ status: 'scheduled' }).select('title scheduledAt category guests seriesName coverImage audience createdAt').lean(),
      PodcastEpisode.aggregate([{ $group: { _id: '$category', n: { $sum: 1 }, plays: { $sum: '$playCount' } } }]),
      PodcastEpisode.find({ isPublished: { $ne: false } }).sort({ playCount: -1 }).limit(5).select('title playCount peakListeners publishedAt durationSec coverImage category').lean(),
      PodcastShow.aggregate([{ $unwind: '$guests' }, { $group: { _id: '$guests.status', n: { $sum: 1 } } }]),
      PodcastShow.countDocuments({ status: 'ended', endedAt: { $gte: monthAgo } }),
    ]);
    const p = playsAgg[0] || {};
    // Every show still waiting to air: dated ones by time (overdue first), undated ones last
    upcoming.sort((a, b) => (a.scheduledAt ? new Date(a.scheduledAt) : 8.64e15) - (b.scheduledAt ? new Date(b.scheduledAt) : 8.64e15) || new Date(b.createdAt) - new Date(a.createdAt));
    upcoming.forEach((x) => { x.overdue = !!(x.scheduledAt && new Date(x.scheduledAt) < now); });
    upcoming.splice(8);
    return res.json({
      success: true,
      data: {
        shows, episodes, plays: p.plays || 0, peakEver: p.peak || 0, avgPeak: Math.round(p.avgPeak || 0), hoursAired: Math.round((p.secs || 0) / 360) / 10,
        live, upcoming, showsLast30: recentEnded,
        byCategory: byCategory.map((c) => ({ category: c._id || 'community', episodes: c.n, plays: c.plays })),
        topEpisodes,
        guests: Object.fromEntries(guestsAgg.map((g) => [g._id, g.n])),
      },
    });
  } catch (err) { return fail(res, err); }
};

// GET /api/podcast/admin/people?q= — find estate leaders / residents to invite
exports.people = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const filter = { role: { $in: ['estate_manager', 'resident'] }, isActive: { $ne: false } };
    if (q) filter.$or = [{ name: { $regex: q, $options: 'i' } }, { email: { $regex: q, $options: 'i' } }];
    if (req.query.role) filter.role = req.query.role;
    const users = await User.find(filter).select('name email phone role profilePhoto estateId teamRole')
      .populate('estateId', 'name').sort({ role: 1, name: 1 }).limit(40).lean();
    return res.json({ success: true, data: users.map((u) => ({ _id: u._id, name: u.name, email: u.email, phone: u.phone, role: u.role, photo: u.profilePhoto, estate: u.estateId?.name || '' })) });
  } catch (err) { return fail(res, err); }
};

// GET /api/podcast/admin/estates — light list for audience targeting
exports.estates = async (req, res) => {
  try {
    const estates = await Estate.find({ isActive: { $ne: false } }).select('name estateCode city state').sort({ name: 1 }).lean();
    return res.json({ success: true, data: estates });
  } catch (err) { return fail(res, err); }
};

// GET /api/podcast/admin/guests — every invite across every show
exports.guests = async (req, res) => {
  try {
    const shows = await PodcastShow.find({ 'guests.0': { $exists: true } }).select('title scheduledAt status guests').sort({ scheduledAt: -1, createdAt: -1 }).limit(200).lean();
    const rows = [];
    shows.forEach((s) => (s.guests || []).forEach((g) => rows.push({
      ...g, link: guestLink(g.inviteToken), show: { _id: s._id, title: s.title, scheduledAt: s.scheduledAt, status: s.status },
    })));
    return res.json({ success: true, data: rows });
  } catch (err) { return fail(res, err); }
};

// POST /api/podcast/shows/:id/invites/:inviteId/resend — email the invite again
exports.resendInvite = async (req, res) => {
  try {
    const show = await PodcastShow.findById(req.params.id);
    if (!show) return fail(res, null, 404, 'Show not found');
    const invite = show.guests.id(req.params.inviteId);
    if (!invite) return fail(res, null, 404, 'Invite not found');
    if (!invite.email) return fail(res, null, 400, 'This guest has no email — share the link instead');
    if (invite.status === 'revoked') invite.status = 'pending';
    await require('../services/emailService').sendPodcastInviteEmail({
      to: invite.email, name: invite.name, role: invite.role, showTitle: show.title, hostName: show.hostName, topic: invite.topic,
      when: show.scheduledAt ? new Date(show.scheduledAt).toLocaleString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : '',
      link: guestLink(invite.inviteToken),
    });
    invite.emailedAt = new Date(); invite.emailCount = (invite.emailCount || 0) + 1;
    await show.save();
    return res.json({ success: true, data: invite });
  } catch (err) { return fail(res, err); }
};

// POST /api/podcast/shows/:id/remind — tell the audience the show is coming up
exports.remind = async (req, res) => {
  try {
    const show = await PodcastShow.findById(req.params.id);
    if (!show) return fail(res, null, 404, 'Show not found');
    if (show.status !== 'scheduled') return fail(res, null, 400, 'Only upcoming shows can send reminders');
    const when = show.scheduledAt ? new Date(show.scheduledAt).toLocaleString('en-NG', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : 'soon';
    const note = {
      id: `podcast-reminder:${show._id}:${Date.now()}`, type: 'podcast_reminder',
      title: `🎙 Coming up on AreaConnect FM — ${show.title}`,
      body: String(req.body?.message || `${show.hostName} goes live ${when}. Don't miss it!`).slice(0, 240),
      meta: { kind: 'podcast_show', showId: String(show._id) },
    };
    if (show.audience?.scope === 'estates' && show.audience.estateIds?.length) show.audience.estateIds.forEach((id) => emitNotification(String(id), note));
    else emitGlobalNotification(note);
    show.remindedAt = new Date(); show.remindCount = (show.remindCount || 0) + 1;
    await show.save();
    return res.json({ success: true, data: { remindedAt: show.remindedAt, remindCount: show.remindCount } });
  } catch (err) { return fail(res, err); }
};

// POST /api/podcast/shows/:id/duplicate — copy a show (next episode of a series)
exports.duplicate = async (req, res) => {
  try {
    const src = await PodcastShow.findById(req.params.id).lean();
    if (!src) return fail(res, null, 404, 'Show not found');
    const next = src.scheduledAt && src.isRecurring ? new Date(new Date(src.scheduledAt).getTime() + 7 * 86400000) : null;
    const copy = await PodcastShow.create({
      hostUserId: req.user._id, hostName: src.hostName, title: src.title, description: src.description, coverImage: src.coverImage,
      scheduledAt: next, isRecurring: src.isRecurring, recurrence: src.recurrence, category: src.category, tags: src.tags,
      language: src.language, seriesName: src.seriesName, episodeNumber: (src.episodeNumber || 0) + (src.seriesName ? 1 : 0),
      durationMins: src.durationMins, audience: src.audience, segments: (src.segments || []).map(({ _id, ...x }) => x), notes: src.notes,
      status: 'scheduled',
    });
    return res.status(201).json({ success: true, data: copy });
  } catch (err) { return fail(res, err); }
};

// DELETE /api/podcast/shows/:id — remove a show that isn't live
exports.removeShow = async (req, res) => {
  try {
    const show = await PodcastShow.findById(req.params.id);
    if (!show) return fail(res, null, 404, 'Show not found');
    if (show.status === 'live') return fail(res, null, 400, 'End the show before deleting it');
    await show.deleteOne();
    return res.json({ success: true });
  } catch (err) { return fail(res, err); }
};

// GET /api/podcast/admin/episodes — full library incl. unpublished
exports.listEpisodes = async (req, res) => {
  try {
    const q = {};
    if (req.query.search) q.title = { $regex: req.query.search, $options: 'i' };
    if (req.query.category) q.category = req.query.category;
    if (req.query.published === 'true') q.isPublished = { $ne: false };
    if (req.query.published === 'false') q.isPublished = false;
    const items = await PodcastEpisode.find(q).sort({ publishedAt: -1 }).limit(300).populate('audience.estateIds', 'name').lean();
    return res.json({ success: true, data: items });
  } catch (err) { return fail(res, err); }
};

// POST /api/podcast/admin/episodes — publish a pre-recorded episode (audio uploaded by the client)
exports.createEpisode = async (req, res) => {
  try {
    const { title, audioUrl } = req.body;
    if (!title?.trim() || !audioUrl) return fail(res, null, 400, 'Title and audio are required');
    const ep = await PodcastEpisode.create({
      showId: req.body.showId && mongoose.isValidObjectId(req.body.showId) ? req.body.showId : new mongoose.Types.ObjectId(),
      hostUserId: req.user._id, hostName: req.body.hostName?.trim() || req.user.name || 'AreaConnect FM',
      title: title.trim(), description: req.body.description || '', coverImage: req.body.coverImage || '', audioUrl,
      durationSec: Number(req.body.durationSec) || 0, guestNames: Array.isArray(req.body.guestNames) ? req.body.guestNames : [],
      category: req.body.category || 'community', tags: req.body.tags || [], seriesName: req.body.seriesName || '',
      episodeNumber: Number(req.body.episodeNumber) || 0, showNotes: req.body.showNotes || '',
      isPublished: req.body.isPublished !== false, featured: !!req.body.featured, audience: req.body.audience || { scope: 'all', estateIds: [] },
      publishedAt: new Date(),
    });
    return res.status(201).json({ success: true, data: ep });
  } catch (err) { return fail(res, err); }
};

// PATCH /api/podcast/admin/episodes/:id
exports.updateEpisode = async (req, res) => {
  try {
    const ep = await PodcastEpisode.findById(req.params.id);
    if (!ep) return fail(res, null, 404, 'Episode not found');
    ['title', 'description', 'coverImage', 'category', 'tags', 'seriesName', 'episodeNumber', 'showNotes', 'isPublished', 'featured', 'guestNames', 'audience', 'hostName']
      .forEach((k) => { if (req.body[k] !== undefined) ep[k] = req.body[k]; });
    await ep.save();
    return res.json({ success: true, data: ep });
  } catch (err) { return fail(res, err); }
};

// DELETE /api/podcast/admin/episodes/:id
exports.deleteEpisode = async (req, res) => {
  try {
    const ep = await PodcastEpisode.findByIdAndDelete(req.params.id);
    if (!ep) return fail(res, null, 404, 'Episode not found');
    await PodcastShow.updateMany({ episodeId: ep._id }, { $unset: { episodeId: 1 } });
    return res.json({ success: true });
  } catch (err) { return fail(res, err); }
};
