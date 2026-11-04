// Households: a resident (the household head, onboarded by the estate manager)
// adds family members to their unit and decides what each one can use.
// Access rules live in utils/householdAccess and are enforced by authenticate().
//
// When the estate turns on settings.householdApproval, a head's request waits
// (householdStatus 'pending', no estate/unit, can't sign in) until a manager
// approves it — only then is the invite sent. Managers can also add family
// members to any resident directly.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User   = require('../models/User');
const Unit   = require('../models/Unit');
const Estate = require('../models/Estate');
const { PERMISSIONS, RELATIONSHIPS, PRESETS, cleanPermissions } = require('../utils/householdAccess');
const { sendHouseholdInviteEmail } = require('../services/emailService');
const { emitNotification, getIO } = require('../services/socketService');
const { sendToUser } = require('../services/pushService');
const { unitCapacity } = require('../utils/unitCapacity');

const MAX_MEMBERS = 10;

const residentsLoginUrl = () =>
  `${process.env.RESIDENTS_URL || process.env.CLIENT_URL || 'https://area-mates.areaconnect.pro'}/login`;

const genTempPassword = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = 'Home@';
  for (let i = 0; i < 8; i++) s += chars[crypto.randomInt(chars.length)];
  return s;
};

const hasSignedIn = (u) => !!u.lastSeen && new Date(u.lastSeen) - new Date(u.createdAt) > 5000;

const publicMember = (u) => ({
  _id: u._id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  profilePhoto: u.profilePhoto,
  relationship: u.relationship,
  permissions: u.householdPermissions || [],
  status: u.householdStatus || 'active',
  isActive: u.isActive,
  lastSeen: u.lastSeen,
  createdAt: u.createdAt,
  pendingFirstLogin: u.householdStatus !== 'pending' && !hasSignedIn(u),
});

const unitLabel = (unit) => unit ? [unit.block && `Block ${unit.block}`, unit.unitNumber && `Unit ${unit.unitNumber}`].filter(Boolean).join(', ') : '';

const cleanRelationship = (r) => {
  const v = String(r || '').trim();
  return RELATIONSHIPS.includes(v) ? v : (v ? 'Other' : '');
};

const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ── Notifications ─────────────────────────────────────────────────────────────

function notifyManagers(estateId, notification, pushUrl) {
  try {
    getIO()?.to(`estate:${estateId}:staff`).emit('notification', { ...notification, createdAt: new Date().toISOString() });
  } catch (e) { console.error('[household notify staff]', e.message); }
  User.find({ estateId, role: 'estate_manager', isActive: true }).select('_id').lean()
    .then(ms => ms.forEach(m => sendToUser(m._id, { title: notification.title, body: notification.body, url: pushUrl, tag: `household-${notification.id}` }).catch(() => {})))
    .catch(() => {});
}

function notifyHead(estateId, headId, notification) {
  try { emitNotification(estateId, { ...notification, type: 'household_update' }, headId); } catch (e) { console.error('[household notify head]', e.message); }
  sendToUser(headId, { title: notification.title, body: notification.body, url: '/household', tag: `household-${notification.id}` }).catch(() => {});
}

// ── Shared steps ──────────────────────────────────────────────────────────────

// Can `head` take `extra` more people (active + already-pending requests)?
async function roomCheck(head, extra = 1, byManager = false) {
  const unit = head.unitId ? await Unit.findById(head.unitId) : null;
  if (!unit) return { error: 'The household head needs a unit before family members can be added' };
  const [members, pending] = await Promise.all([
    User.countDocuments({ householdHead: head._id, householdRole: 'member', isActive: true }),
    User.countDocuments({ householdHead: head._id, householdRole: 'member', householdStatus: 'pending' }),
  ]);
  if (members + pending + extra > MAX_MEMBERS) return { error: `A household can have up to ${MAX_MEMBERS} family members` };
  const max = await unitCapacity(head.estateId || unit.estateId);
  if (unit.residentIds.length + pending + extra > max) {
    return { error: `This home is full (max ${max} occupants${pending ? `, including ${pending} awaiting approval` : ''}). ${byManager ? 'Raise the unit\'s occupant limit in Units to add more.' : 'Your estate manager can raise the limit.'}` };
  }
  return { unit };
}

