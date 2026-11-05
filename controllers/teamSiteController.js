// People features built on site roles (utils/siteRoles):
//   my team      — a member's care team / adviser / warden / supervisor and
//                  the staff covering their unit; for staff, the people they
//                  look after (assigned + their ward / class / hall)
//   staff list   — directory of staff by role
//   on-call      — staff switch their own on-call status
//   roll-call    — emergency muster: who is safe, who needs help, who's missing
const User = require('../models/User');
const Unit = require('../models/Unit');
const Visitor = require('../models/Visitor');
const RollCall = require('../models/RollCall');
const { siteFor, normType } = require('../utils/siteTypes');
const { rolesFor, roleDef } = require('../utils/siteRoles');
const { shiftState } = require('../utils/siteClock');
const { stayState } = require('../utils/stays');

const isManager = (u) => ['estate_manager', 'super_admin'].includes(u.role);
const typeOf = async (estateId) => normType((await siteFor(estateId))?.site?.type);
const STAFF_FIELDS = 'name phone email profilePhoto siteRole roleInfo unitId shift isActive';
const unitText = (u) => (u ? [u.block, u.unitNumber].filter(Boolean).join(' · ') : '');

const staffCard = (u, type) => ({
  _id: u._id, name: u.name, phone: u.phone, profilePhoto: u.profilePhoto,
  role: roleDef(type, u.siteRole).key, roleLabel: roleDef(type, u.siteRole).label,
  specialty: u.roleInfo?.specialty || '', onCall: !!u.roleInfo?.onCall,
  unit: unitText(u.unitId), shift: shiftState(u.shift),
});

// Staff whose scoped role covers this unit (same unit, or same block)
async function staffCovering(estateId, type, unit) {
  const scoped = rolesFor(type).filter(r => r.staff && r.scoped).map(r => r.key);
  if (!scoped.length || !unit) return [];
  const staff = await User.find({ estateId, isActive: true, siteRole: { $in: scoped } }).select(STAFF_FIELDS).populate('unitId', 'unitNumber block').lean();
  return staff.filter(u => u.unitId && (String(u.unitId._id) === String(unit._id) || (unit.block && u.unitId.block === unit.block)));
}

