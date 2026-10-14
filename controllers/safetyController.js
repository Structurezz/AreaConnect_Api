const mongoose = require('mongoose');
const SafetyBlock = require('../models/SafetyBlock');
const SafetyIncident = require('../models/SafetyIncident');
const User = require('../models/User');
const safety = require('../services/safetyService');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const profile = (u) => u && ({ _id: u._id, name: u.name, profilePhoto: u.profilePhoto || '', unit: safety.unitLabel(u.unitId) });

// GET /safety/residents?q= — find a resident to block (includes people hidden
// from the neighbour directory: you may need to block someone you can't see).
exports.searchResidents = async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ success: true, data: [] });
  const rx = new RegExp(escapeRegex(q), 'i');
  const users = await User.find({ estateId: req.estateId, role: 'resident', isActive: true, _id: { $ne: req.user._id }, name: rx })
    .select('name profilePhoto unitId').populate('unitId', 'unitNumber block').limit(15).lean();
  res.json({ success: true, data: users.map(profile) });
};

// GET /safety/blocks — people I've blocked
exports.listBlocks = async (req, res) => {
  const blocks = await SafetyBlock.find({ protectedId: req.user._id })
    .populate({ path: 'blockedId', select: 'name profilePhoto unitId', populate: { path: 'unitId', select: 'unitNumber block' } })
    .sort({ createdAt: -1 }).lean();
  const counts = await SafetyIncident.aggregate([
    { $match: { protectedId: req.user._id, type: { $in: ['call_attempt', 'buzz_attempt'] } } },
    { $group: { _id: '$blockedId', attempts: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.attempts]));
  res.json({ success: true, data: blocks.map((b) => ({
    _id: b._id, reason: b.reason, gateWatch: b.gateWatch, createdAt: b.createdAt,
    person: profile(b.blockedId), contactAttempts: byId.get(String(b.blockedId?._id)) || 0,
  })) });
};

// POST /safety/blocks { userId, reason?, gateWatch? }
exports.addBlock = async (req, res) => {
  const { userId, reason = '', gateWatch = true } = req.body;
  if (req.user.role !== 'resident') return res.status(403).json({ success: false, message: 'Only residents can create safety blocks' });
  if (!mongoose.isValidObjectId(userId) || String(userId) === String(req.user._id)) return res.status(400).json({ success: false, message: 'Pick someone to block' });
  const target = await User.findOne({ _id: userId, estateId: req.estateId, role: 'resident' }).select('_id').lean();
  if (!target) return res.status(404).json({ success: false, message: 'Resident not found' });
  const block = await SafetyBlock.findOneAndUpdate(
    { protectedId: req.user._id, blockedId: userId },
    { $setOnInsert: { estateId: req.estateId, protectedId: req.user._id, blockedId: userId }, $set: { reason: String(reason).slice(0, 300), gateWatch: !!gateWatch } },
    { upsert: true, new: true }
  );
  res.status(201).json({ success: true, message: 'Blocked. They won\'t be told, and can\'t call or buzz you.', data: { _id: block._id } });
};

// PATCH /safety/blocks/:id { gateWatch }
exports.updateBlock = async (req, res) => {
  const block = await SafetyBlock.findOneAndUpdate({ _id: req.params.id, protectedId: req.user._id }, { $set: { gateWatch: !!req.body.gateWatch } }, { new: true });
  if (!block) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: block });
};

// DELETE /safety/blocks/:id
exports.removeBlock = async (req, res) => {
  const r = await SafetyBlock.deleteOne({ _id: req.params.id, protectedId: req.user._id });
  if (!r.deletedCount) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, message: 'Unblocked' });
};

// POST /safety/followed { blockedId?, note?, lat?, lng? } — panic: "I'm being followed"
exports.reportFollowed = async (req, res) => {
  try {
    const { blockedId, note = '', lat, lng } = req.body;
    const protectedUser = await safety.loadPerson(req.user._id);
    let blockedUser = null;
    if (blockedId && mongoose.isValidObjectId(blockedId)) {
      const b = await safety.loadPerson(blockedId);
      if (b && String(b.estateId) === String(req.estateId)) blockedUser = b;
    }
    const hasFix = [lat, lng].every((v) => typeof v === 'number' && Number.isFinite(v));
    const location = hasFix ? `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}` : '';
    const alert = await safety.raiseSafetyAlert({
      estateId: req.estateId, protectedUser, blockedUser, kind: 'followed',
      note: [String(note).slice(0, 300), hasFix ? 'Live location attached.' : ''].filter(Boolean).join(' '), location,
    });
    await SafetyIncident.create({ estateId: req.estateId, protectedId: req.user._id, blockedId: blockedUser?._id, type: 'followed', alertId: alert._id, details: hasFix ? { lat, lng } : {} });
    res.status(201).json({ success: true, message: 'Security and estate management have been alerted.', data: { alertId: alert._id } });
  } catch (e) {
    console.error('[safety followed]', e);
    res.status(500).json({ success: false, message: 'Could not send the alert — call security directly' });
  }
};

// POST /safety/location/start · /stop — live location for security
exports.startLocation = async (req, res) => {
  const user = await User.findById(req.user._id).select('name phone profilePhoto unitId estateId').populate('unitId', 'unitNumber block').lean();
  const share = safety.startShare(user);
  await SafetyIncident.create({ estateId: req.estateId, protectedId: req.user._id, type: 'location_share' });
  res.json({ success: true, data: { startedAt: share.startedAt, maxMinutes: 60 } });
};
exports.stopLocation = async (req, res) => {
  safety.stopShare(req.user._id);
  res.json({ success: true });
};

// GET /safety/location/active — staff: who is sharing right now
exports.activeLocations = async (req, res) => {
  res.json({ success: true, data: safety.activeShares(req.estateId) });
};
