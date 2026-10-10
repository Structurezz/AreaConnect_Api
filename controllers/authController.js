const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const Estate = require('../models/Estate');
const Unit = require('../models/Unit');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const PasswordResetRequest = require('../models/PasswordResetRequest');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../services/tokenService');
const { emitNotification } = require('../services/socketService');
const campaignController = require('./campaignController');
const emailService = require('../services/emailService');

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

exports.register = async (req, res) => {
  try {
    const { name, email, phone, password, role, estateCode, estateName, estateAddress, billingModel, cycle, planSlug } = req.body;

    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    let estateId = null;
    let estateData = null;

    if (role === 'estate_manager') {
      if (!estateName || !estateAddress) {
        return res.status(400).json({ success: false, message: 'Estate name and address are required' });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await User.create({ name, email, phone, passwordHash, role: 'estate_manager' });

      // Create estate and link manager
      const estate = await Estate.create({ name: estateName, address: estateAddress, managerId: user._id });
      user.estateId = estate._id;
      user.managedEstates = [estate._id];
      const accessToken = generateAccessToken(user._id, user.role, estate._id);
      const refreshToken = generateRefreshToken(user._id);
      user.refreshToken = refreshToken;
      await user.save();

      // Start 14-day trial on the chosen plan (fall back through growth → starter → any active plan)
      const slug = planSlug || 'growth';
      const chosenPlan = await Plan.findOne({ slug, isActive: true })
        || await Plan.findOne({ slug: 'growth', isActive: true })
        || await Plan.findOne({ slug: 'starter', isActive: true })
        || await Plan.findOne({ isActive: true }).sort({ sortOrder: 1 });
      if (chosenPlan) {
        const trialEndsAt = new Date(Date.now() + 14 * 86400000);
        await Subscription.create({
          estateId: estate._id,
          planId: chosenPlan._id,
          billingModel: billingModel || 'flat',
          cycle: cycle || 'monthly',
          status: 'trial',
          trialEndsAt,
          nextBillingDate: trialEndsAt,
          startDate: new Date(),
        });
      }

      res.cookie('refreshToken', refreshToken, COOKIE_OPTS);
      campaignController.onUserSignup(user).catch(() => {});
      return res.status(201).json({
        success: true,
        message: 'Registration successful',
        data: { user: user.toSafeObject(), accessToken, estate },
      });
    }

    // Resident / security — require estate code
    if (role === 'resident' || role === 'security') {
      if (!estateCode) {
        return res.status(400).json({ success: false, message: 'Estate code required for this role' });
      }
      const estate = await Estate.findOne({ estateCode: estateCode.toUpperCase() });
      if (!estate) {
        return res.status(404).json({ success: false, message: 'Invalid estate code' });
      }
      estateId = estate._id;
      estateData = estate;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      name, email, phone,
      passwordHash,
      role: role || 'resident',
      estateId,
    });

    const accessToken = generateAccessToken(user._id, user.role, user.estateId);
    const refreshToken = generateRefreshToken(user._id);
    user.refreshToken = refreshToken;
    await user.save();

    res.cookie('refreshToken', refreshToken, COOKIE_OPTS);
    campaignController.onUserSignup(user).catch(() => {});
    return res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: { user: user.toSafeObject(), accessToken, estate: estateData },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const valid = await user.comparePassword(password);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const accessToken = generateAccessToken(user._id, user.role, user.estateId);
    const refreshToken = generateRefreshToken(user._id);

    user.refreshToken = refreshToken;
    user.lastSeen = new Date();
    await user.save();

    res.cookie('refreshToken', refreshToken, COOKIE_OPTS);

    let estateData = null;
    if (user.estateId) {
      estateData = await Estate.findById(user.estateId).select('name estateCode logoUrl');
    }

    const populatedUser = await User.findById(user._id)
      .populate('unitId', 'unitNumber block type')
      .populate('estateId', 'name estateCode logoUrl');

    return res.json({
      success: true,
      message: 'Login successful',
      data: { user: populatedUser.toSafeObject(), accessToken, estate: estateData },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.refresh = async (req, res) => {
  try {
    const token = req.cookies.refreshToken;
    if (!token) {
      return res.status(401).json({ success: false, message: 'No refresh token' });
    }

    const decoded = verifyRefreshToken(token);
    const user = await User.findById(decoded.userId);

    if (!user || user.refreshToken !== token) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }

    const accessToken = generateAccessToken(user._id, user.role, user.estateId);
    return res.json({ success: true, data: { accessToken } });
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Refresh token expired' });
  }
};

exports.logout = async (req, res) => {
  try {
    const token = req.cookies.refreshToken;
    if (token) {
      await User.findOneAndUpdate({ refreshToken: token }, { refreshToken: null });
    }
    res.clearCookie('refreshToken');
    return res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('estateId', 'name estateCode logoUrl settings')
      .populate('managedEstates', 'name estateCode logoUrl isActive')
      .populate('unitId', 'unitNumber block type');
    return res.json({ success: true, data: user.toSafeObject() });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { name, phone, profilePhoto, isDiscoverable } = req.body;
    const update = {};
    if (typeof name === 'string' && name.trim()) update.name = name.trim();
    if (typeof phone === 'string') update.phone = phone.trim();
    if (typeof isDiscoverable === 'boolean') update.isDiscoverable = isDiscoverable;
    if (typeof profilePhoto === 'string') {
      // Accept a data URL, an https URL, or empty string (to clear)
      if (profilePhoto === '' || /^(data:image\/(png|jpe?g|webp|gif);base64,|https?:\/\/)/i.test(profilePhoto)) {
        // Cap base64 payload at ~200KB after encoding to prevent bloating the doc
        if (profilePhoto.startsWith('data:') && profilePhoto.length > 280000) {
          return res.status(400).json({ success: false, message: 'Avatar too large. Please choose a smaller image.' });
        }
        update.profilePhoto = profilePhoto;
      } else {
        return res.status(400).json({ success: false, message: 'Invalid profile photo format' });
      }
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, message: 'No changes provided' });
    }

    const user = await User.findByIdAndUpdate(req.user._id, update, { new: true })
      .populate('estateId', 'name estateCode logoUrl settings')
      .populate('managedEstates', 'name estateCode logoUrl isActive')
      .populate('unitId', 'unitNumber block type');

    return res.json({ success: true, data: user.toSafeObject() });
  } catch (err) {
    console.error('updateProfile error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.switchEstate = async (req, res) => {
  try {
    const { estateId } = req.body;
    if (!estateId) {
      return res.status(400).json({ success: false, message: 'estateId is required' });
    }

    const user = await User.findById(req.user._id);

    // Check managedEstates array OR direct managerId ownership (legacy accounts)
    const inArray = user.managedEstates.some(id => id.toString() === estateId);
    const ownsEstate = !inArray && await Estate.findOne({ _id: estateId, managerId: user._id });
    if (!inArray && !ownsEstate) {
      return res.status(403).json({ success: false, message: 'You do not manage that estate' });
    }
    // Backfill if missing
    if (!inArray) {
      await User.findByIdAndUpdate(user._id, { $addToSet: { managedEstates: estateId } });
    }

    user.estateId = estateId;
    await user.save();

    const estate = await Estate.findById(estateId).select('name estateCode logoUrl settings');
    const accessToken = generateAccessToken(user._id, user.role, estateId);

    return res.json({ success: true, data: { accessToken, estate } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ──────────────────────────────────────────────────────────────────────────
// Password management
// ──────────────────────────────────────────────────────────────────────────

const genTempPassword = () => {
  // 10-char readable temp (avoid 0/O/1/l confusion). bcrypt hashes it; the
  // plaintext only leaves the server via email.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
};

// POST /api/auth/change-password  (authenticated)
// Body: { currentPassword, newPassword }
// Residents + staff change their own password. Must know current unless
// mustChangePassword flag is set (first-login flow).
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Skip the current-password check only when the account is on a forced
    // reset (admin issued a temp password). Everything else must verify.
    if (!user.mustChangePassword) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, message: 'Current password required' });
      }
      const ok = await user.comparePassword(currentPassword);
      if (!ok) return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.mustChangePassword = false;
    // Invalidate any outstanding refresh tokens — force relogin on other devices
    user.refreshToken = null;
    await user.save();
    res.clearCookie('refreshToken');

    return res.json({ success: true, message: 'Password changed. Please sign in again.' });
  } catch (err) {
    console.error('[changePassword]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/auth/forgot-password/request  (public)
// Body: { email }
// Creates a pending request for the estate manager of that user's estate to
// review. Always 200 so attackers can't enumerate emails.
exports.requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body || {};
    const okResponse = { success: true, message: 'If an account exists for that email, your estate manager has been notified.' };
    if (!email || !email.includes('@')) return res.json(okResponse);

    const user = await User.findOne({ email: email.toLowerCase().trim() })
      .populate('unitId', 'unitNumber block')
      .populate('estateId', 'name');
    if (!user || !user.isActive || !user.estateId) return res.json(okResponse);

    // Reject estate managers from the resident/security path — they go through
    // super admin instead.
    if (user.role === 'estate_manager' || user.role === 'super_admin') {
      return res.json(okResponse);
    }

    // Dedup: if an active pending request already exists for this user in the
    // last hour, don't create another — just surface the existing one.
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const existing = await PasswordResetRequest.findOne({
      userId: user._id, status: 'pending', requestedAt: { $gte: since },
    });
    if (existing) return res.json(okResponse);

    const unitLabel = user.unitId
      ? `${user.unitId.block ? `Block ${user.unitId.block} · ` : ''}Unit ${user.unitId.unitNumber}`
      : '';

    const request = await PasswordResetRequest.create({
      userId:         user._id,
      estateId:       user.estateId._id,
      requesterName:  user.name,
      requesterEmail: user.email,
      requesterRole:  user.role,
      requesterUnit:  unitLabel,
      requesterPhone: user.phone || '',
      requesterIp:    (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim(),
      userAgent:      String(req.headers['user-agent'] || '').slice(0, 400),
    });

    // Notify every estate manager of that estate via socket + email.
    try {
      const managers = await User.find({
        estateId: user.estateId._id,
        role: 'estate_manager',
        isActive: true,
      }).select('_id name email');

      const estateName = user.estateId?.name || 'your estate';
      for (const m of managers) {
        emitNotification(user.estateId._id, {
          id:    `pw-reset:${request._id}`,
          type:  'password_reset_request',
          title: '🔐 Password reset request',
          body:  `${user.name}${unitLabel ? ` · ${unitLabel}` : ''} is asking to reset their password.`,
          meta: {
            kind: 'password_reset_request',
            requestId: request._id.toString(),
            userId:    user._id.toString(),
            requesterName: user.name,
            requesterRole: user.role,
            requesterUnit: unitLabel,
          },
        }, m._id);
      }

      // Fire-and-forget email to each manager
      const FRONTEND_URL = process.env.ESTATE_MANAGER_URL || process.env.FRONTEND_URL || 'https://area-connector.areaconnect.pro';
      const reviewUrl = `${FRONTEND_URL}/settings/password-requests`;
      Promise.allSettled(managers.map(m =>
        emailService.sendPasswordResetRequestEmail?.({
          to: m.email,
          managerName: m.name,
          estateName,
          requesterName: user.name,
          requesterRole: user.role,
          requesterUnit: unitLabel,
          requesterEmail: user.email,
          reviewUrl,
        }).catch(e => console.error('[reset-request email]', m.email, e.message))
      )).catch(() => {});
    } catch (e) {
      console.error('[requestPasswordReset notify]', e.message);
    }

    return res.json(okResponse);
  } catch (err) {
    console.error('[requestPasswordReset]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/auth/password-resets  (estate_manager)
exports.listPasswordResets = async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const q = { estateId: req.estateId };
    if (status !== 'all') q.status = status;
    const items = await PasswordResetRequest.find(q)
      .sort({ requestedAt: -1 })
      .limit(100)
      .populate('userId', 'name email phone role')
      .populate('reviewedBy', 'name')
      .lean();
    return res.json({ success: true, data: items });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/auth/password-resets/:id/approve  (estate_manager)
// Generates a temp password, emails the resident, flips mustChangePassword.
exports.approvePasswordReset = async (req, res) => {
  try {
    const request = await PasswordResetRequest.findOne({
      _id: req.params.id, estateId: req.estateId, status: 'pending',
    });
    if (!request) return res.status(404).json({ success: false, message: 'Request not found or already handled' });

    const user = await User.findById(request.userId).populate('estateId', 'name');
    if (!user) return res.status(404).json({ success: false, message: 'User no longer exists' });

    const tempPassword = genTempPassword();
    user.passwordHash = await bcrypt.hash(tempPassword, 12);
    user.mustChangePassword = true;
    user.refreshToken = null;
    await user.save();

    request.status = 'approved';
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    await request.save();

    // Email the resident with the temp password.
    try {
      const loginUrl = user.role === 'security'
        ? (process.env.SECURITY_URL || 'https://area-guards.areaconnect.pro')
        : (process.env.RESIDENT_URL || 'https://area-mates.areaconnect.pro');
      await emailService.sendInviteEmail({
        to: user.email,
        name: user.name,
        estateName: user.estateId?.name || 'your estate',
        loginUrl,
        tempPassword,
      });
    } catch (e) {
      console.error('[approve reset email]', e.message);
    }

    // Push a notification to the user so they know on the device too.
    try {
      emitNotification(request.estateId, {
        id: `pw-reset-approved:${request._id}`,
        type: 'password_reset_approved',
        title: '🔐 Password reset approved',
        body:  'Your estate manager approved your reset. Check your email for the temporary password.',
        meta:  { kind: 'password_reset_approved' },
      }, user._id);
    } catch {}

    return res.json({ success: true, data: request });
  } catch (err) {
    console.error('[approvePasswordReset]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/auth/password-resets/:id/deny  (estate_manager)
exports.denyPasswordReset = async (req, res) => {
  try {
    const { reason } = req.body || {};
    const request = await PasswordResetRequest.findOne({
      _id: req.params.id, estateId: req.estateId, status: 'pending',
    });
    if (!request) return res.status(404).json({ success: false, message: 'Request not found or already handled' });

    request.status = 'denied';
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    request.denyReason = (reason || '').slice(0, 300);
    await request.save();

    try {
      emitNotification(request.estateId, {
        id: `pw-reset-denied:${request._id}`,
        type: 'password_reset_denied',
        title: '🔐 Password reset was declined',
        body:  'Your estate manager declined your reset request. Contact them directly to resolve.',
        meta:  { kind: 'password_reset_denied' },
      }, request.userId);
    } catch {}

    return res.json({ success: true, data: request });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
