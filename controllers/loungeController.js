const LoungeSession  = require('../models/LoungeSession');
const DEFAULT_TRACKS = require('../data/defaultTracks');

// Synthesise the default tracks as suggestion-shaped entries so the frontend
// can keep rendering them without any changes. These are NOT persisted — they
// come from the single shared source (data/defaultTracks.js) on every call.
// IDs are deterministic (prefixed) so React keys stay stable across renders.
function buildVirtualDefaults() {
  // One pass through the shared list — keep deterministic order so clients
  // can paginate it consistently. Shuffling is now a client concern.
  return DEFAULT_TRACKS.map((t) => ({
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

// Legacy sessions may still have isDefault entries baked into their
// suggestions array (from before the refactor). Strip them on read so the
// document converges to community-only over time, and we never
// double-render defaults.
async function stripLegacyDefaults(session) {
  if (!session) return;
  const hadDefaults = session.suggestions.some((s) => s.isDefault);
  if (!hadDefaults) return;
  session.suggestions = session.suggestions.filter((s) => !s.isDefault);
  try { await session.save(); } catch { /* best effort */ }
}

// Returns the response shape the frontend expects: a single `suggestions`
// array with community adds first (newest first already), then the shared
// defaults appended as virtual entries.
function withDefaults(session) {
  const obj = session.toObject();
  obj.suggestions = [...obj.suggestions, ...buildVirtualDefaults()];
  return obj;
}

exports.getSession = async (req, res) => {
  try {
    let session = await LoungeSession.findOne({ estateId: req.estateId })
      .populate('suggestions.suggestedBy', 'name');

    if (!session) {
      // Create a brand-new session with no persisted suggestions —
      // defaults are merged in at response time from the shared source.
      session = await LoungeSession.create({ estateId: req.estateId, suggestions: [] });
      await session.populate('suggestions.suggestedBy', 'name');
    } else {
      await stripLegacyDefaults(session);
    }

    res.json({ success: true, data: withDefaults(session) });
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

    res.json({ success: true, data: withDefaults(session) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.suggestVideo = async (req, res) => {
  try {
    const { videoId, title } = req.body;
    if (!videoId || !title)
      return res.status(400).json({ success: false, message: 'videoId and title are required' });

    // Prevent duplicates against both community adds AND defaults.
    const isDefaultTrack = DEFAULT_TRACKS.some((d) => d.videoId === videoId);
    if (isDefaultTrack)
      return res.status(400).json({ success: false, message: 'That track is already in the house playlist' });

    let session = await LoungeSession.findOne({ estateId: req.estateId });
    if (!session) {
      session = await LoungeSession.create({ estateId: req.estateId, suggestions: [] });
    }

    if (session.suggestions.some((s) => s.videoId === videoId))
      return res.status(400).json({ success: false, message: 'Video already in queue' });

    // Community suggestions go to the front.
    session.suggestions.unshift({
      videoId,
      title,
      isDefault:   false,
      suggestedBy: req.user._id,
      votes:       [req.user._id],
    });

    await session.save();
    await session.populate('suggestions.suggestedBy', 'name');

    res.json({ success: true, data: withDefaults(session) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.voteVideo = async (req, res) => {
  try {
    const { suggestionId } = req.params;

    // Defaults are virtual (not persisted) so they can't be voted on.
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

    res.json({ success: true, data: withDefaults(session), voted: !hasVoted });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.removeSuggestion = async (req, res) => {
  try {
    const { suggestionId } = req.params;

    // Defaults are read-only — anyone wanting to add/remove defaults does so
    // in data/defaultTracks.js (code change, applies to every estate).
    if (typeof suggestionId === 'string' && suggestionId.startsWith('default:')) {
      return res.status(403).json({
        success: false,
        message: 'Default tracks are part of the house playlist and cannot be removed',
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

// Kept for API compatibility — no-op now that defaults are not persisted.
exports.resetDefaults = async (req, res) => {
  try {
    const session = await LoungeSession.findOne({ estateId: req.estateId });
    if (session) await stripLegacyDefaults(session);
    const fresh = session || await LoungeSession.create({ estateId: req.estateId, suggestions: [] });
    await fresh.populate('suggestions.suggestedBy', 'name');
    res.json({
      success: true,
      message: 'Defaults are managed centrally — nothing to reset',
      data: withDefaults(fresh),
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
