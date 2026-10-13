const Alert = require('../models/Alert');
const User = require('../models/User');
const Estate = require('../models/Estate');
const { emitAlert } = require('../services/socketService');
const { sendEmergencyAlertEmails } = require('../services/emailService');

const AUDIENCES = ['all', 'staff', 'estate_manager', 'security'];
// Residents can only alert estate staff — a resident-raised alert going to
// every other resident's phone (with a siren) leaked private emergencies.
const RESIDENT_AUDIENCES = ['staff', 'estate_manager', 'security'];
const STAFF_ROLES = ['security', 'estate_manager', 'super_admin'];

const TYPE_LABEL = {
  security: 'Security threat', fire: 'Fire emergency', medical: 'Medical emergency',
  noise: 'Noise complaint', other: 'Alert',
};
const DEFAULT_SEVERITY = { security: 'high', fire: 'critical', medical: 'critical', noise: 'low', other: 'medium' };
// Resident alerts of these types are emergencies: they're emailed to the
// targeted staff as well as pushed live. Noise / other are live-only.
const EMAIL_TYPES = ['security', 'fire', 'medical'];

const ROLE_LABEL = { resident: 'Resident', security: 'Security', estate_manager: 'Estate Manager', super_admin: 'Estate Manager' };

const POPULATE = [
  { path: 'residentId', select: 'name phone role profilePhoto' },
  { path: 'unitId', select: 'unitNumber block' },
  { path: 'resolvedBy', select: 'name' },
];

const normalizeAudience = (v, fallback = 'all') => (AUDIENCES.includes(v) ? v : fallback);
const unitLabel = (u) => (u ? `${u.block ? `Block ${u.block} · ` : ''}Unit ${u.unitNumber}` : '');

// Everyone an alert with this audience is meant to reach (except the sender).
async function recipientsFor(estateId, audience, excludeUserId) {
  const managers = { role: { $in: ['estate_manager', 'super_admin'] }, $or: [{ estateId }, { managedEstates: estateId }] };
  const security = { role: 'security', estateId };
  const residents = { role: 'resident', estateId };
  const groups = {
    all: [managers, security, residents],
    staff: [managers, security],
    estate_manager: [managers],
    security: [security],
  }[audience] || [managers, security];

  const users = await User.find({
    $or: groups,
    isActive: true,
    email: { $exists: true, $ne: '' },
    _id: { $ne: excludeUserId },
  }).select('name email role').lean();

  // A manager can match both estateId and managedEstates — de-dupe by email.
  const seen = new Set();
  return users.filter((u) => !seen.has(u.email) && seen.add(u.email));
}

// Fire-and-forget: never delay or fail the API response because of email.
function emailAlert(alert, { isBroadcast }) {
  (async () => {
    try {
      const [estate, recipients] = await Promise.all([
        Estate.findById(alert.estateId).select('name').lean(),
        recipientsFor(alert.estateId, alert.audience, alert.residentId?._id || alert.residentId),
      ]);
      if (!recipients.length) return;
      const raiser = alert.residentId || {};
      const { sent } = await sendEmergencyAlertEmails({
        recipients,
        alert,
        estateName: estate?.name || 'your estate',
        isBroadcast,
        raisedBy: {
          name: raiser.name,
          phone: raiser.phone,
          unit: unitLabel(alert.unitId),
          roleLabel: ROLE_LABEL[alert.raisedByRole] || '',
        },
      });
      console.log(`[alert email] ${alert._id} → ${sent ?? 0}/${recipients.length} (${alert.audience})`);
    } catch (e) {
      console.error('[alert email]', e.message);
    }
  })();
}

