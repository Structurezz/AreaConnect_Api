const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Estate = require('../models/Estate');

exports.createUser = async (req, res) => {
  try {
    const { name, email, phone, password, role, estateId } = req.body;

    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, phone, passwordHash, role, estateId: estateId || null });

    if (role === 'estate_manager' && estateId) {
      await Estate.findByIdAndUpdate(estateId, { managerId: user._id });
    }

    return res.status(201).json({ success: true, data: user.toSafeObject() });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const { role, estateId, search, status, sort } = req.query;
    const filter = {};
    if (role)     filter.role = role;
    if (estateId) filter.estateId = estateId;
    if (status === 'active')   filter.isActive = true;
    if (status === 'suspended') filter.isActive = false;
    if (status === 'pending-reset') filter.mustChangePassword = true;
    if (search) filter.$or = [
      { name:  { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
    ];

    const sortMap = {
      new:      { createdAt: -1 },
      old:      { createdAt: 1 },
      lastseen: { lastSeen: -1 },
      name:     { name: 1 },
    };

    const users = await User.find(filter)
      .select('-passwordHash -refreshToken')
      .populate('estateId', 'name estateCode')
      .populate('unitId', 'unitNumber block type')
      .sort(sortMap[sort] || sortMap.new);

    return res.json({ success: true, data: users });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/users/stats — super admin only
exports.getUserStats = async (req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    const sevenDaysAgo  = new Date(now.getTime() - 7  * 86400000);

    const [
      total, active, suspended, pendingReset,
      byRole,
      activeLast30d, activeLast7d,
      noEstate,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      User.countDocuments({ isActive: false }),
      User.countDocuments({ mustChangePassword: true }),
      User.aggregate([
        { $group: { _id: '$role', count: { $sum: 1 } } },
      ]),
      User.countDocuments({ lastSeen: { $gte: thirtyDaysAgo } }),
      User.countDocuments({ lastSeen: { $gte: sevenDaysAgo  } }),
      User.countDocuments({
        role: { $in: ['resident', 'security'] },
        $or: [{ estateId: null }, { estateId: { $exists: false } }],
      }),
    ]);

    return res.json({
      success: true,
      data: {
        total, active, suspended, pendingReset,
        byRole: byRole.reduce((m, r) => { m[r._id] = r.count; return m; }, {}),
        activeLast30d, activeLast7d, noEstate,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/users/:id/reset-password — super admin force-reset
exports.adminResetPassword = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const crypto = require('crypto');
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const bytes = crypto.randomBytes(10);
    let tempPassword = '';
    for (let i = 0; i < 10; i++) tempPassword += alphabet[bytes[i] % alphabet.length];

    user.passwordHash = await bcrypt.hash(tempPassword, 12);
    user.mustChangePassword = true;
    user.refreshToken = null;
    await user.save();

    // Email the user via the existing invite template so they get the temp pw.
    try {
      const estate = user.estateId ? await Estate.findById(user.estateId).select('name') : null;
      const emailService = require('../services/emailService');
      const loginUrl = user.role === 'security'
        ? (process.env.SECURITY_URL || 'https://area-guards.areaconnect.pro')
        : user.role === 'estate_manager'
          ? (process.env.ESTATE_MANAGER_URL || 'https://area-connector.areaconnect.pro')
          : (process.env.RESIDENT_URL || 'https://area-mates.areaconnect.pro');
      await emailService.sendInviteEmail({
        to: user.email,
        name: user.name,
        estateName: estate?.name || 'your estate',
        loginUrl,
        tempPassword,
      });
    } catch (e) {
      console.error('[adminResetPassword email]', e.message);
    }

    return res.json({ success: true, message: 'Password reset and temp emailed' });
  } catch (err) {
    console.error('[adminResetPassword]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/users/bulk — bulk suspend/activate
exports.bulkUpdate = async (req, res) => {
  try {
    const { userIds, action } = req.body;
    if (!Array.isArray(userIds) || !userIds.length) {
      return res.status(400).json({ success: false, message: 'userIds required' });
    }
    let update = null;
    if (action === 'suspend')  update = { isActive: false };
    if (action === 'activate') update = { isActive: true };
    if (!update) return res.status(400).json({ success: false, message: 'Unknown action' });
    const result = await User.updateMany({ _id: { $in: userIds } }, update);
    return res.json({ success: true, data: { matched: result.matchedCount, modified: result.modifiedCount } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const allowed = ['name', 'phone', 'isActive', 'role', 'estateId'];
    const update = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });

    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true })
      .select('-passwordHash -refreshToken')
      .populate('estateId', 'name estateCode');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    return res.json({ success: true, data: user });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
