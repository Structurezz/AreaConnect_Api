// Role-based alert routing for non-estate sites (utils/siteRoles).
//
// When a member raises an alert it also goes to the site staff who should
// answer it, not only security and the managers:
//   1. the people assigned to them (a patient's doctor and nurse, a student's
//      warden, an employee's supervisor). A family member / next of kin
//      raising it counts as raising it for their household head.
//   2. responders for that alert type in the same unit or block (the ward's
//      nurses, the class teacher, the hall warden, the department supervisor)
//   3. on-call responders anywhere on the site (on-call doctors, clinic,
//      safety officer, duty manager, first aiders)
// If that finds nobody, every responder for the type gets it. If nobody
// responds within ESCALATE_AFTER_MS, every responder and every manager is
// alerted again ("No response yet").
const Alert = require('../models/Alert');
const User = require('../models/User');
const Unit = require('../models/Unit');
const { siteFor, normType } = require('../utils/siteTypes');
const { rolesFor, roleDef } = require('../utils/siteRoles');

const ESCALATE_AFTER_MS = 2 * 60 * 1000;
const kindOf = (alertType) => (['medical', 'security', 'fire'].includes(alertType) ? alertType : 'other');
const ids = (list) => [...new Set(list.filter(Boolean).map(String))];

const place = (unit) => (unit ? [unit.block, unit.unitNumber].filter(Boolean).join(' · ') : '');

function notify(userIds, alert, { title, body }) {
  const { getIO } = require('./socketService');
  const io = getIO();
  const payload = typeof alert.toObject === 'function' ? alert.toObject() : alert;
  if (io) userIds.forEach((id) => io.to(`user:${id}`).emit('new_alert', { ...payload, routed: true }));
  const push = require('./pushService');
  userIds.forEach((id) => push.sendToUser(id, {
    title, body, url: `/alerts?id=${alert._id}`, tag: `alert-${alert._id}`, requireInteraction: true,
  }, { ttl: 600, urgency: 'high' }).catch(() => {}));
}

// Responder role keys for an alert type on this site
const responderRoles = (type, alertType) => rolesFor(type).filter(r => r.responds.includes(kindOf(alertType)));

async function routeAlert(alert) {
  try {
    const estate = await siteFor(alert.estateId);
    const type = normType(estate?.site?.type);
    if (type === 'estate' || alert.isEmergencyBroadcast) return alert;
    const roles = responderRoles(type, alert.type);

    const raiserId = alert.residentId?._id || alert.residentId;
    const raiser = await User.findById(raiserId).select('householdRole householdHead assignedTo unitId siteRole').lean();
    if (!raiser) return alert;
    // Staff raising an alert are responders themselves — route like a member
    const subject = raiser.householdRole === 'member' && raiser.householdHead
      ? (await User.findById(raiser.householdHead).select('assignedTo unitId').lean()) || raiser
      : raiser;
    const unit = subject.unitId ? await Unit.findById(subject.unitId).select('unitNumber block').lean() : null;

    const targets = [];
    // 1. Assigned people
    if (subject.assignedTo?.length) {
      const assigned = await User.find({ _id: { $in: subject.assignedTo }, isActive: true }).select('_id').lean();
      targets.push(...assigned.map(u => u._id));
    }
    // 2. Scoped responders in the same unit / block
    const scoped = roles.filter(r => r.scoped).map(r => r.key);
    if (scoped.length && unit) {
      const staff = await User.find({ estateId: alert.estateId, isActive: true, siteRole: { $in: scoped } })
        .select('unitId').populate('unitId', 'block').lean();
      targets.push(...staff.filter(u => u.unitId && (String(u.unitId._id) === String(unit._id) || (unit.block && u.unitId.block === unit.block))).map(u => u._id));
    }
    // 3. On-call responders
    const onCall = roles.filter(r => r.onCall).map(r => r.key);
    if (onCall.length) {
      const staff = await User.find({ estateId: alert.estateId, isActive: true, siteRole: { $in: onCall }, 'roleInfo.onCall': true }).select('_id').lean();
      targets.push(...staff.map(u => u._id));
    }
    let routed = ids(targets).filter(id => id !== String(raiserId));
    if (!routed.length && roles.length) {
      const all = await User.find({ estateId: alert.estateId, isActive: true, siteRole: { $in: roles.map(r => r.key) } }).select('_id').lean();
      routed = ids(all.map(u => u._id)).filter(id => id !== String(raiserId));
    }
    if (!routed.length) return alert;

    alert.routedTo = routed;
    await Alert.updateOne({ _id: alert._id }, { $set: { routedTo: routed } });
    const who = alert.residentId?.name || 'Someone';
    notify(routed, alert, {
      title: `${alert.title || 'Emergency'}${unit ? ` — ${place(unit)}` : ''}`,
      body: `${who} needs help${alert.location ? ` · ${alert.location}` : ''}${alert.note ? ` · ${alert.note}` : ''}. Tap to respond.`,
    });
    return alert;
  } catch (e) {
    console.error('[alert routing]', e.message);
    return alert;
  }
}

