const Unit = require('../models/Unit');
const User = require('../models/User');
const Payment = require('../models/Payment');
const { withUnitDues } = require('../utils/unitDues');
const { unitCapacity, withCapacity } = require('../utils/unitCapacity');

exports.getUnits = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { estateId: req.estateId };
    if (status) filter.status = status;

    // Residents and guards get the unit list without who lives where or
    // what anyone owes (that's manager-only data)
    if (!['estate_manager', 'super_admin'].includes(req.user.role)) {
      const [plain, cap] = await Promise.all([
        Unit.find(filter).select('unitNumber block type status residentIds placeId restricted').sort({ block: 1, unitNumber: 1 }).lean(),
        unitCapacity(req.estateId),
      ]);
      return res.json({ success: true, data: withCapacity(plain.map(u => ({ ...u, residentIds: u.residentIds.map(String) })), cap), occupantsPerUnit: cap });
    }

    const units = await Unit.find(filter)
      .populate('residentIds', 'name email phone profilePhoto')
      .sort({ block: 1, unitNumber: 1 });

    // Each unit carries its real dues position (see utils/unitDues).
    const [withDues, cap] = await Promise.all([withUnitDues(units, req.estateId), unitCapacity(req.estateId)]);
    return res.json({ success: true, data: withCapacity(withDues, cap), occupantsPerUnit: cap });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.createUnit = async (req, res) => {
  try {
    const { unitNumber, block, type } = req.body;
    const unit = await Unit.create({ estateId: req.estateId, unitNumber, block, type });
    return res.status(201).json({ success: true, data: unit });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Unit number already exists in this estate' });
    }
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.updateUnit = async (req, res) => {
  try {
    const { unitNumber, block, type, duesStatus, amountOwed } = req.body;
    const update = { unitNumber, block, type, duesStatus, amountOwed };
    // Restricted unit (ICU ward…): visitors need the care team's approval
    if (typeof req.body.restricted === 'boolean') update.restricted = req.body.restricted;
    const unit = await Unit.findOneAndUpdate(
      { _id: req.params.id, estateId: req.estateId },
      update,
      { new: true, runValidators: true }
    );
    if (!unit) return res.status(404).json({ success: false, message: 'Unit not found' });
    return res.json({ success: true, data: unit });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.deleteUnit = async (req, res) => {
  try {
    const unit = await Unit.findOneAndDelete({ _id: req.params.id, estateId: req.estateId });
    if (!unit) return res.status(404).json({ success: false, message: 'Unit not found' });
    // Don't leave residents pointing at a unit that no longer exists
    await User.updateMany({ unitId: unit._id }, { $set: { unitId: null } });
    return res.json({ success: true, message: 'Unit deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Payment records for each resident currently in a unit, so the manager can
// see exactly who is owing. Same overdue rule as utils/unitDues.
exports.getUnitPayments = async (req, res) => {
  try {
    const unit = await Unit.findOne({ _id: req.params.id, estateId: req.estateId })
      .populate('residentIds', 'name email phone profilePhoto');
    if (!unit) return res.status(404).json({ success: false, message: 'Unit not found' });

    const residents = (unit.residentIds || []).filter((r) => r?._id);
    const payments = residents.length
      ? await Payment.find({ estateId: req.estateId, residentId: { $in: residents.map((r) => r._id) } })
          .select('residentId amount status method paidAt scheduleId createdAt')
          .populate('scheduleId', 'title type dueDate frequency')
          .sort({ createdAt: -1 })
          .lean()
      : [];

    const now = new Date();
    const data = residents.map((r) => {
      const bills = payments
        .filter((p) => String(p.residentId) === String(r._id))
        .map((p) => {
          const dueDate = p.scheduleId?.dueDate || null;
          const unpaid = p.status === 'pending' || p.status === 'overdue';
          const overdue = unpaid && (p.status === 'overdue' || (dueDate && new Date(dueDate) < now));
          return {
            _id: p._id,
            title: p.scheduleId?.title || 'Bill',
            type: p.scheduleId?.type || null,
            amount: p.amount,
            status: overdue ? 'overdue' : p.status,
            method: p.method,
            dueDate,
            paidAt: p.paidAt,
          };
        });
      const sum = (fn) => bills.filter(fn).reduce((t, b) => t + b.amount, 0);
      return {
        resident: { _id: r._id, name: r.name, email: r.email, phone: r.phone, profilePhoto: r.profilePhoto },
        outstanding: sum((b) => b.status === 'pending' || b.status === 'overdue'),
        overdueAmount: sum((b) => b.status === 'overdue'),
        overdueCount: bills.filter((b) => b.status === 'overdue').length,
        paidTotal: sum((b) => b.status === 'paid'),
        bills,
      };
    });

    // Biggest debtors first
    data.sort((a, b) => b.overdueAmount - a.overdueAmount || b.outstanding - a.outstanding);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[getUnitPayments]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
