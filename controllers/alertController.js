const Alert = require('../models/Alert');
const { emitAlert } = require('../services/socketService');

exports.createAlert = async (req, res) => {
  try {
    const { type, note } = req.body;
    const alert = await Alert.create({
      estateId: req.estateId,
      residentId: req.user._id,
      unitId: req.user.unitId,
      type: type || 'security',
      note,
      status: 'open',
    });

    await alert.populate([
      { path: 'residentId', select: 'name phone' },
      { path: 'unitId', select: 'unitNumber block' },
    ]);

    emitAlert(req.estateId.toString(), alert);

    return res.status(201).json({
      success: true,
      message: 'Alert raised. Security has been notified.',
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
    if (status) filter.status = status;

    if (req.user.role === 'resident') {
      filter.$or = [
        { residentId: req.user._id },
        { isEmergencyBroadcast: true },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [alerts, total] = await Promise.all([
      Alert.find(filter)
        .populate('residentId', 'name phone')
        .populate('unitId', 'unitNumber block')
        .populate('resolvedBy', 'name')
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

exports.acknowledgeAlert = async (req, res) => {
  try {
    const alert = await Alert.findOneAndUpdate(
      { _id: req.params.id, estateId: req.estateId },
      { status: 'acknowledged', acknowledgedAt: new Date() },
      { new: true }
    ).populate('residentId', 'name phone').populate('unitId', 'unitNumber block');

    if (!alert) return res.status(404).json({ success: false, message: 'Alert not found' });

    emitAlert(req.estateId.toString(), { ...alert.toObject(), action: 'acknowledged' });
    return res.json({ success: true, message: 'Alert acknowledged', data: alert });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.resolveAlert = async (req, res) => {
  try {
    const alert = await Alert.findOneAndUpdate(
      { _id: req.params.id, estateId: req.estateId },
      { status: 'resolved', resolvedBy: req.user._id, resolvedAt: new Date() },
      { new: true }
    ).populate('residentId', 'name phone').populate('resolvedBy', 'name');

    if (!alert) return res.status(404).json({ success: false, message: 'Alert not found' });

    emitAlert(req.estateId.toString(), { ...alert.toObject(), action: 'resolved' });
    return res.json({ success: true, message: 'Alert resolved', data: alert });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.broadcastEmergency = async (req, res) => {
  try {
    const { note, type, title, severity, location, actionRequired, contactNumber } = req.body;
    const alert = await Alert.create({
      estateId: req.estateId,
      residentId: req.user._id,
      type: type || 'security',
      title: title || '',
      note,
      severity: severity || 'high',
      location: location || '',
      actionRequired: actionRequired || '',
      contactNumber: contactNumber || '',
      status: 'open',
      isEmergencyBroadcast: true,
    });

    await alert.populate('residentId', 'name');
    emitAlert(req.estateId.toString(), { ...alert.toObject(), isEmergencyBroadcast: true });

    return res.status(201).json({ success: true, message: 'Emergency broadcast sent', data: alert });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
