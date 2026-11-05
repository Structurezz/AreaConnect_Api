// A member's care team on a non-estate site: the staff assigned to them plus
// the scoped staff covering their unit / block (ward nurses, class teacher,
// hall warden, department supervisor). Family members resolve to their
// household head.
const User = require('../models/User');
const Unit = require('../models/Unit');
const { rolesFor } = require('./siteRoles');

async function careTeamFor(estateId, type, userId) {
  const me = await User.findById(userId).select('householdRole householdHead assignedTo unitId').lean();
  if (!me) return [];
  const subject = me.householdRole === 'member' && me.householdHead
    ? (await User.findById(me.householdHead).select('assignedTo unitId').lean()) || me : me;
  const ids = new Set((subject.assignedTo || []).map(String));
  const unit = subject.unitId ? await Unit.findById(subject.unitId).select('block').lean() : null;
  const scoped = rolesFor(type).filter(r => r.staff && r.scoped).map(r => r.key);
  if (unit && scoped.length) {
    const staff = await User.find({ estateId, isActive: true, siteRole: { $in: scoped } }).select('unitId').populate('unitId', 'block').lean();
    staff.filter(u => u.unitId && (String(u.unitId._id) === String(subject.unitId) || (unit.block && u.unitId.block === unit.block))).forEach(u => ids.add(String(u._id)));
  }
  ids.delete(String(userId));
  return [...ids];
}

module.exports = { careTeamFor };
