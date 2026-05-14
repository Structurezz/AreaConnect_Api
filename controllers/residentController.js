const User = require('../models/User');
const Unit = require('../models/Unit');
const { sendInviteEmail } = require('../services/emailService');
const bcrypt = require('bcryptjs');

exports.getResidents = async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const filter = { estateId: req.estateId, role: 'resident' };

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [residents, total] = await Promise.all([
      User.find(filter)
        .populate('unitId', 'unitNumber block type')
        .select('-passwordHash -refreshToken')
        .sort({ name: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      User.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: residents,
      pagination: { total, page: parseInt(page), pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.inviteResident = async (req, res) => {
  try {
    const { email, name, phone, unitId } = req.body;
    const estate = await require('../models/Estate').findById(req.estateId);

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const inviteUrl = `${process.env.CLIENT_URL}/invite/${estate.estateCode}`;
    await sendInviteEmail({ to: email, name, estateCode: estate.estateCode, estateName: estate.name, inviteUrl });

    return res.json({
      success: true,
      message: `Invitation sent to ${email}`,
      data: { estateCode: estate.estateCode, inviteUrl },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.addResident = async (req, res) => {
  try {
    const { name, email, phone, password, unitId } = req.body;

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ success: false, message: 'Email already exists' });

    const passwordHash = await bcrypt.hash(password || 'Estate@123', 12);
    const resident = await User.create({
      name, email, phone,
      passwordHash,
      role: 'resident',
      estateId: req.estateId,
      unitId: unitId || null,
    });

    if (unitId) {
      const unit = await Unit.findOne({ _id: unitId, estateId: req.estateId });
      if (unit) {
        if (unit.residentIds.length >= (unit.maxOccupants || 7)) {
          return res.status(400).json({ success: false, message: `Unit is full (max ${unit.maxOccupants || 7} occupants)` });
        }
        await Unit.findByIdAndUpdate(unitId, {
          $addToSet: { residentIds: resident._id },
          status: 'occupied',
        });
      }
    }

    return res.status(201).json({ success: true, message: 'Resident added', data: resident.toSafeObject() });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.suspendResident = async (req, res) => {
  try {
    const resident = await User.findOneAndUpdate(
      { _id: req.params.id, estateId: req.estateId, role: 'resident' },
      { isActive: false },
      { new: true }
    );
    if (!resident) return res.status(404).json({ success: false, message: 'Resident not found' });
    return res.json({ success: true, message: 'Resident suspended', data: resident.toSafeObject() });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.activateResident = async (req, res) => {
  try {
    const resident = await User.findOneAndUpdate(
      { _id: req.params.id, estateId: req.estateId, role: 'resident' },
      { isActive: true },
      { new: true }
    );
    if (!resident) return res.status(404).json({ success: false, message: 'Resident not found' });
    return res.json({ success: true, message: 'Resident activated', data: resident.toSafeObject() });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.assignUnit = async (req, res) => {
  try {
    const { unitId } = req.body;

    const unit = await Unit.findOne({ _id: unitId, estateId: req.estateId });
    if (!unit) return res.status(404).json({ success: false, message: 'Unit not found' });
    if (unit.residentIds.length >= (unit.maxOccupants || 7)) {
      return res.status(400).json({ success: false, message: `Unit is full (max ${unit.maxOccupants || 7} occupants)` });
    }

    // Remove resident from their old unit first
    const resident = await User.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!resident) return res.status(404).json({ success: false, message: 'Resident not found' });

    if (resident.unitId && !resident.unitId.equals(unitId)) {
      const oldUnit = await Unit.findByIdAndUpdate(
        resident.unitId,
        { $pull: { residentIds: resident._id } },
        { new: true }
      );
      if (oldUnit && oldUnit.residentIds.length === 0) {
        await Unit.findByIdAndUpdate(oldUnit._id, { status: 'vacant' });
      }
    }

    const updated = await User.findByIdAndUpdate(
      req.params.id,
      { unitId },
      { new: true }
    );

    await Unit.findByIdAndUpdate(unitId, {
      $addToSet: { residentIds: resident._id },
      status: 'occupied',
    });

    return res.json({ success: true, data: updated.toSafeObject() });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
