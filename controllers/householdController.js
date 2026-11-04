// Households: a resident (the household head, onboarded by the estate manager)
// adds family members to their unit and decides what each one can use.
// Access rules live in utils/householdAccess and are enforced by authenticate().
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User   = require('../models/User');
const Unit   = require('../models/Unit');
const Estate = require('../models/Estate');
const { PERMISSIONS, RELATIONSHIPS, PRESETS, cleanPermissions } = require('../utils/householdAccess');
const { sendHouseholdInviteEmail } = require('../services/emailService');
const { emitNotification } = require('../services/socketService');

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
  isActive: u.isActive,
  lastSeen: u.lastSeen,
  createdAt: u.createdAt,
  pendingFirstLogin: !hasSignedIn(u),
});

const unitLabel = (unit) => unit ? [unit.block && `Block ${unit.block}`, unit.unitNumber && `Unit ${unit.unitNumber}`].filter(Boolean).join(', ') : '';

const cleanRelationship = (r) => {
  const v = String(r || '').trim();
  return RELATIONSHIPS.includes(v) ? v : (v ? 'Other' : '');
};

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
  const member = await User.findOne({ _id: req.params.id, householdHead: req.user._id, householdRole: 'member', role: 'resident' });
  if (!member) res.status(404).json({ success: false, message: 'Family member not found' });
  return member;
};

exports.getOptions = (req, res) => res.json({
  success: true,
  data: { permissions: PERMISSIONS, relationships: RELATIONSHIPS, presets: PRESETS, maxMembers: MAX_MEMBERS },
});

// Head: their family members. Member: the head plus everyone else in the home.
exports.list = async (req, res) => {
  try {
    const isMember = req.user.householdRole === 'member';
    const headId = isMember ? req.user.householdHead : req.user._id;
    const [head, members] = await Promise.all([
      User.findById(headId).select('name email phone profilePhoto lastSeen createdAt').lean(),
      User.find({ householdHead: headId, householdRole: 'member', role: 'resident', estateId: req.estateId })
        .sort({ createdAt: 1 }).lean(),
    ]);
    const unit = req.user.unitId ? await Unit.findById(req.user.unitId).select('unitNumber block maxOccupants residentIds').lean() : null;
    return res.json({
      success: true,
      data: {
        isHead: !isMember,
        head: head ? { _id: head._id, name: head.name, email: head.email, phone: head.phone, profilePhoto: head.profilePhoto } : null,
        members: members.map(publicMember),
        unit: unit ? { _id: unit._id, label: unitLabel(unit), occupants: unit.residentIds?.length || 0, maxOccupants: unit.maxOccupants || 7 } : null,
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
    const name  = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').trim();
    const relationship = cleanRelationship(req.body.relationship);
    const permissions  = cleanPermissions(req.body.permissions);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Name and a valid email are required' });
    }
    if (!req.user.unitId) {
      return res.status(400).json({ success: false, message: 'Your account needs a unit before you can add family members' });
    }
    if (await User.exists({ email })) {
      return res.status(409).json({ success: false, message: 'That email already has an AreaConnect account' });
    }
    const count = await User.countDocuments({ householdHead: req.user._id, householdRole: 'member', isActive: true });
    if (count >= MAX_MEMBERS) {
      return res.status(400).json({ success: false, message: `A household can have up to ${MAX_MEMBERS} family members` });
    }
    const unit = await Unit.findOne({ _id: req.user.unitId, estateId: req.estateId });
    if (!unit) return res.status(404).json({ success: false, message: 'Your unit could not be found' });
    if (unit.residentIds.length >= (unit.maxOccupants || 7)) {
      return res.status(400).json({ success: false, message: `Your home is full (max ${unit.maxOccupants || 7} occupants). Ask your estate manager to raise the limit.` });
    }

    const tempPassword = genTempPassword();
    const member = await User.create({
      name, email, phone,
      passwordHash: await bcrypt.hash(tempPassword, 12),
      role: 'resident',
      estateId: req.estateId,
      unitId: unit._id,
      householdRole: 'member',
      householdHead: req.user._id,
      relationship,
      householdPermissions: permissions,
      invitedBy: req.user._id,
      mustChangePassword: true,
      isActive: true,
    });
    await Unit.updateOne({ _id: unit._id }, { $addToSet: { residentIds: member._id }, status: 'occupied' });

    const estate = await Estate.findById(req.estateId).select('name').lean();
    let emailed = true;
    try {
      await sendHouseholdInviteEmail({
        to: email, name, estateName: estate?.name, headName: req.user.name, relationship,
        unitLabel: unitLabel(unit), permissions: permissions.map(p => PERMISSIONS[p].label),
        loginUrl: residentsLoginUrl(), tempPassword,
      });
    } catch (e) {
      emailed = false;
      console.error('[household invite email]', email, e.message);
    }

    try {
      emitNotification(req.estateId, {
        id: member._id.toString(),
        type: 'new_resident',
        title: 'Family member added',
        body: `${req.user.name} added ${name}${relationship ? ` (${relationship.toLowerCase()})` : ''} to ${unitLabel(unit) || 'their home'}`,
        meta: { residentId: member._id },
      }, req.user._id);
    } catch (e) { console.error('[notify household invite]', e.message); }

    return res.status(201).json({
      success: true,
      data: publicMember(member.toObject()),
      emailed,
      message: emailed ? `Invite sent to ${email}` : 'Account created, but the invite email failed. Resend it from your household list.',
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

exports.resendInvite = async (req, res) => {
  try {
    const member = await findMember(req, res);
    if (!member) return;
    const tempPassword = genTempPassword();
    member.passwordHash = await bcrypt.hash(tempPassword, 12);
    member.mustChangePassword = true;
    member.refreshToken = null;
    member.lastSeen = member.createdAt; // back to 'invite pending' until they sign in
    await member.save();
    const [estate, unit] = await Promise.all([
      Estate.findById(req.estateId).select('name').lean(),
      Unit.findById(member.unitId).select('unitNumber block').lean(),
    ]);
    await sendHouseholdInviteEmail({
      to: member.email, name: member.name, estateName: estate?.name, headName: req.user.name,
      relationship: member.relationship, unitLabel: unitLabel(unit),
      permissions: member.householdPermissions.map(p => PERMISSIONS[p]?.label).filter(Boolean),
      loginUrl: residentsLoginUrl(), tempPassword,
    });
    return res.json({ success: true, message: `New login details sent to ${member.email}` });
  } catch (err) {
    console.error('[household resend]', err.message);
    return res.status(500).json({ success: false, message: 'Could not resend the invite' });
  }
};

exports.remove = async (req, res) => {
  try {
    const member = await findMember(req, res);
    if (!member) return;
    // Soft-remove (same as team members): their posts keep a valid author, they
    // can't sign in, they leave the unit, and the email is free to use again.
    if (member.unitId) await Unit.updateOne({ _id: member.unitId }, { $pull: { residentIds: member._id } });
    await User.updateOne({ _id: member._id }, {
      $set: {
        isActive: false, estateId: null, householdPermissions: [], refreshToken: null,
        email: `removed-${member._id}-${member.email}`,
      },
      $unset: { unitId: '' },
    });
    return res.json({ success: true, message: `${member.name} was removed from your household` });
  } catch (err) {
    console.error('[household remove]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
