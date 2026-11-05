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

// Staff who should get a request of this kind from this unit
async function routeFor(estateId, type, kind, unitId) {
  const roleKeys = kind.roles;
  const defs = rolesFor(type).filter(r => roleKeys.includes(r.key));
  const unit = unitId ? await Unit.findById(unitId).select('block').lean() : null;
  const staff = await User.find({ estateId, isActive: true, siteRole: { $in: roleKeys } }).select('siteRole unitId').populate('unitId', 'block').lean();
  const scopedKeys = defs.filter(r => r.scoped).map(r => r.key);
  const inScope = (u) => !scopedKeys.includes(u.siteRole) || !unit
    || (u.unitId && (String(u.unitId._id) === String(unitId) || (unit.block && u.unitId.block === unit.block)));
  let list = staff.filter(inScope);
  if (!list.length) list = staff; // nobody covers this unit — every role holder gets it
  return list.map(u => String(u._id));
}

// POST /api/requests { kind, note }
exports.create = async (req, res) => {
  try {
    const type = await typeOf(req.estateId);
    const kind = requestKind(type, req.body.kind);
    if (!kind) return res.status(400).json({ success: false, message: 'Choose what you need' });
    const note = String(req.body.note || '').trim().slice(0, 1000);
    // A family member asks on behalf of their household (same unit)
    const unitId = req.user.unitId || null;
    const routedTo = (await routeFor(req.estateId, type, kind, unitId)).filter(id => id !== String(req.user._id));
    const request = await ServiceRequest.create({
      estateId: req.estateId, requesterId: req.user._id, unitId, kind: kind.key, note,
      urgent: !!kind.urgent, roles: kind.roles, routedTo,
    });
    await request.populate(POPULATE);
    emit(req.estateId, request, routedTo);
    const push = require('../services/pushService');
    const where = request.unitId ? [request.unitId.block, request.unitId.unitNumber].filter(Boolean).join(' · ') : '';
    routedTo.forEach(id => push.sendToUser(id, {
      title: `${kind.urgent ? '⚠️ ' : ''}${kind.label}${where ? ` — ${where}` : ''}`,
      body: `${req.user.name}${note ? `: ${note}` : ' sent a request'}`,
      url: '/requests', tag: `request-${request._id}`,
    }, { urgency: kind.urgent ? 'high' : 'normal' }).catch(() => {}));
    return res.status(201).json({ success: true, message: routedTo.length ? 'Request sent — staff have been notified' : 'Request sent', data: request });
  } catch (err) {
    console.error('[request create]', err);
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