exports.createAlert = async (req, res) => {
  try {
    const { type: rawType, note, audience, location } = req.body;
    const role = req.user.role || 'resident';
    const type = TYPE_LABEL[rawType] ? rawType : 'security';
    const resolvedAudience = role === 'resident'
      ? (RESIDENT_AUDIENCES.includes(audience) ? audience : 'staff')
      : normalizeAudience(audience);

    const alert = await Alert.create({
      estateId: req.estateId,
      residentId: req.user._id,
      unitId: req.user.unitId,
      type,
      title: TYPE_LABEL[type],
      note: note || '',
      location: location || '',
      severity: DEFAULT_SEVERITY[type],
      status: 'open',
      raisedByRole: role,
      audience: resolvedAudience,
    });
    await alert.populate(POPULATE);

    emitAlert(req.estateId.toString(), alert.toObject());
    if (EMAIL_TYPES.includes(type)) emailAlert(alert, { isBroadcast: false });

    const who = { staff: 'Security and estate management have', security: 'Security has', estate_manager: 'Estate management has', all: 'Everyone has' }[resolvedAudience];
    return res.status(201).json({
      success: true,
      message: `Alert raised. ${who} been notified.`,
      data: alert,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getAlerts = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = { estateId: req.estateId };
    // 'active' = still needs attention (open or acknowledged).
    if (status === 'active') filter.status = { $in: ['open', 'acknowledged'] };
    else if (status) filter.status = status;

    const role = req.user.role;
    if (role === 'resident') {
      filter.$or = [
        { residentId: req.user._id },
        { isEmergencyBroadcast: true, audience: { $in: ['all', null] } },
      ];
    } else if (role === 'security') {
      filter.audience = { $in: ['all', 'staff', 'security', null] };
    } else if (role === 'estate_manager' || role === 'super_admin') {
      filter.audience = { $in: ['all', 'staff', 'estate_manager', null] };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [alerts, total] = await Promise.all([
      Alert.find(filter)
        .populate(POPULATE)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Alert.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: alerts,
      pagination: { total, page: parseInt(page), pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

async function updateStatus(req, res, update, action) {
  try {
    const alert = await Alert.findOneAndUpdate(
      { _id: req.params.id, estateId: req.estateId },
      update,
      { new: true }
    ).populate(POPULATE);

    if (!alert) return res.status(404).json({ success: false, message: 'Alert not found' });

    emitAlert(req.estateId.toString(), {
      ...alert.toObject(),
      action,
      actedBy: { _id: req.user._id, name: req.user.name, role: req.user.role },
    });
    return res.json({ success: true, message: `Alert ${action}`, data: alert });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

exports.acknowledgeAlert = (req, res) =>
  updateStatus(req, res, { status: 'acknowledged', acknowledgedAt: new Date() }, 'acknowledged');

exports.resolveAlert = (req, res) =>
  updateStatus(req, res, { status: 'resolved', resolvedBy: req.user._id, resolvedAt: new Date() }, 'resolved');

exports.broadcastEmergency = async (req, res) => {
  try {
    const { note, type: rawType, title, severity, location, actionRequired, contactNumber, audience } = req.body;
    const type = TYPE_LABEL[rawType] ? rawType : 'security';
    const alert = await Alert.create({
      estateId: req.estateId,
      residentId: req.user._id,
      unitId: req.user.unitId,
      type,
      // Title is optional so older clients that only send type + note work.
      title: (title || '').trim() || TYPE_LABEL[type],
      note,
      severity: severity || DEFAULT_SEVERITY[type] || 'high',
      location: location || '',
      actionRequired: actionRequired || '',
      contactNumber: contactNumber || '',
      status: 'open',
      isEmergencyBroadcast: true,
      raisedByRole: STAFF_ROLES.includes(req.user.role) ? req.user.role : 'security',
      audience: normalizeAudience(audience),
    });
    await alert.populate(POPULATE);

    emitAlert(req.estateId.toString(), alert.toObject());
    emailAlert(alert, { isBroadcast: true });

    return res.status(201).json({ success: true, message: 'Emergency broadcast sent', data: alert });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/alerts/platform-all — super admin, platform-wide
exports.getAllAlertsAdmin = async (req, res) => {
  try {
    const { status, limit = 50 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const alerts = await Alert.find(filter)
      .populate('residentId', 'name phone role profilePhoto')
      .populate('unitId', 'unitNumber block')
      .populate('estateId', 'name estateCode')
      .populate('resolvedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit) || 50, 200))
      .lean();
    return res.json({ success: true, data: alerts });
  } catch (err) {
    console.error('[getAllAlertsAdmin]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
