const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Estate = require('../models/Estate');
const Unit = require('../models/Unit');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../services/tokenService');

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
