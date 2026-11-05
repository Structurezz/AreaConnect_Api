// Role fields a manager sets on a member: siteRole, specialty, on-call and
// who they're assigned to. Validated against the site's roles
// (utils/siteRoles); assignments must be staff on the same site whose role
// is assignable (a doctor, nurse, lecturer, warden, supervisor…).
const mongoose = require('mongoose');
const User = require('../models/User');
const { rolesFor, roleDef } = require('./siteRoles');
const { siteFor } = require('./siteTypes');

const bad = (message) => { const e = new Error(message); e.status = 400; throw e; };

async function roleFields(body = {}, estateId) {
  const out = {};
  const has = (k) => body[k] !== undefined;
  if (!has('siteRole') && !has('roleInfo') && !has('assignedTo')) return out;
  const type = (await siteFor(estateId))?.site?.type || 'estate';

  if (has('siteRole')) {
    const key = String(body.siteRole || '');
    if (key && !rolesFor(type).some(r => r.key === key)) bad('Unknown role for this site');
    out.siteRole = key;
    // Leaving a staff role clears on-call and the people assigned to them stays as is
    if (!roleDef(type, key).onCall) { out['roleInfo.onCall'] = false; out['roleInfo.onCallSince'] = null; }
  }
  if (body.roleInfo && typeof body.roleInfo === 'object') {
    if (typeof body.roleInfo.specialty === 'string') out['roleInfo.specialty'] = body.roleInfo.specialty.trim().slice(0, 80);
    if (typeof body.roleInfo.onCall === 'boolean') {
      out['roleInfo.onCall'] = body.roleInfo.onCall;
      out['roleInfo.onCallSince'] = body.roleInfo.onCall ? new Date() : null;
    }
  }
  if (has('assignedTo')) {
    const ids = [...new Set((Array.isArray(body.assignedTo) ? body.assignedTo : []).map(String))].filter(id => mongoose.isValidObjectId(id));
    if (ids.length > 10) bad('Assign at most 10 people');
    if (ids.length) {
      const staff = await User.find({ _id: { $in: ids }, estateId, isActive: true }).select('siteRole').lean();
      const ok = staff.filter(u => roleDef(type, u.siteRole).assignable);
      if (ok.length !== ids.length) bad('Only staff such as doctors, nurses, teachers or supervisors can be assigned');
    }
    out.assignedTo = ids;
  }
  return out;
}

module.exports = { roleFields };
