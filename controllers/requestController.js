// Member requests to site staff (utils/siteRoles REQUEST_KINDS): hotel
// housekeeping / repairs / room service, "call a nurse", hostel repairs, sick
// bay, injury and hazard reports… Each kind goes to the staff roles listed
// for it; nurses, teachers, wardens and supervisors only get requests from
// their own unit or block.
const ServiceRequest = require('../models/ServiceRequest');
const User = require('../models/User');
const Unit = require('../models/Unit');
const { siteFor, normType } = require('../utils/siteTypes');
const { requestKind, roleDef, rolesFor } = require('../utils/siteRoles');

const POPULATE = [
  { path: 'requesterId', select: 'name phone profilePhoto siteRole' },
  { path: 'unitId', select: 'unitNumber block' },
  { path: 'assigneeId', select: 'name siteRole profilePhoto' },
  { path: 'subjectId', select: 'name unitId' },
];
const isManager = (u) => ['estate_manager', 'super_admin'].includes(u.role);
const typeOf = async (estateId) => normType((await siteFor(estateId))?.site?.type);

function emit(estateId, request, userIds) {
  const io = require('../services/socketService').getIO();
  if (!io) return;
  let t = io.to(`estate:${estateId}:staff`);
  for (const id of userIds) t = t.to(`user:${id}`);
  t.emit('request_update', request);
}

const managersOf = async (estateId) => (await User.find({
  role: 'estate_manager', isActive: true, $or: [{ estateId }, { managedEstates: estateId }],
}).select('_id').lean()).map(u => String(u._id));

// Who should get a request of this kind about this person:
//   1. their own assigned staff with a matching role (their doctor) plus the
//      scoped staff covering their unit (the ward's nurses)
//   2. else on-call staff with a matching role
//   3. else everyone with a matching role
// `managers` kinds go to the site's managers.
async function routeFor(estateId, type, kind, subjectId) {
  if (kind.managers) return managersOf(estateId);
  const roleKeys = kind.roles || [];
  if (!roleKeys.length) return [];
  const defs = rolesFor(type).filter(r => roleKeys.includes(r.key));
  const scopedKeys = defs.filter(r => r.scoped).map(r => r.key);
  let subject = subjectId ? await User.findById(subjectId).select('householdRole householdHead assignedTo unitId').lean() : null;
  if (subject?.householdRole === 'member' && subject.householdHead) {
    subject = (await User.findById(subject.householdHead).select('assignedTo unitId').lean()) || subject;
  }
  const unit = subject?.unitId ? await Unit.findById(subject.unitId).select('block').lean() : null;
  const staff = await User.find({ estateId, isActive: true, siteRole: { $in: roleKeys } })
    .select('siteRole unitId roleInfo').populate('unitId', 'block').lean();
  const assigned = new Set((subject?.assignedTo || []).map(String));
  const inScope = (u) => scopedKeys.includes(u.siteRole) && unit && u.unitId
    && (String(u.unitId._id) === String(subject.unitId) || (unit.block && u.unitId.block === unit.block));
  const ids = (list) => [...new Set(list.map(u => String(u._id)))];
  const tier1 = staff.filter(u => assigned.has(String(u._id)) || inScope(u));
  if (tier1.length) return ids(tier1);
  const onCall = staff.filter(u => u.roleInfo?.onCall);
  if (onCall.length) return ids(onCall);
  return ids(staff);
}

const roleLabelOf = (user, type) => (['estate_manager', 'super_admin'].includes(user.role) ? 'Management' : roleDef(type, user.siteRole).label);

function pushAll(ids, payload, urgent) {
  const push = require('../services/pushService');
  ids.forEach(id => push.sendToUser(id, payload, { urgency: urgent ? 'high' : 'normal' }).catch(() => {}));
}

