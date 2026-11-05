// Deliveries and vehicles logged at the gate (site module 'gatelog').
const GateLog = require('../models/GateLog');

const FIELDS = ['kind', 'vehiclePlate', 'driverName', 'driverPhone', 'company', 'goods', 'destination', 'notes'];
const emit = (estateId, entry) => {
  try { require('../services/socketService').getIO?.()?.to(`estate:${estateId}:security`).to(`estate:${estateId}:staff`).emit('gatelog_update', entry); } catch {}
};

// GET /api/gatelog?open=1&date=YYYY-MM-DD&q=
exports.list = async (req, res) => {
  try {
    const filter = { estateId: req.estateId };
    if (req.query.open === '1') filter.timeOut = null;
    if (req.query.date) {
      const start = new Date(`${req.query.date}T00:00:00+01:00`);
      if (!isNaN(start)) filter.timeIn = { $gte: start, $lt: new Date(start.getTime() + 86400000) };
    }
    if (req.query.q) {
      const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ vehiclePlate: rx }, { driverName: rx }, { company: rx }, { goods: rx }, { destination: rx }];
    }
    const limit = Math.min(200, Number(req.query.limit) || 100);
    const [data, openCount] = await Promise.all([
      GateLog.find(filter).sort({ timeIn: -1 }).limit(limit).populate('loggedBy', 'name').populate('closedBy', 'name').lean(),
      GateLog.countDocuments({ estateId: req.estateId, timeOut: null }),
    ]);
    return res.json({ success: true, data, openCount });
  } catch (err) {
    console.error('[gatelog list]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/gatelog
exports.create = async (req, res) => {
  try {
    const body = {};
    for (const f of FIELDS) if (typeof req.body[f] === 'string') body[f] = req.body[f].trim().slice(0, 200);
    if (!['delivery', 'vehicle'].includes(body.kind)) body.kind = 'delivery';
    if (!body.vehiclePlate && !body.driverName && !body.company) {
      return res.status(400).json({ success: false, message: 'Add a plate number, driver or company' });
    }
    const entry = await GateLog.create({ ...body, estateId: req.estateId, loggedBy: req.user._id, timeIn: new Date() });
    await entry.populate('loggedBy', 'name');
    emit(req.estateId, entry);
    return res.status(201).json({ success: true, message: 'Logged in', data: entry });
  } catch (err) {
    console.error('[gatelog create]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PATCH /api/gatelog/:id/out
exports.markOut = async (req, res) => {
  try {
    const entry = await GateLog.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!entry) return res.status(404).json({ success: false, message: 'Entry not found' });
    if (entry.timeOut) return res.status(409).json({ success: false, message: 'Already logged out' });
    entry.timeOut = new Date();
    entry.closedBy = req.user._id;
    if (typeof req.body.notes === 'string' && req.body.notes.trim()) entry.notes = [entry.notes, req.body.notes.trim()].filter(Boolean).join(' · ');
    await entry.save();
    await entry.populate([{ path: 'loggedBy', select: 'name' }, { path: 'closedBy', select: 'name' }]);
    emit(req.estateId, entry);
    return res.json({ success: true, message: 'Logged out', data: entry });
  } catch (err) {
    console.error('[gatelog out]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
