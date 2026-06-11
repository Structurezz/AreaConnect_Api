const User    = require('../models/User');
const Unit    = require('../models/Unit');
const Estate  = require('../models/Estate');
const bcrypt  = require('bcryptjs');
const { sendInviteEmail } = require('../services/emailService');

// ── Helpers ───────────────────────────────────────────────────────────────────

const genTempPassword = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = 'Estate@';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};

const residentsLoginUrl = () =>
  `${process.env.RESIDENTS_URL || process.env.CLIENT_URL || 'http://localhost:5180'}/login`;

// ── List ──────────────────────────────────────────────────────────────────────

exports.getResidents = async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const filter = { estateId: req.estateId, role: 'resident' };

    if (search) {
      filter.$or = [
        { name:  { $regex: search, $options: 'i' } },
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

// ── Single invite ─────────────────────────────────────────────────────────────
// Creates the account immediately + emails login credentials via Resend.

exports.inviteResident = async (req, res) => {
  try {
    const { email, name, phone, unitId } = req.body;
    const estate = await Estate.findById(req.estateId);

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    // Validate unit capacity before creating the account
    if (unitId) {
      const unit = await Unit.findOne({ _id: unitId, estateId: req.estateId });
      if (unit && unit.residentIds.length >= (unit.maxOccupants || 7)) {
        return res.status(400).json({ success: false, message: `Apartment is full (max ${unit.maxOccupants || 7} occupants)` });
      }
    }

    const tempPassword = genTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const resident = await User.create({
      name,
      email: email.toLowerCase(),
      phone: phone || '',
      passwordHash,
      role: 'resident',
      estateId: req.estateId,
      isActive: true,
      unitId: unitId || null,
    });

    if (unitId) {
      await Unit.findByIdAndUpdate(unitId, {
        $addToSet: { residentIds: resident._id },
        status: 'occupied',
      });
    }

    await sendInviteEmail({
      to: email.toLowerCase(),
      name,
      estateName: estate.name,
      loginUrl: residentsLoginUrl(),
      tempPassword,
    });

    return res.json({
      success: true,
      message: `Invitation sent to ${email}`,
    });
  } catch (err) {
    console.error('[inviteResident]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Bulk invite ───────────────────────────────────────────────────────────────
// Body: { residents: [{ name, email, phone?, unitNumber? }] }
// unitNumber is matched against existing units in this estate.

exports.bulkInviteResidents = async (req, res) => {
  try {
    const { residents: list } = req.body;
    if (!Array.isArray(list) || list.length === 0) {
      return res.status(400).json({ success: false, message: 'Provide a residents array' });
    }
    if (list.length > 100) {
      return res.status(400).json({ success: false, message: 'Maximum 100 residents per bulk invite' });
    }

    const estate = await Estate.findById(req.estateId);
    const loginUrl = residentsLoginUrl();

    // Pre-load all units for this estate to avoid N+1 lookups
    const allUnits = await Unit.find({ estateId: req.estateId });
    const unitByNumber = {};
    allUnits.forEach(u => { unitByNumber[u.unitNumber.toUpperCase()] = u; });

    const results = { sent: [], skipped: [], failed: [] };

    for (const item of list) {
      const email      = (item.email      || '').toLowerCase().trim();
      const name       = (item.name       || '').trim();
      const unitNumber = (item.unitNumber || '').toUpperCase().trim();

      if (!email || !name) { results.skipped.push({ email, reason: 'Missing name or email' }); continue; }

      try {
        const existing = await User.findOne({ email });
        if (existing) { results.skipped.push({ email, reason: 'Already registered' }); continue; }

        // Resolve unit
        let resolvedUnit = null;
        if (unitNumber) {
          resolvedUnit = unitByNumber[unitNumber];
          if (!resolvedUnit) {
            results.skipped.push({ email, reason: `Apartment "${unitNumber}" not found` });
            continue;
          }
          if (resolvedUnit.residentIds.length >= (resolvedUnit.maxOccupants || 7)) {
            results.skipped.push({ email, reason: `Apartment "${unitNumber}" is full` });
            continue;
          }
        }

        const tempPassword = genTempPassword();
        const passwordHash = await bcrypt.hash(tempPassword, 12);

        const resident = await User.create({
          name,
          email,
          phone: item.phone || '',
          passwordHash,
          role: 'resident',
          estateId: req.estateId,
          isActive: true,
          unitId: resolvedUnit ? resolvedUnit._id : null,
        });

        if (resolvedUnit) {
          resolvedUnit.residentIds.push(resident._id);
          resolvedUnit.status = 'occupied';
          await resolvedUnit.save();
        }

        await sendInviteEmail({ to: email, name, estateName: estate.name, loginUrl, tempPassword });
        results.sent.push({ email, name, unit: unitNumber || null });
      } catch (e) {
        console.error('[bulkInvite] error for', email, e.message);
        results.failed.push({ email, reason: 'Internal error' });
      }
    }

    return res.json({
      success: true,
      message: `Sent ${results.sent.length}, skipped ${results.skipped.length}, failed ${results.failed.length}`,
      data: results,
    });
  } catch (err) {
    console.error('[bulkInviteResidents]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Direct add (no email sent) ────────────────────────────────────────────────

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

// ── Suspend / Activate ────────────────────────────────────────────────────────

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

// ── Assign unit ───────────────────────────────────────────────────────────────

exports.assignUnit = async (req, res) => {
  try {
    const { unitId } = req.body;

    const unit = await Unit.findOne({ _id: unitId, estateId: req.estateId });
    if (!unit) return res.status(404).json({ success: false, message: 'Unit not found' });
    if (unit.residentIds.length >= (unit.maxOccupants || 7)) {
      return res.status(400).json({ success: false, message: `Unit is full (max ${unit.maxOccupants || 7} occupants)` });
    }

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

    const updated = await User.findByIdAndUpdate(req.params.id, { unitId }, { new: true });
    await Unit.findByIdAndUpdate(unitId, {
      $addToSet: { residentIds: resident._id },
      status: 'occupied',
    });

    return res.json({ success: true, data: updated.toSafeObject() });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