// Read + validate the add-member form
async function readForm(body) {
  const form = {
    name:  String(body.name || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    phone: String(body.phone || '').trim(),
    relationship: cleanRelationship(body.relationship),
    permissions:  cleanPermissions(body.permissions),
  };
  if (!form.name || !isEmail(form.email)) return { error: 'Name and a valid email are required', status: 400 };
  if (await User.exists({ email: form.email })) return { error: 'That email already has an AreaConnect account', status: 409 };
  return { form };
}

// Give a (new or approved) member their login, put them in the head's unit and email them.
async function activateMember(member, head, unit, estateName) {
  const tempPassword = genTempPassword();
  member.passwordHash = await bcrypt.hash(tempPassword, 12);
  member.mustChangePassword = true;
  member.estateId = head.estateId;
  member.unitId = unit._id;
  member.isActive = true;
  member.householdStatus = 'active';
  member.requestedEstateId = null;
  await member.save();
  await Unit.updateOne({ _id: unit._id }, { $addToSet: { residentIds: member._id }, status: 'occupied' });

  try {
    await sendHouseholdInviteEmail({
      to: member.email, name: member.name, estateName, headName: head.name, relationship: member.relationship,
      unitLabel: unitLabel(unit), permissions: member.householdPermissions.map(p => PERMISSIONS[p]?.label).filter(Boolean),
      loginUrl: residentsLoginUrl(), tempPassword,
    });
    return true;
  } catch (e) {
    console.error('[household invite email]', member.email, e.message);
    return false;
  }
}

// ── Resident (household head / member) endpoints ─────────────────────────────

// Only household heads manage a household; members just see who they live with.
const requireHead = (req, res) => {
  if (req.user.householdRole === 'member') {
    res.status(403).json({ success: false, code: 'HOUSEHOLD_HEAD_ONLY', message: 'Only the head of your household can manage family members.' });
    return false;
  }
  return true;
};

const findMember = async (req, res) => {
  if (!requireHead(req, res)) return null;
  const member = await User.findOne({
    _id: req.params.id, householdHead: req.user._id, householdRole: 'member', role: 'resident',
    householdStatus: { $ne: 'rejected' },
  });
  if (!member) res.status(404).json({ success: false, message: 'Family member not found' });
  return member;
};

exports.getOptions = async (req, res) => {
  const estate = await Estate.findById(req.estateId).select('settings.householdApproval').lean().catch(() => null);
  return res.json({
    success: true,
    data: {
      permissions: PERMISSIONS, relationships: RELATIONSHIPS, presets: PRESETS, maxMembers: MAX_MEMBERS,
      requiresApproval: !!estate?.settings?.householdApproval,
    },
  });
};

// Head: their family members. Member: the head plus everyone else in the home.
exports.list = async (req, res) => {
  try {
    const isMember = req.user.householdRole === 'member';
    const headId = isMember ? req.user.householdHead : req.user._id;
    const [head, members] = await Promise.all([
      User.findById(headId).select('name email phone profilePhoto lastSeen createdAt').lean(),
      User.find({
        householdHead: headId, householdRole: 'member', role: 'resident',
        $or: [
          { estateId: req.estateId },
          // the head also sees requests still waiting for the manager
          ...(isMember ? [] : [{ householdStatus: 'pending', requestedEstateId: req.estateId }]),
        ],
      }).sort({ createdAt: 1 }).lean(),
    ]);
    const unit = req.user.unitId ? await Unit.findById(req.user.unitId).select('unitNumber block maxOccupants residentIds').lean() : null;
    return res.json({
      success: true,
      data: {
        isHead: !isMember,
        head: head ? { _id: head._id, name: head.name, email: head.email, phone: head.phone, profilePhoto: head.profilePhoto } : null,
        members: members.map(publicMember),
        unit: unit ? { _id: unit._id, label: unitLabel(unit), occupants: unit.residentIds?.length || 0, maxOccupants: await unitCapacity(req.estateId) } : null,
        myPermissions: isMember ? (req.user.householdPermissions || []) : Object.keys(PERMISSIONS),
      },
    });
  } catch (err) {
    console.error('[household list]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.invite = async (req, res) => {
  try {
    if (!requireHead(req, res)) return;
    const { form, error, status } = await readForm(req.body);
    if (error) return res.status(status).json({ success: false, message: error });
    const room = await roomCheck(req.user);
    if (room.error) return res.status(400).json({ success: false, message: room.error });

    const estate = await Estate.findById(req.estateId).select('name settings.householdApproval').lean();
    // A manager adding their own family doesn't need to approve themselves
    const needsApproval = !!estate?.settings?.householdApproval && req.user.role === 'resident';

    const member = await User.create({
      name: form.name, email: form.email, phone: form.phone,
      // placeholder until the invite goes out (activateMember sets the real one)
      passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10),
      role: 'resident',
      estateId: needsApproval ? null : req.estateId,
      requestedEstateId: needsApproval ? req.estateId : null,
      householdRole: 'member',
      householdHead: req.user._id,
      householdStatus: needsApproval ? 'pending' : 'active',
      relationship: form.relationship,
      householdPermissions: form.permissions,
      invitedBy: req.user._id,
      isActive: false,
    });

    const who = `${form.name}${form.relationship ? ` (${form.relationship.toLowerCase()})` : ''}`;
    const where = unitLabel(room.unit) || 'their home';

    if (needsApproval) {
      notifyManagers(req.estateId, {
        id: member._id.toString(), type: 'household_request',
        title: 'Family member awaiting approval',
        body: `${req.user.name} wants to add ${who} to ${where}`,
        meta: { residentId: member._id, headId: req.user._id },
      }, '/residents?requests=1');
      return res.status(202).json({
        success: true, pending: true, data: publicMember(member.toObject()),
        message: `Request sent. Your estate manager will approve ${form.name.split(' ')[0]} before their invite goes out.`,
      });
    }

    const emailed = await activateMember(member, req.user, room.unit, estate?.name);
    notifyManagers(req.estateId, {
      id: member._id.toString(), type: 'new_resident',
      title: 'Family member added',
      body: `${req.user.name} added ${who} to ${where}`,
      meta: { residentId: member._id },
    }, `/residents/${member._id}`);

    return res.status(201).json({
      success: true,
      data: publicMember(member.toObject()),
      emailed,
      message: emailed ? `Invite sent to ${form.email}` : 'Account created, but the invite email failed. Resend it from your household list.',
    });
  } catch (err) {
    console.error('[household invite]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.update = async (req, res) => {
  try {
    const member = await findMember(req, res);
    if (!member) return;
    if (req.body.permissions !== undefined) member.householdPermissions = cleanPermissions(req.body.permissions);
    if (req.body.relationship !== undefined) member.relationship = cleanRelationship(req.body.relationship);
    if (typeof req.body.name === 'string' && req.body.name.trim()) member.name = req.body.name.trim();
    if (typeof req.body.isActive === 'boolean') {
      if (member.householdStatus === 'pending') {
        return res.status(400).json({ success: false, message: 'This request is still waiting for the estate manager' });
      }
      member.isActive = req.body.isActive;
      if (!req.body.isActive) member.refreshToken = null;
    }
    await member.save();
    return res.json({ success: true, data: publicMember(member.toObject()) });
  } catch (err) {
    console.error('[household update]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// New temp password + email, for members who lost or never got the invite
async function resend(member, head, res) {
  if (member.householdStatus === 'pending') {
    return res.status(400).json({ success: false, message: 'This request is still waiting for the estate manager' });
  }
  const tempPassword = genTempPassword();
  member.passwordHash = await bcrypt.hash(tempPassword, 12);
  member.mustChangePassword = true;
  member.refreshToken = null;
  member.lastSeen = member.createdAt; // back to 'invite pending' until they sign in
  await member.save();
  const [estate, unit] = await Promise.all([
    Estate.findById(member.estateId).select('name').lean(),
    Unit.findById(member.unitId).select('unitNumber block').lean(),
  ]);
  await sendHouseholdInviteEmail({
    to: member.email, name: member.name, estateName: estate?.name, headName: head?.name,
    relationship: member.relationship, unitLabel: unitLabel(unit),
    permissions: member.householdPermissions.map(p => PERMISSIONS[p]?.label).filter(Boolean),
    loginUrl: residentsLoginUrl(), tempPassword,
  });
  return res.json({ success: true, message: `New login details sent to ${member.email}` });
}

exports.resendInvite = async (req, res) => {
  try {
    const member = await findMember(req, res);
    if (!member) return;
    return await resend(member, req.user, res);
  } catch (err) {
    console.error('[household resend]', err.message);
    return res.status(500).json({ success: false, message: 'Could not resend the invite' });
  }
};

// Soft-remove (same as team members): their posts keep a valid author, they
// can't sign in, they leave the unit, and the email is free to use again.
async function softRemove(member, status) {
  if (member.unitId) await Unit.updateOne({ _id: member.unitId }, { $pull: { residentIds: member._id } });
  await User.updateOne({ _id: member._id }, {
    $set: {
      isActive: false, estateId: null, requestedEstateId: null, householdPermissions: [], refreshToken: null,
      email: `removed-${member._id}-${member.email}`,
      ...(status && { householdStatus: status }),
    },
    $unset: { unitId: '' },
  });
}

exports.remove = async (req, res) => {
  try {
    const member = await findMember(req, res);
    if (!member) return;
    const wasPending = member.householdStatus === 'pending';
    await softRemove(member, wasPending ? 'rejected' : null);
    return res.json({ success: true, message: wasPending ? `Request for ${member.name} cancelled` : `${member.name} was removed from your household` });
  } catch (err) {
    console.error('[household remove]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Estate managers who live in the estate head their own household: this sets
// (or changes) the unit they live in, so their family can be added to it.
exports.setHome = async (req, res) => {
  try {
    if (req.user.role !== 'estate_manager') {
      return res.status(403).json({ success: false, message: 'Residents\' units are set by the estate manager' });
    }
    const unit = await Unit.findOne({ _id: req.body.unitId, estateId: req.estateId });
    if (!unit) return res.status(404).json({ success: false, message: 'Unit not found' });
    const me = await User.findById(req.user._id);
    if (String(me.unitId || '') === String(unit._id)) return res.json({ success: true, message: 'That is already your home' });

    const family = await User.find({ householdHead: me._id, householdRole: 'member', estateId: req.estateId }).select('_id unitId');
    const ids = [me._id, ...family.map(f => f._id)];
    const arriving = ids.filter(id => !unit.residentIds.some(r => r.equals(id))).length;
    const cap = await unitCapacity(req.estateId);
    if (unit.residentIds.length + arriving > cap) {
      return res.status(400).json({ success: false, message: `That unit is full (max ${cap} occupants)` });
    }
    const oldUnits = [...new Set([me.unitId, ...family.map(f => f.unitId)].filter(Boolean).map(String))];
    if (oldUnits.length) await Unit.updateMany({ _id: { $in: oldUnits } }, { $pull: { residentIds: { $in: ids } } });
    await User.updateMany({ _id: { $in: ids } }, { unitId: unit._id });
    await Unit.updateOne({ _id: unit._id }, { $addToSet: { residentIds: { $each: ids } }, status: 'occupied' });
    for (const id of oldUnits) {
      const u = await Unit.findById(id).select('residentIds');
      if (u && !u.residentIds.length) await Unit.updateOne({ _id: id }, { status: 'vacant' });
    }
    return res.json({ success: true, message: `Your home is now ${unitLabel(unit)}` });
  } catch (err) {
    console.error('[household set home]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Estate manager endpoints (mounted under /api/residents) ──────────────────

// Family members residents have asked to add, waiting for approval
exports.listRequests = async (req, res) => {
  try {
    const requests = await User.find({ householdStatus: 'pending', requestedEstateId: req.estateId, role: 'resident' })
      .populate({ path: 'householdHead', select: 'name email phone profilePhoto unitId', populate: { path: 'unitId', select: 'unitNumber block maxOccupants residentIds' } })
      .sort({ createdAt: 1 }).lean();
    const cap = await unitCapacity(req.estateId);
    return res.json({
      success: true,
      data: requests.map(m => ({
        ...publicMember(m),
        head: m.householdHead ? {
          _id: m.householdHead._id, name: m.householdHead.name, email: m.householdHead.email, profilePhoto: m.householdHead.profilePhoto,
          unit: m.householdHead.unitId ? { _id: m.householdHead.unitId._id, label: unitLabel(m.householdHead.unitId), occupants: m.householdHead.unitId.residentIds?.length || 0, maxOccupants: cap } : null,
        } : null,
      })),
    });
  } catch (err) {
    console.error('[household requests]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const loadRequest = async (req, res) => {
  const member = await User.findOne({ _id: req.params.id, householdStatus: 'pending', requestedEstateId: req.estateId, role: 'resident' });
  if (!member) { res.status(404).json({ success: false, message: 'Request not found or already handled' }); return {}; }
  const head = await User.findById(member.householdHead);
  return { member, head };
};

exports.approveRequest = async (req, res) => {
  try {
    const { member, head } = await loadRequest(req, res);
    if (!member) return;
    if (!head || !head.isActive || String(head.estateId) !== String(req.estateId)) {
      return res.status(400).json({ success: false, message: 'The household head is no longer active in this estate' });
    }
    // the request itself is one of the pending ones roomCheck counts
    const room = await roomCheck(head, 0, true);
    if (room.error) return res.status(400).json({ success: false, message: room.error });

    const estate = await Estate.findById(req.estateId).select('name').lean();
    const emailed = await activateMember(member, head, room.unit, estate?.name);
    notifyHead(req.estateId, head._id, {
      id: member._id.toString(),
      title: 'Family member approved',
      body: `${member.name} was approved. Their AreaMates invite is on its way.`,
      meta: { residentId: member._id },
    });
    return res.json({
      success: true, emailed,
      message: emailed ? `${member.name} approved and invited` : `${member.name} approved, but the invite email failed. Resend it from their household.`,
    });
  } catch (err) {
    console.error('[household approve]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.rejectRequest = async (req, res) => {
  try {
    const { member, head } = await loadRequest(req, res);
    if (!member) return;
    const reason = String(req.body.reason || '').trim().slice(0, 300);
    await softRemove(member, 'rejected');
    if (head) {
      notifyHead(req.estateId, head._id, {
        id: member._id.toString(),
        title: 'Family member not approved',
        body: `Your request to add ${member.name} wasn't approved${reason ? `: ${reason}` : '. Contact your estate manager for details.'}`,
      });
    }
    return res.json({ success: true, message: `Request for ${member.name} declined` });
  } catch (err) {
    console.error('[household reject]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Manager adds a family member to a resident's household (no approval step)
exports.managerAdd = async (req, res) => {
  try {
    let head = await User.findOne({ _id: req.params.id, estateId: req.estateId, role: 'resident' });
    if (!head) return res.status(404).json({ success: false, message: 'Resident not found' });
    if (head.householdRole === 'member') head = await User.findById(head.householdHead);
    if (!head) return res.status(404).json({ success: false, message: 'Household head not found' });

    const { form, error, status } = await readForm(req.body);
    if (error) return res.status(status).json({ success: false, message: error });
    const room = await roomCheck(head, 1, true);
    if (room.error) return res.status(400).json({ success: false, message: room.error });

    const member = await User.create({
      name: form.name, email: form.email, phone: form.phone,
      passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10),
      role: 'resident',
      estateId: req.estateId,
      householdRole: 'member',
      householdHead: head._id,
      relationship: form.relationship,
      householdPermissions: form.permissions,
      invitedBy: req.user._id,
      isActive: false,
    });
    const estate = await Estate.findById(req.estateId).select('name').lean();
    const emailed = await activateMember(member, head, room.unit, estate?.name);
    notifyHead(req.estateId, head._id, {
      id: member._id.toString(),
      title: 'Family member added',
      body: `The estate manager added ${member.name} to your household. You can change what they can use in My Household.`,
      meta: { residentId: member._id },
    });
    return res.status(201).json({
      success: true, emailed, data: publicMember(member.toObject()),
      message: emailed ? `${member.name} added to ${head.name}'s household and invited` : `${member.name} added, but the invite email failed`,
    });
  } catch (err) {
    console.error('[household manager add]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Manager resends a family member's invite
exports.managerResend = async (req, res) => {
  try {
    const member = await User.findOne({ _id: req.params.id, estateId: req.estateId, role: 'resident', householdRole: 'member' });
    if (!member) return res.status(404).json({ success: false, message: 'Family member not found' });
    const head = await User.findById(member.householdHead).select('name');
    return await resend(member, head, res);
  } catch (err) {
    console.error('[household manager resend]', err.message);
    return res.status(500).json({ success: false, message: 'Could not resend the invite' });
  }
};
