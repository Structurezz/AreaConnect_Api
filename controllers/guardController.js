const { escapeRx, PRIVATE_USER, pageLimit } = require('../utils/safeQuery');
const User   = require('../models/User');
const Estate = require('../models/Estate');
const bcrypt = require('bcryptjs');
const { sendInviteEmail } = require('../services/emailService');
const { guardPostsFor } = require('../utils/siteRoles');

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
    const posts = guardPostsFor(estate?.site?.type);
    const post = posts.find((p) => p.key === req.body.post) || posts[0];
    const place = post.place ? String(req.body.place || '').trim().slice(0, 80) : '';
    if (post.place && !place) return res.status(400).json({ success: false, message: `Choose the ${post.place.toLowerCase()} this ${post.label.toLowerCase()} looks after` });

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
      guardPost: post.key,
      guardPlace: place,
    });

    const loginUrl = guardLoginUrl();

    await sendInviteEmail({
      to: email.toLowerCase(),
      name,
      estateName: estate?.name || 'your estate',
      loginUrl,
      tempPassword,
    });

    return res.status(201).json({ success: true, message: `${post.label} account created and credentials sent to ${email}` });
  } catch (err) {
    console.error('[inviteGuard]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Update post / hall / details ───────────────────────────────────────────────

exports.updateGuard = async (req, res) => {
  try {
    const guard = await User.findOne({ _id: req.params.id, estateId: req.estateId, role: 'security' });
    if (!guard) return res.status(404).json({ success: false, message: 'Guard not found' });
    const estate = await Estate.findById(req.estateId).select('site');
    const posts = guardPostsFor(estate?.site?.type);
    if (req.body.name !== undefined) guard.name = String(req.body.name).trim() || guard.name;
    if (req.body.phone !== undefined) guard.phone = String(req.body.phone).trim();
    if (req.body.post !== undefined) {
      const post = posts.find((p) => p.key === req.body.post);
      if (!post) return res.status(400).json({ success: false, message: 'Unknown post' });
      guard.guardPost = post.key;
      if (!post.place) guard.guardPlace = '';
    }
    if (req.body.place !== undefined) guard.guardPlace = String(req.body.place).trim().slice(0, 80);
    const cur = posts.find((p) => p.key === guard.guardPost) || posts[0];
    if (cur.place && !guard.guardPlace) return res.status(400).json({ success: false, message: `Choose the ${cur.place.toLowerCase()} this ${cur.label.toLowerCase()} looks after` });
    await guard.save();
    const out = guard.toObject(); delete out.passwordHash; delete out.refreshToken;
    return res.json({ success: true, data: out });
  } catch (err) {
    console.error('[updateGuard]', err);
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
