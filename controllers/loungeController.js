const LoungeSession  = require('../models/LoungeSession');
const DefaultTrack   = require('../models/DefaultTrack');
const SEED_TRACKS    = require('../data/defaultTracks');

// ── Shared defaults source ────────────────────────────────────────────────────
// Defaults now live in the DefaultTrack collection and are managed via the
// admin UI. We cache them in-memory for 60s to keep the hot getSession path
// cheap. Call invalidateDefaults() after any admin mutation.
const CACHE_TTL = 60 * 1000;
let defaultCache   = null;
let defaultCacheAt = 0;

const invalidateDefaults = () => { defaultCache = null; defaultCacheAt = 0; };

async function loadDefaults() {
  if (defaultCache && Date.now() - defaultCacheAt < CACHE_TTL) return defaultCache;

  let tracks = await DefaultTrack.find({ isActive: true })
    .sort({ order: 1, createdAt: 1 })
    .lean();

  // One-shot migration — the collection is empty on first run after this
  // refactor, so seed it from data/defaultTracks.js so we don't lose the
  // starter playlist.
  if (tracks.length === 0 && SEED_TRACKS.length) {
    try {
      const docs = SEED_TRACKS.map((t, i) => ({
        videoId: t.videoId,
        title:   t.title,
        artist:  t.artist || '',
        order:   i,
      }));
      await DefaultTrack.insertMany(docs, { ordered: false });
      tracks = await DefaultTrack.find({ isActive: true })
        .sort({ order: 1, createdAt: 1 })
        .lean();
    } catch { /* duplicate key etc. — ignore, we'll just use whatever's in the db */ }
  }

  defaultCache   = tracks;
  defaultCacheAt = Date.now();
  return defaultCache;
}

async function buildVirtualDefaults() {
  const tracks = await loadDefaults();
  return tracks.map((t) => ({
    _id:         `default:${t.videoId}`,
    videoId:     t.videoId,
    title:       t.title,
    artist:      t.artist || '',
    isDefault:   true,
    suggestedBy: null,
    votes:       [],
    suggestedAt: null,
  }));
}

async function withDefaults(session) {
  const obj = session.toObject();
  const defaults = await buildVirtualDefaults();
  obj.suggestions = [...obj.suggestions, ...defaults];
  return obj;
}

// Legacy sessions may still have isDefault entries baked into their suggestions
// array (from before the refactor). Strip them on read so documents converge
// to community-only over time.
async function stripLegacyDefaults(session) {
  if (!session) return;
  const hadDefaults = session.suggestions.some((s) => s.isDefault);
  if (!hadDefaults) return;
  session.suggestions = session.suggestions.filter((s) => !s.isDefault);
  try { await session.save(); } catch { /* best effort */ }
}

async function isTrackInHousePlaylist(videoId) {
  const tracks = await loadDefaults();
  return tracks.some((t) => t.videoId === videoId);
}

// ── Session endpoints (per-estate) ────────────────────────────────────────────

