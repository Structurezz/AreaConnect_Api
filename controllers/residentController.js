const User    = require('../models/User');
const Unit    = require('../models/Unit');
const Estate  = require('../models/Estate');
const bcrypt  = require('bcryptjs');
const { sendInviteEmail } = require('../services/emailService');
const { emitNotification } = require('../services/socketService');
const { unitCapacity } = require('../utils/unitCapacity');
const { sectorFields } = require('../utils/memberFields');
const { roleFields } = require('../utils/roleFields');
const { siteFor } = require('../utils/siteTypes');
const { rolesFor, defaultRole, roleDef, FORMS } = require('../utils/siteRoles');

// People allowed per unit come from the estate's plan (utils/unitCapacity)
const capFor = (req) => (req._unitCap ??= unitCapacity(req.estateId));

// ── Helpers ───────────────────────────────────────────────────────────────────

const genTempPassword = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = 'Estate@';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};

// ?site= lets the sign-in page use the site's words (ward, room…) before login
const residentsLoginUrl = (type) =>
  `${process.env.RESIDENTS_URL || process.env.CLIENT_URL || 'http://localhost:5180'}/login${type && type !== 'estate' ? `?site=${type}` : ''}`;

// ── List ──────────────────────────────────────────────────────────────────────

exports.getResidents = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, filter: view, type } = req.query;
    // Family members (added by a household head) are listed separately from
    // the residents the manager onboarded: ?type=family for them.
    const filter = { estateId: req.estateId, role: 'resident', householdRole: type === 'family' ? 'member' : { $ne: 'member' } };
    // Residents with no unit can't sign in — managers need to find them fast
    if (view === 'no_unit') filter.unitId = null;
    // Non-estate sites list staff (doctors, teachers…) and members (patients,
    // students…) separately: ?group=staff | members, or ?role=<siteRole>
    const { group, role: roleKey } = req.query;
    if (group === 'staff' || group === 'members' || roleKey) {
      const siteType = (await siteFor(req.estateId))?.site?.type;
      const staffKeys = rolesFor(siteType).filter(r => r.staff).map(r => r.key);
      if (roleKey) filter.siteRole = roleKey === defaultRole(siteType) ? { $nin: staffKeys } : roleKey;
      else filter.siteRole = group === 'staff' ? { $in: staffKeys } : { $nin: staffKeys };
    }

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
        .populate('householdHead', 'name')
        .populate('assignedTo', 'name siteRole roleInfo profilePhoto')
        .select('-passwordHash -refreshToken')
        .sort({ name: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      User.countDocuments(filter),
    ]);
    const siteType = (await siteFor(req.estateId))?.site?.type;
    const staffKeys = rolesFor(siteType).filter(r => r.staff).map(r => r.key);
    const [staffCount] = await Promise.all([
      staffKeys.length ? User.countDocuments({ estateId: req.estateId, role: 'resident', householdRole: { $ne: 'member' }, siteRole: { $in: staffKeys } }) : 0,
    ]);
    const [noUnitCount, familyCount, residentCount] = await Promise.all([
      User.countDocuments({ estateId: req.estateId, role: 'resident', unitId: null, householdRole: { $ne: 'member' } }),
      User.countDocuments({ estateId: req.estateId, role: 'resident', householdRole: 'member' }),
      User.countDocuments({ estateId: req.estateId, role: 'resident', householdRole: { $ne: 'member' } }),
    ]);

    // How many family members / next of kin each listed head has
    const kinAgg = residents.length && type !== 'family' ? await User.aggregate([
      { $match: { householdHead: { $in: residents.map(r => r._id) }, householdRole: 'member', householdStatus: { $ne: 'rejected' } } },
      { $group: { _id: '$householdHead', n: { $sum: 1 } } },
    ]) : [];
    const kinBy = Object.fromEntries(kinAgg.map(k => [String(k._id), k.n]));
    const data = residents.map(r => ({ ...r.toObject(), kinCount: kinBy[String(r._id)] || 0 }));

    return res.json({
      success: true,
      data,
      noUnitCount,
      familyCount,
      residentCount,
      staffCount,
      memberCount: residentCount - staffCount,
      pagination: { total, page: parseInt(page), pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Get one ───────────────────────────────────────────────────────────────────

exports.getResident = async (req, res) => {
  try {
    const resident = await User.findOne({ _id: req.params.id, estateId: req.estateId, role: 'resident' })
      .populate('unitId', 'unitNumber block type')
      .populate('householdHead', 'name email phone profilePhoto')
      .populate('assignedTo', 'name phone siteRole roleInfo profilePhoto')
      .select('-passwordHash -refreshToken');
    if (!resident) return res.status(404).json({ success: false, message: 'Resident not found' });
    // The family this resident heads (or belongs to)
    const headId = resident.householdRole === 'member' ? resident.householdHead?._id : resident._id;
    const household = headId
      ? await User.find({ householdHead: headId, householdRole: 'member', role: 'resident', estateId: req.estateId })
          .select('name email phone profilePhoto relationship householdPermissions isActive lastSeen createdAt').sort({ createdAt: 1 }).lean()
      : [];
    return res.json({ success: true, data: { ...resident.toObject(), household } });
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
    let extra;
    try { extra = { ...sectorFields(req.body), ...(await roleFields(req.body, req.estateId)) }; } catch (e) { return res.status(e.status || 400).json({ success: false, message: e.message }); }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    // Residents must belong to a unit — they can't sign in without one
    if (!unitId) return res.status(400).json({ success: false, message: 'Choose the unit this resident lives in' });
    const unit = await Unit.findOne({ _id: unitId, estateId: req.estateId });
    if (!unit) return res.status(404).json({ success: false, message: 'Unit not found' });
    if (unit.residentIds.length >= (await capFor(req))) {
      return res.status(400).json({ success: false, message: `This unit is full (max ${await capFor(req)} occupants)` });
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
    if (Object.keys(extra).length) await User.updateOne({ _id: resident._id }, { $set: extra });

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
      loginUrl: residentsLoginUrl(estate?.site?.type),
      tempPassword,
    });

    try {
      emitNotification(req.estateId, {
        id: resident._id.toString(),
        type: 'new_resident',
        title: 'New Resident Added',
        body: `${name} has been invited to ${estate.name}`,
        meta: { residentId: resident._id },
      }, req.user._id);
    } catch (e) { console.error('[notify inviteResident]', e.message); }

    return res.json({
      success: true,
      message: `Invitation sent to ${email}`,
      data: { _id: resident._id, name: resident.name, email: resident.email },
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
    const bulkType = (await siteFor(req.estateId))?.site?.type || 'estate';
    if (!Array.isArray(list) || list.length === 0) {
      return res.status(400).json({ success: false, message: 'Provide a residents array' });
    }
    if (list.length > 100) {
      return res.status(400).json({ success: false, message: 'Maximum 100 residents per bulk invite' });
    }

    const estate = await Estate.findById(req.estateId);
    const loginUrl = residentsLoginUrl(estate?.site?.type);

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

        // Resolve unit — required, residents can't sign in without one
        if (!unitNumber) { results.skipped.push({ email, reason: 'No unit given' }); continue; }
        const resolvedUnit = unitByNumber[unitNumber];
        if (!resolvedUnit) {
          results.skipped.push({ email, reason: `Apartment "${unitNumber}" not found` });
          continue;
        }
        if (resolvedUnit.residentIds.length >= (await capFor(req))) {
          results.skipped.push({ email, reason: `Apartment "${unitNumber}" is full` });
          continue;
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
          // Non-estate sites: the row's role (doctor, nurse…) and ID number
          ...(bulkType !== 'estate' && rolesFor(bulkType).some(r => r.key === item.siteRole) && { siteRole: item.siteRole }),
          ...(typeof (item.memberProfile?.idNumber ?? item.idNumber) === 'string' && { memberProfile: { idNumber: String(item.memberProfile?.idNumber ?? item.idNumber).trim().slice(0, 80) } }),
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
    const { name, phone, password, unitId } = req.body;
    let { email } = req.body;
    let extra;
    try { extra = { ...sectorFields(req.body), ...(await roleFields(req.body, req.estateId)) }; } catch (e) { return res.status(e.status || 400).json({ success: false, message: e.message }); }

    // Members whose role allows it (a patient, a young pupil) can be added
    // without an app login — their next of kin / parents use the app.
    const noLogin = req.body.noLogin === true || req.body.noLogin === 'true';
    if (noLogin) {
      const type = (await siteFor(req.estateId))?.site?.type;
      const form = (FORMS[type] || {})[roleDef(type, extra.siteRole).key];
      if (!form?.emailOptional) return res.status(400).json({ success: false, message: 'An email address is needed for this role' });
      email = `nologin-${require('crypto').randomBytes(8).toString('hex')}@members.areaconnect.invalid`;
    } else if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'A valid email is required' });
    }

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ success: false, message: 'Email already exists' });

    // Residents must belong to a unit — they can't sign in without one
    if (!unitId) return res.status(400).json({ success: false, message: 'Choose the unit this resident lives in' });
    const unit = await Unit.findOne({ _id: unitId, estateId: req.estateId });
    if (!unit) return res.status(404).json({ success: false, message: 'Unit not found' });
    if (unit.residentIds.length >= (await capFor(req))) {
      return res.status(400).json({ success: false, message: `Unit is full (max ${await capFor(req)} occupants)` });
    }

    const passwordHash = await bcrypt.hash(noLogin ? require('crypto').randomBytes(24).toString('hex') : (password || 'Estate@123'), 12);
    const resident = await User.create({
      name, email, phone,
      passwordHash,
      role: 'resident',
      estateId: req.estateId,
      unitId,
    });
    if (Object.keys(extra).length) await User.updateOne({ _id: resident._id }, { $set: extra });
    await Unit.findByIdAndUpdate(unitId, {
      $addToSet: { residentIds: resident._id },
      status: 'occupied',
    });

    // "Doctor added" / "Patient added" on non-estate sites
    const siteType = (await siteFor(req.estateId))?.site?.type;
    const label = siteType && siteType !== 'estate' ? roleDef(siteType, extra.siteRole).label : 'Resident';
    return res.status(201).json({ success: true, message: `${label} added`, data: resident.toSafeObject() });
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

// A household head's family members live wherever the head lives.
async function moveFamily(head, unitId) {
  if (head.householdRole === 'member') return;
  const members = await User.find({ householdHead: head._id, householdRole: 'member', estateId: head.estateId }).select('_id unitId');
  if (!members.length) return;
  const ids = members.map(m => m._id);
  const oldUnits = [...new Set(members.map(m => String(m.unitId || '')).filter(Boolean))];
  if (oldUnits.length) await Unit.updateMany({ _id: { $in: oldUnits } }, { $pull: { residentIds: { $in: ids } } });
  if (unitId) {
    await User.updateMany({ _id: { $in: ids } }, { unitId });
    await Unit.updateOne({ _id: unitId }, { $addToSet: { residentIds: { $each: ids } }, status: 'occupied' });
  } else {
    await User.updateMany({ _id: { $in: ids } }, { $unset: { unitId: '' } });
  }
  for (const id of oldUnits) {
    const u = await Unit.findById(id).select('residentIds');
    if (u && !u.residentIds.length) await Unit.updateOne({ _id: id }, { status: 'vacant' });
  }
}


exports.assignUnit = async (req, res) => {
  try {
    const { unitId } = req.body;

    const resident = await User.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!resident) return res.status(404).json({ success: false, message: 'Resident not found' });

    // Unassign path
    if (!unitId) {
      if (resident.unitId) {
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
        { $unset: { unitId: '' } },
        { new: true }
      );
      await moveFamily(resident, null);
      return res.json({ success: true, data: updated.toSafeObject() });
    }

    // Assign path
    const unit = await Unit.findOne({ _id: unitId, estateId: req.estateId });
    if (!unit) return res.status(404).json({ success: false, message: 'Unit not found' });
    // The head brings their family members along, so they need room too
    const family = resident.householdRole === 'member' ? 0
      : await User.countDocuments({ householdHead: resident._id, householdRole: 'member', estateId: req.estateId });
    const arriving = [resident._id, ...(family ? await User.find({ householdHead: resident._id, householdRole: 'member' }).distinct('_id') : [])]
      .filter(id => !unit.residentIds.some(r => r.equals(id))).length;
    if (unit.residentIds.length + arriving > (await capFor(req))) {
      return res.status(400).json({ success: false, message: `Unit is full (max ${await capFor(req)} occupants${family ? `; this resident's household has ${family + 1} people` : ''})` });
    }

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
    await moveFamily(resident, unitId);

    return res.json({ success: true, data: updated.toSafeObject() });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
