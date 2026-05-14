const Unit = require('../models/Unit');
const User = require('../models/User');

exports.getUnits = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { estateId: req.estateId };
    if (status) filter.status = status;

    const units = await Unit.find(filter)
      .populate('residentIds', 'name email phone profilePhoto')
      .sort({ block: 1, unitNumber: 1 });

    return res.json({ success: true, data: units });
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
    const unit = await Unit.findOneAndUpdate(
      { _id: req.params.id, estateId: req.estateId },
      { unitNumber, block, type, duesStatus, amountOwed },
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
    return res.json({ success: true, message: 'Unit deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
