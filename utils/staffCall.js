// Calls between a member and site staff are allowed even when the site has
// neighbour-to-neighbour calling switched off (hospitals, hotels…): a patient
// can call their doctor, a doctor their patient, a guest the front desk.
const User = require('../models/User');
const { roleDef } = require('./siteRoles');

async function staffCallAllowed(user, req, type) {
  // Only placing a call needs this; the directory stays neighbours-only
  if (req.method !== 'POST' || req.path !== '/') return false;
  if (roleDef(type, user.siteRole).staff) return true;
  const calleeId = req.body?.calleeId;
  if (!calleeId) return false;
  const callee = await User.findOne({ _id: calleeId, estateId: user.estateId }).select('siteRole').lean().catch(() => null);
  return !!callee && roleDef(type, callee.siteRole).staff;
}

module.exports = { staffCallAllowed };