// GET /api/site/my-team
exports.myTeam = async (req, res) => {
  try {
    const type = await typeOf(req.estateId);
    const me = await User.findById(req.user._id).select('siteRole householdRole householdHead assignedTo unitId').lean();
    const role = roleDef(type, me.siteRole);

    if (!role.staff) {
      // A family member / next of kin sees their household head's team
      const subject = me.householdRole === 'member' && me.householdHead
        ? await User.findById(me.householdHead).select('name assignedTo unitId').lean() : me;
      const unit = subject?.unitId ? await Unit.findById(subject.unitId).select('unitNumber block').lean() : null;
      const [assigned, covering, onCall] = await Promise.all([
        User.find({ _id: { $in: subject?.assignedTo || [] }, isActive: true }).select(STAFF_FIELDS).populate('unitId', 'unitNumber block').lean(),
        staffCovering(req.estateId, type, unit),
        User.find({ estateId: req.estateId, isActive: true, 'roleInfo.onCall': true, siteRole: { $in: rolesFor(type).filter(r => r.onCall).map(r => r.key) } }).select(STAFF_FIELDS).populate('unitId', 'unitNumber block').limit(20).lean(),
      ]);
      const seen = new Set(assigned.map(u => String(u._id)));
      return res.json({
        success: true,
        data: {
          isStaff: false, role: role.key, roleLabel: role.label,
          forName: subject && subject !== me ? subject.name : null,
          unit: unitText(unit),
          assigned: assigned.map(u => staffCard(u, type)),
          covering: covering.filter(u => !seen.has(String(u._id))).map(u => staffCard(u, type)),
          onCall: onCall.map(u => staffCard(u, type)),
        },
      });
    }

    // Staff: the people I look after
    const myUnit = me.unitId ? await Unit.findById(me.unitId).select('unitNumber block').lean() : null;
    const or = [{ assignedTo: req.user._id }];
    if (role.scoped && myUnit) {
      const units = await Unit.find(myUnit.block ? { estateId: req.estateId, block: myUnit.block } : { _id: myUnit._id }).select('_id').lean();
      or.push({ unitId: { $in: units.map(u => u._id) } });
    }
    const staffKeys = rolesFor(type).filter(r => r.staff).map(r => r.key);
    const people = await User.find({
      estateId: req.estateId, role: 'resident', isActive: true, householdRole: { $ne: 'member' },
      siteRole: { $nin: staffKeys }, $or: or,
    }).select('name phone profilePhoto unitId stay memberProfile assignedTo').populate('unitId', 'unitNumber block').sort({ name: 1 }).limit(300).lean();
    const ids = people.map(p => p._id);
    const [kin, inside] = await Promise.all([
      User.find({ householdHead: { $in: ids }, householdRole: 'member', isActive: true }).select('name phone relationship householdHead').lean(),
      Visitor.aggregate([{ $match: { hostResidentId: { $in: ids }, status: 'checked-in' } }, { $group: { _id: '$hostResidentId', n: { $sum: 1 } } }]),
    ]);
    const insideBy = Object.fromEntries(inside.map(v => [String(v._id), v.n]));
    return res.json({
      success: true,
      data: {
        isStaff: true, role: role.key, roleLabel: role.label, onCall: !!req.user.roleInfo?.onCall, canOnCall: role.onCall,
        unit: unitText(myUnit),
        people: people.map(p => ({
          _id: p._id, name: p.name, phone: p.phone, profilePhoto: p.profilePhoto,
          unit: unitText(p.unitId), memberProfile: p.memberProfile || {},
          assignedToMe: (p.assignedTo || []).some(id => String(id) === String(req.user._id)),
          stay: p.stay?.checkIn || p.stay?.checkOut ? { ...p.stay, state: stayState(p) } : null,
          visitorsInside: insideBy[String(p._id)] || 0,
          kin: kin.filter(k => String(k.householdHead) === String(p._id)).map(k => ({ _id: k._id, name: k.name, phone: k.phone, relationship: k.relationship })),
        })),
      },
    });
  } catch (err) {
    console.error('[myTeam]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/site/staff?role=doctor — staff directory (members and managers)
exports.staffList = async (req, res) => {
  try {
    const type = await typeOf(req.estateId);
    const staffKeys = rolesFor(type).filter(r => r.staff).map(r => r.key);
    const keys = req.query.role ? staffKeys.filter(k => k === req.query.role) : staffKeys;
    const staff = await User.find({ estateId: req.estateId, isActive: true, siteRole: { $in: keys } }).select(STAFF_FIELDS).populate('unitId', 'unitNumber block').sort({ name: 1 }).lean();
    // How many members each staff member is assigned (managers balance the load)
    let loads = {};
    if (isManager(req.user)) {
      const agg = await User.aggregate([{ $match: { estateId: req.estateId, assignedTo: { $in: staff.map(s => s._id) } } }, { $unwind: '$assignedTo' }, { $group: { _id: '$assignedTo', n: { $sum: 1 } } }]);
      loads = Object.fromEntries(agg.map(a => [String(a._id), a.n]));
    }
    return res.json({ success: true, data: staff.map(u => ({ ...staffCard(u, type), ...(isManager(req.user) && { assignedCount: loads[String(u._id)] || 0 }) })) });
  } catch (err) {
    console.error('[staffList]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PATCH /api/site/me/on-call { onCall }
exports.setOnCall = async (req, res) => {
  try {
    const type = await typeOf(req.estateId);
    if (!roleDef(type, req.user.siteRole).onCall) return res.status(403).json({ success: false, message: 'Your role has no on-call rota' });
    const onCall = !!req.body.onCall;
    await User.updateOne({ _id: req.user._id }, { $set: { 'roleInfo.onCall': onCall, 'roleInfo.onCallSince': onCall ? new Date() : null } });
    return res.json({ success: true, message: onCall ? "You're on call — emergencies will reach you" : "You're off call", data: { onCall } });
  } catch (err) {
    console.error('[setOnCall]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Roll-call ────────────────────────────────────────────────────────────────
const canRunRollCall = (user, type) => isManager(user) || (user.role === 'resident' && roleDef(type, user.siteRole).rollcall) || user.role === 'security';

async function rollCallView(rc, user, type) {
  const full = canRunRollCall(user, type);
  const answered = new Map(rc.responses.map(r => [String(r.userId), r]));
  const mine = answered.get(String(user._id)) || null;
  const out = {
    _id: rc._id, reason: rc.reason, startedAt: rc.createdAt, endedAt: rc.endedAt,
    expected: rc.expected.length, safe: rc.responses.filter(r => r.status === 'safe').length,
    help: rc.responses.filter(r => r.status === 'help').length,
    missing: rc.expected.filter(id => !answered.has(String(id))).length,
    myResponse: mine, canManage: full,
  };
  if (full) {
    const people = await User.find({ _id: { $in: [...rc.expected, ...rc.responses.map(r => r.userId)] } }).select('name phone profilePhoto siteRole unitId').populate('unitId', 'unitNumber block').lean();
    const card = (u) => ({ _id: u._id, name: u.name, phone: u.phone, profilePhoto: u.profilePhoto, roleLabel: roleDef(type, u.siteRole).label, unit: unitText(u.unitId) });
    const byId = new Map(people.map(p => [String(p._id), p]));
    out.needHelp = rc.responses.filter(r => r.status === 'help').map(r => ({ ...card(byId.get(String(r.userId)) || { _id: r.userId }), note: r.note, at: r.at }));
    out.missingPeople = rc.expected.filter(id => !answered.has(String(id))).map(id => byId.get(String(id))).filter(Boolean).map(card);
    out.safePeople = rc.responses.filter(r => r.status === 'safe').map(r => ({ ...card(byId.get(String(r.userId)) || { _id: r.userId }), at: r.at }));
  }
  return out;
}

function emitRollCall(estateId, payload) {
  const io = require('../services/socketService').getIO();
  if (io) io.to(`estate:${estateId}`).emit('rollcall_update', payload);
}

// POST /api/site/rollcall { reason }
exports.startRollCall = async (req, res) => {
  try {
    const type = await typeOf(req.estateId);
    if (!canRunRollCall(req.user, type)) return res.status(403).json({ success: false, message: "You can't start a roll-call" });
    const open = await RollCall.findOne({ estateId: req.estateId, endedAt: null });
    if (open) return res.status(409).json({ success: false, message: 'A roll-call is already running', data: { _id: open._id } });
    // Everyone expected on site: active members (not off shift, not checked out / not yet arrived) and guards
    const people = await User.find({ estateId: req.estateId, isActive: true, role: { $in: ['resident', 'security'] }, householdStatus: { $ne: 'pending' } })
      .select('shift stay role').lean();
    const now = new Date();
    const expected = people.filter(p => {
      const sh = shiftState(p.shift, now);
      if (sh && !sh.onShift) return false;
      const st = stayState(p, now);
      return st !== 'upcoming' && st !== 'checked_out';
    }).map(p => p._id);
    const rc = await RollCall.create({ estateId: req.estateId, startedBy: req.user._id, reason: String(req.body.reason || '').trim().slice(0, 300), expected });
    const push = require('../services/pushService');
    expected.forEach(id => push.sendToUser(id, { title: '🚨 Emergency roll-call', body: `${rc.reason || 'Evacuation in progress'}. Tap to say you're safe.`, url: '/rollcall', tag: `rollcall-${rc._id}`, requireInteraction: true }, { urgency: 'high', ttl: 3600 }).catch(() => {}));
    emitRollCall(req.estateId, { _id: rc._id, action: 'started', reason: rc.reason });
    return res.status(201).json({ success: true, message: `Roll-call started — ${expected.length} people notified`, data: await rollCallView(rc, req.user, type) });
  } catch (err) {
    console.error('[startRollCall]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/site/rollcall/active
exports.activeRollCall = async (req, res) => {
  try {
    const type = await typeOf(req.estateId);
    const rc = await RollCall.findOne({ estateId: req.estateId, endedAt: null }).sort({ createdAt: -1 });
    return res.json({ success: true, data: rc ? await rollCallView(rc, req.user, type) : null });
  } catch (err) {
    console.error('[activeRollCall]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/site/rollcall/:id/respond { status: safe | help, note }
exports.respondRollCall = async (req, res) => {
  try {
    const type = await typeOf(req.estateId);
    const rc = await RollCall.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!rc) return res.status(404).json({ success: false, message: 'Roll-call not found' });
    if (rc.endedAt) return res.status(409).json({ success: false, message: 'This roll-call has ended' });
    const status = req.body.status === 'help' ? 'help' : 'safe';
    const entry = { userId: req.user._id, status, note: String(req.body.note || '').trim().slice(0, 300), at: new Date() };
    const i = rc.responses.findIndex(r => String(r.userId) === String(req.user._id));
    if (i >= 0) rc.responses[i] = entry; else rc.responses.push(entry);
    if (!rc.expected.some(id => String(id) === String(req.user._id))) rc.expected.push(req.user._id);
    await rc.save();
    emitRollCall(req.estateId, { _id: rc._id, action: 'response', status, userId: req.user._id, name: req.user.name });
    if (status === 'help') {
      // Someone needs help: everyone running the roll-call hears it at once
      const leads = await User.find({ $or: [{ estateId: req.estateId, role: { $in: ['estate_manager', 'security'] } }, { estateId: req.estateId, siteRole: { $in: rolesFor(type).filter(r => r.rollcall).map(r => r.key) } }], isActive: true }).select('_id').lean();
      const push = require('../services/pushService');
      leads.forEach(u => push.sendToUser(u._id, { title: `🆘 ${req.user.name} needs help`, body: entry.note || 'Reported during the roll-call', url: '/rollcall', tag: `rollcall-help-${req.user._id}` }, { urgency: 'high' }).catch(() => {}));
    }
    return res.json({ success: true, message: status === 'safe' ? "Thanks — you're marked safe" : 'Help is being sent to you', data: await rollCallView(rc, req.user, type) });
  } catch (err) {
    console.error('[respondRollCall]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/site/rollcall/:id/end
exports.endRollCall = async (req, res) => {
  try {
    const type = await typeOf(req.estateId);
    if (!canRunRollCall(req.user, type)) return res.status(403).json({ success: false, message: "You can't end the roll-call" });
    const rc = await RollCall.findOneAndUpdate({ _id: req.params.id, estateId: req.estateId, endedAt: null }, { $set: { endedAt: new Date(), endedBy: req.user._id } }, { new: true });
    if (!rc) return res.status(404).json({ success: false, message: 'No running roll-call' });
    emitRollCall(req.estateId, { _id: rc._id, action: 'ended' });
    return res.json({ success: true, message: 'Roll-call ended', data: await rollCallView(rc, req.user, type) });
  } catch (err) {
    console.error('[endRollCall]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
