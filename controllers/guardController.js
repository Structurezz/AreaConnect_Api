const { escapeRx, PRIVATE_USER, pageLimit } = require('../utils/safeQuery');
const User   = require('../models/User');
const Estate = require('../models/Estate');
const bcrypt = require('bcryptjs');
const { sendInviteEmail } = require('../services/emailService');

const genTempPassword = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = 'Guard@';
  // crypto-random, 10 characters (was 6 from Math.random)
  for (let i = 0; i < 10; i++) s += chars[require('crypto').randomInt(chars.length)];
  return s;
};

const guardLoginUrl = () =>
  `${process.env.SECURITY_URL || process.env.CLIENT_URL || 'http://localhost:5182'}/login`;

// ── List ──────────────────────────────────────────────────────────────────────

exports.getGuards = async (req, res) => {
  try {
    const { page = 1, search } = req.query;
    const limit = pageLimit(req.query.limit, 20, 500);
    const filter = { estateId: req.estateId, role: 'security' };

    if (search) {
      filter.$or = [
        { name:  escapeRx(search) },
        { email: escapeRx(search) },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [guards, total] = await Promise.all([
      User.find(filter)
        .select(PRIVATE_USER)
        .sort({ name: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      User.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: guards,
      pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (err) {
    console.error('[getGuards]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Get one ───────────────────────────────────────────────────────────────────

exports.getGuard = async (req, res) => {
  try {
    const guard = await User.findOne({ _id: req.params.id, estateId: req.estateId, role: 'security' })
      .select(PRIVATE_USER);
    if (!guard) return res.status(404).json({ success: false, message: 'Guard not found' });
    return res.json({ success: true, data: guard });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Invite ────────────────────────────────────────────────────────────────────

exports.inviteGuard = async (req, res) => {
  try {
    const { email, name, phone } = req.body;
    const estate = await Estate.findById(req.estateId);

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const tempPassword = genTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    await User.create({
      name,
      email: email.toLowerCase(),
      phone: phone || '',
      passwordHash,
      role: 'security',
      estateId: req.estateId,
      isActive: true,
    });

    const loginUrl = guardLoginUrl();

    await sendInviteEmail({
      to: email.toLowerCase(),
      name,
      estateName: estate?.name || 'your estate',
      loginUrl,
      tempPassword,
    });

    return res.status(201).json({ success: true, message: `Guard account created and credentials sent to ${email}` });
  } catch (err) {
    console.error('[inviteGuard]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Suspend / Activate ────────────────────────────────────────────────────────

exports.suspendGuard = async (req, res) => {
  try {
    const guard = await User.findOne({ _id: req.params.id, estateId: req.estateId, role: 'security' });
    if (!guard) return res.status(404).json({ success: false, message: 'Guard not found' });
    guard.isActive = false;
    await guard.save();
    return res.json({ success: true, message: 'Guard suspended' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.activateGuard = async (req, res) => {
  try {
    const guard = await User.findOne({ _id: req.params.id, estateId: req.estateId, role: 'security' });
    if (!guard) return res.status(404).json({ success: false, message: 'Guard not found' });
    guard.isActive = true;
    await guard.save();
    return res.json({ success: true, message: 'Guard activated' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Remove ────────────────────────────────────────────────────────────────────

exports.removeGuard = async (req, res) => {
  try {
    const guard = await User.findOneAndDelete({ _id: req.params.id, estateId: req.estateId, role: 'security' });
    if (!guard) return res.status(404).json({ success: false, message: 'Guard not found' });
    return res.json({ success: true, message: 'Guard removed' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