// POST /api/requests { kind, note } — a member asks for help.
// Managers can also send a task to staff: { kind, note, toUserId?, subjectId? }
exports.create = async (req, res) => {
  try {
    const type = await typeOf(req.estateId);
    const kind = requestKind(type, req.body.kind);
    if (!kind) return res.status(400).json({ success: false, message: 'Choose what you need' });
    const note = String(req.body.note || '').trim().slice(0, 1000);
    const manager = isManager(req.user);
    let routedTo, unitId = req.user.unitId || null, subjectId = null;

    if (manager) {
      if (req.body.subjectId) {
        const subject = await User.findOne({ _id: req.body.subjectId, estateId: req.estateId }).select('unitId').lean();
        if (!subject) return res.status(404).json({ success: false, message: 'Person not found' });
        subjectId = subject._id; unitId = subject.unitId || null;
      }
      if (req.body.toUserId) {
        const to = await User.findOne({ _id: req.body.toUserId, estateId: req.estateId, isActive: true }).select('_id').lean();
        if (!to) return res.status(404).json({ success: false, message: 'Staff member not found' });
        routedTo = [String(to._id)];
      } else {
        routedTo = await routeFor(req.estateId, type, kind, subjectId);
      }
    } else {
      // A family member / next of kin asks on behalf of their household head
      routedTo = await routeFor(req.estateId, type, kind, req.user._id);
    }
    routedTo = routedTo.filter(id => id !== String(req.user._id));

    const request = await ServiceRequest.create({
      estateId: req.estateId, requesterId: req.user._id, unitId, kind: kind.key, note,
      urgent: !!kind.urgent, roles: kind.managers ? ['management'] : kind.roles, routedTo,
      fromManager: manager, subjectId,
      messages: note ? [{ userId: req.user._id, name: req.user.name, role: roleLabelOf(req.user, type), text: note }] : [],
    });
    await request.populate(POPULATE);
    emit(req.estateId, request, routedTo);
    const where = request.unitId ? [request.unitId.block, request.unitId.unitNumber].filter(Boolean).join(' · ') : '';
    pushAll(routedTo, {
      title: `${kind.urgent ? '⚠️ ' : ''}${kind.label}${where ? ` — ${where}` : ''}`,
      body: `${req.user.name}${note ? `: ${note}` : ' sent a request'}`,
      url: '/requests', tag: `request-${request._id}`,
    }, kind.urgent);
    return res.status(201).json({ success: true, message: routedTo.length ? `Sent — ${routedTo.length} ${routedTo.length === 1 ? 'person has' : 'people have'} been notified` : 'Request sent', data: request });
  } catch (err) {
    console.error('[request create]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/requests/:id/messages { text } — the requester, the staff it went
// to, the assignee and managers talk on the request.
exports.addMessage = async (req, res) => {
  try {
    const text = String(req.body.text || '').trim().slice(0, 1000);
    if (!text) return res.status(400).json({ success: false, message: 'Write a message' });
    const request = await ServiceRequest.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    const me = String(req.user._id);
    const party = [String(request.requesterId), ...request.routedTo.map(String), request.assigneeId && String(request.assigneeId)].filter(Boolean);
    if (!party.includes(me) && !isManager(req.user)) return res.status(403).json({ success: false, message: "You're not part of this request" });
    const type = await typeOf(req.estateId);
    request.messages.push({ userId: req.user._id, name: req.user.name, role: roleLabelOf(req.user, type), text });
    await request.save();
    await request.populate(POPULATE);
    // Everyone else on the request hears about it (managers too for management requests)
    const kind = requestKind(type, request.kind);
    const others = new Set(party.filter(id => id !== me));
    if (kind?.managers || request.fromManager) (await managersOf(req.estateId)).forEach(id => id !== me && others.add(id));
    emit(req.estateId, request, [...others]);
    pushAll([...others], { title: `${req.user.name} · ${kind?.label || 'Request'}`, body: text, url: '/requests', tag: `request-${request._id}` });
    return res.json({ success: true, data: request });
  } catch (err) {
    console.error('[request message]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/requests?scope=mine|queue|all&status=open|active|done
exports.list = async (req, res) => {
  try {
    const type = await typeOf(req.estateId);
    const staff = req.user.role === 'resident' && roleDef(type, req.user.siteRole).staff;
    const scope = req.query.scope || (isManager(req.user) ? 'all' : staff ? 'queue' : 'mine');
    const filter = { estateId: req.estateId };
    if (scope === 'mine') filter.requesterId = req.user._id;
    else if (scope === 'queue') {
      if (!staff && !isManager(req.user)) return res.status(403).json({ success: false, message: 'Only staff have a request queue' });
      filter.$or = [{ routedTo: req.user._id }, { assigneeId: req.user._id }];
    } else if (!isManager(req.user)) return res.status(403).json({ success: false, message: 'Managers only' });
    if (req.query.status === 'active') filter.status = { $in: ['open', 'accepted'] };
    else if (['open', 'accepted', 'done', 'cancelled'].includes(req.query.status)) filter.status = req.query.status;
    const data = await ServiceRequest.find(filter).sort({ urgent: -1, createdAt: -1 }).limit(100).populate(POPULATE).lean();
    const counts = await ServiceRequest.aggregate([{ $match: { ...filter, status: { $in: ['open', 'accepted'] } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
    return res.json({ success: true, data, scope, counts: Object.fromEntries(counts.map(c => [c._id, c.n])) });
  } catch (err) {
    console.error('[request list]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PATCH /api/requests/:id { status: accepted | done | cancelled, reply? }
exports.update = async (req, res) => {
  try {
    const request = await ServiceRequest.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    const status = req.body.status;
    const mine = String(request.requesterId) === String(req.user._id);
    const routed = request.routedTo.some(id => String(id) === String(req.user._id)) || String(request.assigneeId) === String(req.user._id);
    if (status === 'cancelled') {
      if (!mine && !isManager(req.user)) return res.status(403).json({ success: false, message: 'Only the requester can cancel' });
    } else if (['accepted', 'done'].includes(status)) {
      if (!routed && !isManager(req.user)) return res.status(403).json({ success: false, message: 'This request was not sent to you' });
    } else return res.status(400).json({ success: false, message: 'Unknown status' });
    if (['done', 'cancelled'].includes(request.status)) return res.status(409).json({ success: false, message: `Already ${request.status}` });

    request.status = status;
    if (status === 'accepted') { request.assigneeId = req.user._id; request.acceptedAt = new Date(); }
    if (status === 'done') { request.doneAt = new Date(); if (!request.assigneeId) request.assigneeId = req.user._id; }
    if (typeof req.body.reply === 'string') request.reply = req.body.reply.trim().slice(0, 500);
    await request.save();
    await request.populate(POPULATE);
    emit(req.estateId, request, [...request.routedTo.map(String), String(request.requesterId)]);
    if (!mine && status !== 'cancelled') {
      const type = await typeOf(req.estateId);
      const kind = requestKind(type, request.kind);
      require('../services/pushService').sendToUser(request.requesterId, {
        title: status === 'accepted' ? `${req.user.name} is on it` : `${kind?.label || 'Request'} done`,
        body: request.reply || (status === 'accepted' ? `Your ${(kind?.label || 'request').toLowerCase()} request was accepted.` : 'Your request has been completed.'),
        url: '/requests', tag: `request-${request._id}`,
      }).catch(() => {});
    }
    return res.json({ success: true, message: { accepted: 'Accepted', done: 'Marked done', cancelled: 'Request cancelled' }[status], data: request });
  } catch (err) {
    console.error('[request update]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