exports.getSession = async (req, res) => {
  try {
    let session = await LoungeSession.findOne({ estateId: req.estateId })
      .populate('suggestions.suggestedBy', 'name');

    if (!session) {
      session = await LoungeSession.create({ estateId: req.estateId, suggestions: [] });
      await session.populate('suggestions.suggestedBy', 'name');
    } else {
      await stripLegacyDefaults(session);
    }

    res.json({ success: true, data: await withDefaults(session) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.updateMood = async (req, res) => {
  try {
    const { isAutoDJ } = req.body;
    const update = {};
    if (typeof isAutoDJ === 'boolean') update.isAutoDJ = isAutoDJ;

    const session = await LoungeSession.findOneAndUpdate(
      { estateId: req.estateId },
      { $set: update },
      { new: true, upsert: true },
    ).populate('suggestions.suggestedBy', 'name');

    res.json({ success: true, data: await withDefaults(session) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.suggestVideo = async (req, res) => {
  try {
    const { videoId, title } = req.body;
    if (!videoId || !title)
      return res.status(400).json({ success: false, message: 'videoId and title are required' });

    if (await isTrackInHousePlaylist(videoId))
      return res.status(400).json({ success: false, message: 'That track is already in the house playlist' });

    let session = await LoungeSession.findOne({ estateId: req.estateId });
    if (!session) {
      session = await LoungeSession.create({ estateId: req.estateId, suggestions: [] });
    }

    if (session.suggestions.some((s) => s.videoId === videoId))
      return res.status(400).json({ success: false, message: 'Video already in queue' });

    session.suggestions.unshift({
      videoId,
      title,
      isDefault:   false,
      suggestedBy: req.user._id,
      votes:       [req.user._id],
    });

    await session.save();
    await session.populate('suggestions.suggestedBy', 'name');

    res.json({ success: true, data: await withDefaults(session) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.voteVideo = async (req, res) => {
  try {
    const { suggestionId } = req.params;

    if (typeof suggestionId === 'string' && suggestionId.startsWith('default:')) {
      return res.status(400).json({
        success: false,
        message: 'Voting is only available for community-added tracks',
      });
    }

    const session = await LoungeSession.findOne({ estateId: req.estateId });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    const sg = session.suggestions.id(suggestionId);
    if (!sg) return res.status(404).json({ success: false, message: 'Suggestion not found' });

    const uid      = req.user._id.toString();
    const hasVoted = sg.votes.some((v) => v.toString() === uid);
    if (hasVoted) sg.votes = sg.votes.filter((v) => v.toString() !== uid);
    else sg.votes.push(req.user._id);

    await session.save();
    await session.populate('suggestions.suggestedBy', 'name');

    res.json({ success: true, data: await withDefaults(session), voted: !hasVoted });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.removeSuggestion = async (req, res) => {
  try {
    const { suggestionId } = req.params;

    if (typeof suggestionId === 'string' && suggestionId.startsWith('default:')) {
      return res.status(403).json({
        success: false,
        message: 'Default tracks are part of the house playlist — manage them in the admin dashboard',
      });
    }

    const session = await LoungeSession.findOne({ estateId: req.estateId });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    const sg = session.suggestions.id(suggestionId);
    if (!sg) return res.status(404).json({ success: false, message: 'Not found' });

    const isOwn   = sg.suggestedBy?.toString() === req.user._id.toString();
    const isAdmin = ['estate_manager', 'super_admin'].includes(req.user.role);
    if (!isOwn && !isAdmin)
      return res.status(403).json({ success: false, message: 'Not allowed' });

    sg.deleteOne();
    await session.save();

    res.json({ success: true, message: 'Removed' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.resetDefaults = async (req, res) => {
  try {
    const session = await LoungeSession.findOne({ estateId: req.estateId });
    if (session) await stripLegacyDefaults(session);
    const fresh = session || await LoungeSession.create({ estateId: req.estateId, suggestions: [] });
    await fresh.populate('suggestions.suggestedBy', 'name');
    res.json({
      success: true,
      message: 'Defaults are managed centrally — nothing to reset',
      data: await withDefaults(fresh),
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── Admin default-track CRUD ──────────────────────────────────────────────────

exports.listDefaults = async (req, res) => {
  try {
    const tracks = await DefaultTrack.find()
      .sort({ order: 1, createdAt: 1 })
      .populate('createdBy', 'name')
      .lean();
    res.json({ success: true, data: tracks });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.createDefault = async (req, res) => {
  try {
    const { videoId, title, artist, order, isActive } = req.body;
    if (!videoId || !title)
      return res.status(400).json({ success: false, message: 'videoId and title are required' });

    const exists = await DefaultTrack.findOne({ videoId: videoId.trim() });
    if (exists)
      return res.status(409).json({ success: false, message: 'That videoId is already in the house playlist' });

    // Compute next order if not provided — put at the end.
    let resolvedOrder = order;
    if (typeof resolvedOrder !== 'number') {
      const last = await DefaultTrack.findOne().sort({ order: -1 }).select('order').lean();
      resolvedOrder = (last?.order ?? -1) + 1;
    }

    const track = await DefaultTrack.create({
      videoId:   videoId.trim(),
      title:     title.trim(),
      artist:    (artist || '').trim(),
      order:     resolvedOrder,
      isActive:  isActive !== false,
      createdBy: req.user._id,
    });

    invalidateDefaults();
    res.status(201).json({ success: true, data: track });
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ success: false, message: 'videoId already exists' });
    }
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.updateDefault = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, artist, order, isActive, videoId } = req.body;
    const update = {};
    if (typeof title === 'string')    update.title    = title.trim();
    if (typeof artist === 'string')   update.artist   = artist.trim();
    if (typeof order === 'number')    update.order    = order;
    if (typeof isActive === 'boolean') update.isActive = isActive;
    if (typeof videoId === 'string' && videoId.trim()) update.videoId = videoId.trim();

    const track = await DefaultTrack.findByIdAndUpdate(id, update, { new: true, runValidators: true });
    if (!track) return res.status(404).json({ success: false, message: 'Track not found' });

    invalidateDefaults();
    res.json({ success: true, data: track });
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ success: false, message: 'videoId already exists' });
    }
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.deleteDefault = async (req, res) => {
  try {
    const { id } = req.params;
    const track = await DefaultTrack.findByIdAndDelete(id);
    if (!track) return res.status(404).json({ success: false, message: 'Track not found' });

    invalidateDefaults();
    res.json({ success: true, message: 'Removed from house playlist' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// Re-import from data/defaultTracks.js (admin-triggered). Skips videoIds that
// are already in the collection so we don't duplicate the admin's own additions.
exports.reseedDefaults = async (req, res) => {
  try {
    const existing = await DefaultTrack.find().select('videoId').lean();
    const have = new Set(existing.map((t) => t.videoId));

    const toInsert = SEED_TRACKS
      .filter((t) => !have.has(t.videoId))
      .map((t, i) => ({
        videoId: t.videoId,
        title:   t.title,
        artist:  t.artist || '',
        order:   (existing.length + i),
      }));

    if (toInsert.length === 0) {
      return res.json({ success: true, message: 'Nothing new to seed', inserted: 0 });
    }

    const docs = await DefaultTrack.insertMany(toInsert, { ordered: false });
    invalidateDefaults();
    res.json({ success: true, message: `Imported ${docs.length} tracks`, inserted: docs.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