// A routed staff member responds ("On my way", "Arrived", "Can't come")
async function respond(alert, user, status = 'on_my_way') {
  const estate = await siteFor(alert.estateId);
  const role = roleDef(estate?.site?.type, user.siteRole);
  const entry = { userId: user._id, name: user.name, role: role.label, status, at: new Date() };
  const i = (alert.responders || []).findIndex(r => String(r.userId) === String(user._id));
  if (i >= 0) alert.responders[i] = entry; else alert.responders.push(entry);
  if (status !== 'cannot' && alert.status === 'open') { alert.status = 'acknowledged'; alert.acknowledgedAt = new Date(); }
  await alert.save();
  return alert;
}

// Every 30s: open routed alerts nobody has answered → everyone who can help
async function escalateDue(olderThanMs = ESCALATE_AFTER_MS) {
    try {
      const due = await Alert.find({
        status: 'open', escalatedAt: null, 'routedTo.0': { $exists: true },
        createdAt: { $lte: new Date(Date.now() - olderThanMs) },
        responders: { $not: { $elemMatch: { status: { $in: ['on_my_way', 'arrived'] } } } },
      }).populate('residentId', 'name').populate('unitId', 'unitNumber block').limit(50);
      for (const alert of due) {
        const estate = await siteFor(alert.estateId);
        const type = normType(estate?.site?.type);
        const roles = responderRoles(type, alert.type).map(r => r.key);
        const people = await User.find({
          isActive: true,
          $or: [
            { estateId: alert.estateId, siteRole: { $in: roles } },
            { role: { $in: ['estate_manager'] }, $or: [{ estateId: alert.estateId }, { managedEstates: alert.estateId }] },
          ],
        }).select('_id').lean();
        const raiserId = String(alert.residentId?._id || alert.residentId);
        const all = ids([...alert.routedTo, ...people.map(u => u._id)]).filter(id => id !== raiserId);
        alert.routedTo = all;
        alert.escalatedAt = new Date();
        await alert.save();
        notify(all, alert, {
          title: `No response yet: ${alert.title || 'Emergency'}${alert.unitId ? ` — ${place(alert.unitId)}` : ''}`,
          body: `${alert.residentId?.name || 'Someone'} still needs help. Nobody has responded in 2 minutes.`,
        });
        console.log(`[alert routing] escalated ${alert._id} to ${all.length}`);
      }
    } catch (e) { console.error('[alert escalation]', e.message); }
}

function startEscalationSweeper(intervalMs = 30 * 1000) {
  return setInterval(() => escalateDue(), intervalMs);
}

module.exports = { routeAlert, respond, escalateDue, startEscalationSweeper, ESCALATE_AFTER_MS };
