// Estate manager team: invite teammates with limited access (utils/teamAccess).
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User   = require('../models/User');
const Estate = require('../models/Estate');
const { AREAS, PRESETS, cleanPermissions } = require('../utils/teamAccess');
const { sendTeamInviteEmail } = require('../services/emailService');

const MANAGER_APP_URL = process.env.ESTATE_MANAGER_URL || 'https://area-connector.areaconnect.pro';

const genTempPassword = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = 'Team@';
  for (let i = 0; i < 8; i++) s += chars[crypto.randomInt(chars.length)];
  return s;
};

const hasSignedIn = (u) => !!u.lastSeen && new Date(u.lastSeen) - new Date(u.createdAt) > 5000;

const publicMember = (u, estate) => ({
  _id: u._id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  profilePhoto: u.profilePhoto,
  isActive: u.isActive,
  lastSeen: u.lastSeen,
  createdAt: u.createdAt,
  isOwner: u.teamRole !== 'member',
  isPrimary: String(estate?.managerId || '') === String(u._id),
  permissions: u.teamRole === 'member' ? u.permissions : Object.keys(AREAS),
  // lastSeen starts at account creation and moves on every sign-in
  pendingFirstLogin: u.teamRole === 'member' && !hasSignedIn(u),
  needsPasswordChange: u.teamRole === 'member' && hasSignedIn(u) && !!u.mustChangePassword,
});

// Everyone who manages this estate: owner(s) + invited members
const teamQuery = (estate) => ({
  role: 'estate_manager',
  $or: [
    { estateId: estate._id },
    { managedEstates: estate._id },
    ...(estate.managerId ? [{ _id: estate.managerId }] : []),
  ],
});

exports.getOptions = (req, res) => res.json({ success: true, data: { areas: AREAS, presets: PRESETS } });

exports.list = async (req, res) => {
  try {
    const estate = await Estate.findById(req.estateId).select('name managerId').lean();
    if (!estate) return res.status(404).json({ success: false, message: 'Estate not found' });
    const users = await User.find(teamQuery(estate)).sort({ createdAt: 1 }).lean();
    const data = users.map(u => publicMember(u, estate))
      .sort((a, b) => (b.isPrimary - a.isPrimary) || (b.isOwner - a.isOwner));
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[team list]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.invite = async (req, res) => {
  try {
    const name  = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').trim();
    const permissions = cleanPermissions(req.body.permissions);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Name and a valid email are required' });
    }
    if (!permissions.length) {
      return res.status(400).json({ success: false, message: 'Pick at least one area this person can access' });
    }
    if (await User.exists({ email })) {
      return res.status(409).json({ success: false, message: 'That email already has an AreaConnect account' });
    }

    const estate = await Estate.findById(req.estateId).select('name').lean();
    const tempPassword = genTempPassword();
    const member = await User.create({
      name, email, phone,
      passwordHash: await bcrypt.hash(tempPassword, 12),
      role: 'estate_manager',
      estateId: req.estateId,
      teamRole: 'member',
      permissions,
      invitedBy: req.user._id,
      mustChangePassword: true,
      isActive: true,
    });

    let emailed = true;
    try {
      await sendTeamInviteEmail({
        to: email, name, estateName: estate?.name, inviterName: req.user.name,
        permissions: permissions.map(p => AREAS[p]),
        loginUrl: `${MANAGER_APP_URL}/login`, tempPassword,
      });
    } catch (e) {
      emailed = false;
      console.error('[team invite email]', email, e.message);
    }

    return res.status(201).json({
      success: true,
      data: publicMember(member.toObject(), estate),
      emailed,
      message: emailed ? `Invite sent to ${email}` : `Account created, but the invite email failed — resend it from the team list.`,
    });
  } catch (err) {
    console.error('[team invite]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Only invited members can be changed — owners always keep full access
const findMember = async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) {
    res.status(400).json({ success: false, message: "You can't change your own access" });
    return null;
  }
  const member = await User.findOne({ _id: req.params.id, estateId: req.estateId, role: 'estate_manager', teamRole: 'member' });
  if (!member) res.status(404).json({ success: false, message: 'Team member not found' });
  return member;
};

exports.update = async (req, res) => {
  try {
    const member = await findMember(req, res);
    if (!member) return;
    if (req.body.permissions !== undefined) {
      const permissions = cleanPermissions(req.body.permissions);
      if (!permissions.length) return res.status(400).json({ success: false, message: 'Pick at least one area' });
      member.permissions = permissions;
    }
    if (typeof req.body.isActive === 'boolean') member.isActive = req.body.isActive;
    if (req.body.name) member.name = String(req.body.name).trim();
    await member.save();
    const estate = await Estate.findById(req.estateId).select('managerId').lean();
    return res.json({ success: true, data: publicMember(member.toObject(), estate) });
  } catch (err) {
    console.error('[team update]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// New temp password + email, for members who lost or never got the invite
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
    const estate = await Estate.findById(req.estateId).select('name').lean();
    await sendTeamInviteEmail({
      to: member.email, name: member.name, estateName: estate?.name, inviterName: req.user.name,
      permissions: member.permissions.map(p => AREAS[p]).filter(Boolean),
      loginUrl: `${MANAGER_APP_URL}/login`, tempPassword,
    });
    return res.json({ success: true, message: `New login details sent to ${member.email}` });
  } catch (err) {
    console.error('[team resend]', err.message);
    return res.status(500).json({ success: false, message: 'Could not resend the invite' });
  }
};

exports.remove = async (req, res) => {
  try {
    const member = await findMember(req, res);
    if (!member) return;
    // Soft-remove: their posts/messages keep a valid author, they can't sign
    // in, they drop off the estate, and the email is free to invite again.
    await User.updateOne({ _id: member._id }, {
      $set: {
        isActive: false, estateId: null, permissions: [], refreshToken: null,
        email: `removed-${member._id}-${member.email}`,
      },
    });
    return res.json({ success: true, message: `${member.name} was removed from the team` });
  } catch (err) {
    console.error('[team remove]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
