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

// GET /api/users/:id/detail — one account in full for the admin side panel:
// profile, site, unit, household, care team, and recent activity across
// payments, visitor passes, alerts, calls, credits, payouts and marketplace.
exports.getUserDetail = async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[a-f0-9]{24}$/i.test(id)) return res.status(404).json({ success: false, message: 'User not found' });
    const user = await User.findById(id)
      .select('-passwordHash -refreshToken')
      .populate({ path: 'estateId', select: 'name estateCode city state site.type isActive managerId', populate: { path: 'managerId', select: 'name email' } })
      .populate('managedEstates', 'name estateCode site.type isActive')
      .populate('requestedEstateId', 'name estateCode')
      .populate('unitId', 'unitNumber block type status')
      .populate('stay.roomId', 'unitNumber block')
      .populate('householdHead', 'name email phone')
      .populate('assignedTo', 'name siteRole')
      .populate('invitedBy', 'name email')
      .lean();
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const m = (name) => require(`../models/${name}`);
    const uid = user._id;
    const safe = (p, fb) => p.catch(() => fb);
    const [
      household, payments, payTotals, visitors, visitorCount, verifiedCount, alerts, alertCount,
      calls, callCount, credits, withdrawals, buys, sells, requests, sub,
    ] = await Promise.all([
      safe(User.find({ householdHead: uid }).select('name email relationship householdStatus isActive').lean(), []),
      safe(m('Payment').find({ residentId: uid }).populate('scheduleId', 'title').sort({ createdAt: -1 }).limit(10).select('amount status paidAt createdAt method scheduleId paystackReference').lean(), []),
      safe(m('Payment').aggregate([{ $match: { residentId: uid } }, { $group: { _id: '$status', total: { $sum: '$amount' }, count: { $sum: 1 } } }]), []),
      safe(m('Visitor').find({ hostResidentId: uid }).sort({ createdAt: -1 }).limit(8).select('visitorName purpose status expectedDate entryTime exitTime category visitorCode createdAt').lean(), []),
      safe(m('Visitor').countDocuments({ hostResidentId: uid }), 0),
      user.role === 'security' ? safe(m('Visitor').countDocuments({ verifiedBySecurityId: uid }), 0) : 0,
      safe(m('Alert').find({ residentId: uid }).sort({ createdAt: -1 }).limit(5).select('type status title createdAt').lean(), []),
      safe(m('Alert').countDocuments({ residentId: uid }), 0),
      safe(m('Call').find({ $or: [{ callerId: uid }, { calleeId: uid }] }).populate('callerId', 'name').populate('calleeId', 'name').sort({ createdAt: -1 }).limit(5).select('callerId calleeId status kind durationSec creditsCharged createdAt').lean(), []),
      safe(m('Call').countDocuments({ $or: [{ callerId: uid }, { calleeId: uid }] }), 0),
      safe(m('CreditTransaction').find({ userId: uid }).sort({ createdAt: -1 }).limit(6).select('type amount balanceAfter description createdAt').lean(), []),
      safe(m('Withdrawal').find({ userId: uid }).sort({ createdAt: -1 }).limit(5).select('amount status reference createdAt source').lean(), []),
      safe(m('MarketplaceOrder').aggregate([{ $match: { buyerId: uid } }, { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$amount' } } }]), []),
      safe(m('MarketplaceOrder').aggregate([{ $match: { sellerId: uid } }, { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$sellerAmount' } } }]), []),
      safe(m('ServiceRequest').countDocuments({ requesterId: uid }), 0),
      user.role === 'estate_manager' && user.estateId?._id
        ? safe(m('Subscription').findOne({ estateId: user.estateId._id }).populate('planId', 'name').select('status planId nextBillingDate trialEndsAt').lean(), null)
        : null,
    ]);

    const byStatus = Object.fromEntries(payTotals.map((p) => [p._id, { total: p.total, count: p.count }]));
    return res.json({
      success: true,
      data: {
        user, household, subscription: sub,
        payments: { recent: payments, byStatus },
        visitors: { recent: visitors, total: visitorCount, verified: verifiedCount },
        alerts: { recent: alerts, total: alertCount },
        calls: { recent: calls, total: callCount },
        credits, withdrawals, requests,
        marketplace: { bought: buys[0] || { count: 0, total: 0 }, sold: sells[0] || { count: 0, total: 0 } },
      },
    });
  } catch (err) {
    console.error('[getUserDetail]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
