const mongoose = require('mongoose');
const Visitor = require('../models/Visitor');
const User = require('../models/User');
const SecurityLog = require('../models/SecurityLog');
const { generateQRCode, generateVisitorCode } = require('../services/qrService');
const { sendVisitorPass } = require('../services/emailService');
const { sendVisitorCodeSMS } = require('../services/smsService');
const { emitVisitorUpdate, emitEarlyArrival, emitEarlyApproved } = require('../services/socketService');
const { isRestricted, EXEMPT_PURPOSES } = require('../utils/duesEnforcement');

const { passExpiresAt, isPastExpiry, expireOverdue } = require('../utils/passExpiry');
const siteTypes = require('../utils/siteTypes');
const { placeForUnit, publicPlace } = require('../utils/places');
const { withinVisitingHours } = require('../utils/siteClock');

const DETAIL_KEYS = ['studentName', 'studentClass', 'company', 'job', 'goods', 'vehiclePlate', 'patientName', 'ward'];

// Pass category + details from the request, checked against the site type.
async function readCategory(req, estate) {
  const cfg = siteTypes.siteConfig(estate);
  const allowed = cfg.passCategories.map(c => c.key);
  const category = allowed.includes(req.body.category) ? req.body.category : 'guest';
  const raw = req.body.details && typeof req.body.details === 'object' ? req.body.details : {};
  const details = {};
  for (const k of DETAIL_KEYS) if (typeof raw[k] === 'string' && raw[k].trim()) details[k] = raw[k].trim().slice(0, 120);
  if (details.vehiclePlate) details.vehiclePlate = details.vehiclePlate.toUpperCase();

  if (category === 'pickup' && !details.studentName) {
    // A parent (family member) collecting the student they're linked to
    const me = req.user;
    const student = me.householdRole === 'member' && me.householdHead
      ? await User.findById(me.householdHead).select('name unitId memberProfile').populate('unitId', 'unitNumber').lean()
      : null;
    if (!student) { const e = new Error('Name the student being collected'); e.status = 400; throw e; }
    details.studentName = student.name;
    details.studentClass = details.studentClass || student.memberProfile?.className || student.unitId?.unitNumber || '';
  }
  if (category === 'patient_visit' && !details.patientName) { const e = new Error('Name the patient being visited'); e.status = 400; throw e; }
  if (['contractor', 'supplier'].includes(category) && !details.company) { const e = new Error('Add the company name'); e.status = 400; throw e; }
  return { category, details };
}

// What the gate needs to know about this pass beyond valid / not valid.
function gateInfo(visitor, estate, now = new Date(), place = null) {
  const cfg = siteTypes.siteConfig(estate);
  const info = {};
  if (place) info.place = place;
  if (['contractor', 'supplier'].includes(visitor.category) && cfg.inductionText) {
    info.induction = { required: !visitor.inductionAcceptedAt, text: cfg.inductionText, acceptedAt: visitor.inductionAcceptedAt };
  }
  if (cfg.modules.visiting && ['guest', 'patient_visit'].includes(visitor.category || 'guest')) {
    info.visiting = { ...cfg.visitingHours, outside: !withinVisitingHours(cfg.visitingHours, now) };
  }
  return info;
}
const EARLY_GRACE_MIN = 30; // minutes allowed before expectedDate without host approval

/** Generate a unique visitor code (retry on collision) */
const makeUniqueCode = async () => {
  for (let i = 0; i < 5; i++) {
    const code = generateVisitorCode();
    const exists = await Visitor.findOne({ visitorCode: code });
    if (!exists) return code;
  }
  throw new Error('Could not generate unique code');
};

exports.preRegisterVisitor = async (req, res) => {
  try {
    const { visitorName, visitorPhone, visitorEmail, purpose, expectedDuration, notes } = req.body;
    const estateDoc = await siteTypes.siteFor(req.estateId);
    let cat;
    try { cat = await readCategory(req, estateDoc); } catch (e) { return res.status(e.status || 400).json({ success: false, message: e.message }); }
    // Instant pass: the guest is at (or on the way to) the gate — valid from now.
    const instant = req.body.instant === true || req.body.instant === 'true';
    const expectedDate = instant ? new Date() : req.body.expectedDate;
    const estateId = req.estateId;
    const resident = req.user;

    // Dues enforcement: a restricted host's passes wait for manager approval.
    // Medical / emergency visitors always go straight through.
    const held = !EXEMPT_PURPOSES.test(String(purpose || '')) && await isRestricted(resident, 'visitor_passes');

    // Restricted unit (e.g. ICU ward): the host's care team approves visitors
    let careTeam = [];
    if (!held && resident.unitId && estateDoc?.site?.type && estateDoc.site.type !== 'estate') {
      const hostUnit = await require('../models/Unit').findById(resident.unitId).select('restricted').lean();
      const { roleDef } = require('../utils/siteRoles');
      if (hostUnit?.restricted && !roleDef(estateDoc.site.type, resident.siteRole).staff) {
        careTeam = await require('../utils/careTeam').careTeamFor(estateId, estateDoc.site.type, resident._id);
      }
    }
    const wardHold = careTeam.length > 0;

    const visitorCode = await makeUniqueCode();
    const qrCodeUrl = await generateQRCode(visitorCode);

    const visitor = await Visitor.create({
      estateId,
      hostResidentId: resident._id,
      hostUnitId: resident.unitId,
      visitorName,
      visitorPhone,
      visitorEmail,
      purpose,
      expectedDate: new Date(expectedDate),
      expectedDuration: expectedDuration || (instant ? 120 : 60),
      instant,
      earlyEntryApproved: instant || undefined,
      visitorCode,
      qrCodeUrl,
      notes,
      category: cat.category,
      details: cat.details,
      status: held || wardHold ? 'pending' : 'active',
      awaitingApproval: held || wardHold,
      approvalBy: wardHold ? 'care_team' : 'management',
      approverIds: wardHold ? careTeam : [],
    });

    await visitor.populate('hostResidentId', 'name unitId');

    if (held) {
      notifyManagersOfHeldPass(visitor, resident).catch((e) => console.error('[held pass notify]', e.message));
      return res.status(201).json({
        success: true,
        held: true,
        message: 'Pass created and sent to estate management for approval because of overdue estate bills. Your visitor gets their code once it is approved.',
        data: visitor,
      });
    }

    if (wardHold) {
      const push = require('../services/pushService');
      careTeam.forEach(id => push.sendToUser(id, {
        title: 'Visitor needs your approval', body: `${resident.name} invited ${visitor.visitorName} to a restricted ward.`,
        url: `/visitors/${visitor._id}`, tag: `pass-${visitor._id}`,
      }).catch(() => {}));
      return res.status(201).json({
        success: true, held: true, approvalBy: 'care_team',
        message: 'This is a restricted ward, so the pass has gone to the care team for approval. Your visitor gets their code once it is approved.',
        data: visitor,
      });
    }

    await sendPassToVisitor(visitor, resident.name);

    return res.status(201).json({
      success: true,
      message: 'Visitor pre-registered successfully',
      data: visitor,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Email / SMS the code to the visitor (non-blocking)
async function sendPassToVisitor(visitor, hostName) {
  const { visitorName, visitorPhone, visitorEmail, visitorCode, qrCodeUrl, expectedDate } = visitor;
  const estate = await require('../models/Estate').findById(visitor.estateId).select('name');
  const estateName = estate?.name || 'Estate';
  const place = publicPlace(await placeForUnit(visitor.hostUnitId?._id || visitor.hostUnitId).catch(() => null));

  if (visitorEmail) {
    sendVisitorPass({ to: visitorEmail, visitorName, hostName, code: visitorCode, qrCodeUrl, expectedDate, estateName, place })
      .catch(console.error);
  }
  if (visitorPhone) {
    sendVisitorCodeSMS({ to: visitorPhone, visitorName, code: visitorCode, estateName, expectedDate, place })
      .catch(console.error);
  }
}

async function notifyManagersOfHeldPass(visitor, host) {
  const { sendToUser } = require('../services/pushService');
  const { sendManagerNotificationEmail } = require('../services/emailService');
  const [estate, managers] = await Promise.all([
    require('../models/Estate').findById(visitor.estateId).select('name'),
    User.find({ estateId: visitor.estateId, role: 'estate_manager', isActive: true }).select('name email'),
  ]);
  const when = new Date(visitor.expectedDate).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  emitVisitorUpdate(String(visitor.estateId), visitor);
  managers.forEach((m) => {
    sendToUser(m._id, { title: 'Visitor pass needs approval', body: `${host.name} invited ${visitor.visitorName} (${when})`, url: '/visitors?status=pending', tag: `pass-${visitor._id}` }).catch(() => {});
    if (m.email) {
      sendManagerNotificationEmail({
        to: m.email, managerName: m.name, estateName: estate?.name || 'Your estate', type: 'visitor_approval',
        title: `${host.name} invited ${visitor.visitorName}`,
        body: `Expected ${when}. ${host.name}'s visitor passes need approval because of overdue estate bills. Approve or decline it on the Visitors page.`.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])),
      }).catch((e) => console.error('[held pass email]', e.message));
    }
  });
}

// POST /visitors/:id/approve-pass — manager releases a pass held for dues
exports.approvePass = async (req, res) => {
  try {
    const visitor = await Visitor.findOne({ _id: req.params.id, estateId: req.estateId }).populate('hostResidentId', 'name');
    if (!visitor) return res.status(404).json({ success: false, message: 'Visitor not found' });
    if (visitor.status !== 'pending' || !visitor.awaitingApproval) {
      return res.status(409).json({ success: false, message: 'This pass is not waiting for approval' });
    }
    // Site staff (doctor, nurse…) approve passes held for the care team only
    if (req.user.role === 'resident') {
      const estateDoc = await siteTypes.siteFor(req.estateId);
      const team = visitor.approvalBy === 'care_team'
        ? await require('../utils/careTeam').careTeamFor(req.estateId, estateDoc?.site?.type, visitor.hostResidentId?._id || visitor.hostResidentId) : [];
      if (!team.includes(String(req.user._id))) return res.status(403).json({ success: false, message: "Only the patient's care team can approve this pass" });
    }
    visitor.status = 'active';
    visitor.awaitingApproval = false;
    visitor.approvedBy = req.user._id;
    visitor.approvedAt = new Date();
    await visitor.save();
    sendPassToVisitor(visitor, visitor.hostResidentId?.name || 'Your host').catch(console.error);
    emitVisitorUpdate(String(visitor.estateId), visitor);
    require('../services/pushService').sendToUser(visitor.hostResidentId?._id, {
      title: 'Visitor pass approved', body: `${visitor.visitorName}'s pass is approved and has been sent to them.`, url: `/visitors/${visitor._id}`, tag: `pass-${visitor._id}`,
    }).catch(() => {});
    return res.json({ success: true, message: 'Pass approved and sent to the visitor', data: visitor });
  } catch (err) {
    console.error('[approvePass]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getVisitors = async (req, res) => {
  try {
    const estateId = req.estateId;
    const { status, date, unit, page = 1, limit = 20 } = req.query;
    const search = String(req.query.search || req.query.q || '').trim().slice(0, 60);
    const oid = (v) => new mongoose.Types.ObjectId(String(v));

    // Base = everything this user may see (+ search); status narrows the list
    // but not the per-status counts, so filter chips can show their totals.
    // Passes whose window has closed are expired before the list is read
    await expireOverdue({ estateId: oid(estateId) }).catch(() => {});
    const base = { estateId: oid(estateId) };
    if (unit && mongoose.isValidObjectId(unit)) base.hostUnitId = oid(unit);
    if (date) {
      const d = new Date(date);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      base.expectedDate = { $gte: d, $lt: next };
    }
    // Residents see only their own visitors; care-team staff can list the
    // passes waiting for their approval (?approvals=1)
    if (req.user.role === 'resident' && req.query.approvals === '1') {
      Object.assign(base, { approverIds: oid(req.user._id), approvalBy: 'care_team', status: 'pending', awaitingApproval: true });
    } else if (req.user.role === 'resident') base.hostResidentId = oid(req.user._id);
    // Staff can narrow to one resident's visitors (resident profile page)
    else if (req.query.host && mongoose.isValidObjectId(req.query.host)) base.hostResidentId = oid(req.query.host);
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      base.$or = [{ visitorName: re }, { visitorPhone: re }, { visitorCode: re }, { purpose: re }];
    }
    const filter = { ...base };
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [visitors, total] = await Promise.all([
      Visitor.find(filter)
        .populate('hostResidentId', 'name')
        .populate('hostUnitId', 'unitNumber block')
        .populate('verifiedBySecurityId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Math.min(200, parseInt(limit) || 20))
        .lean(),
      Visitor.countDocuments(filter),
    ]);
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const [byStatus, today] = await Promise.all([
      Visitor.aggregate([{ $match: base }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      Visitor.countDocuments({ ...base, expectedDate: { $gte: dayStart, $lt: dayEnd } }),
    ]);
    const counts = Object.fromEntries(byStatus.map((r) => [r._id, r.n]));
    counts.all = byStatus.reduce((t, r) => t + r.n, 0);
    counts.today = today;

    return res.json({
      success: true,
      data: visitors,
      counts,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.verifyVisitorCode = async (req, res) => {
  try {
    const { code } = req.params;
    // Only this estate's passes — a guard can never read another estate's
    const visitor = await Visitor.findOne({ visitorCode: String(code).toUpperCase(), estateId: req.estateId })
      .populate('hostResidentId', 'name phone')
      .populate('hostUnitId', 'unitNumber block')
      .populate('estateId', 'name');

    if (!visitor) {
      return res.status(404).json({ success: false, message: 'Invalid visitor code' });
    }

    if (visitor.status === 'blacklisted') {
      return res.status(403).json({ success: false, message: 'Visitor is blacklisted', data: visitor });
    }

    // Unused pass whose time window has closed: expire it now so the gate
    // never reads it as valid, even if the sweeper hasn't reached it yet.
    if (isPastExpiry(visitor)) {
      visitor.status = 'expired';
      visitor.awaitingApproval = false;
      await visitor.save();
      emitVisitorUpdate(String(visitor.estateId?._id || visitor.estateId), visitor);
    }

    if (visitor.status === 'expired') {
      return res.status(410).json({
        success: false, code: 'PASS_EXPIRED',
        message: 'This visitor pass has expired. Do not admit — the host must create a new pass.',
        expiresAt: passExpiresAt(visitor), data: visitor,
      });
    }

    if (visitor.status === 'checked-out') {
      return res.status(409).json({ success: false, message: 'Visitor already checked out', data: visitor });
    }

    if (visitor.status === 'cancelled') {
      return res.status(410).json({ success: false, code: 'PASS_CANCELLED', message: 'This pass was cancelled by the host', data: visitor });
    }

    // Held for estate-management approval — the guard is not told why.
    if (visitor.status === 'pending' && visitor.awaitingApproval) {
      // 423, not 403: older gate apps treat 403 as "blacklisted"
      return res.status(423).json({ success: false, code: 'PASS_AWAITING_APPROVAL', message: 'This pass is awaiting estate management approval. Please contact the estate office.', data: visitor });
    }

    // Detect early arrival (> 30 min before expectedDate, not yet checked in).
    // We ping the host so they can grant early entry without the guard having
    // to call them. If approval already granted, fall through to normal flow.
    const now = new Date();
    const expectedAt = new Date(visitor.expectedDate);
    const minsEarly = Math.ceil((expectedAt - now) / 60000);

    if (
      minsEarly > EARLY_GRACE_MIN &&
      !visitor.earlyEntryApproved &&
      visitor.status !== 'checked-in'
    ) {
      const hostId = visitor.hostResidentId?._id || visitor.hostResidentId;
      emitEarlyArrival(hostId?.toString(), {
        visitorId:    visitor._id,
        visitorName:  visitor.visitorName,
        visitorPhone: visitor.visitorPhone,
        visitorCode:  visitor.visitorCode,
        purpose:      visitor.purpose,
        expectedDate: visitor.expectedDate,
        minsEarly,
        estateId:     visitor.estateId?._id || visitor.estateId,
      });
      return res.json({
        success: true,
        state: 'early_arrival',
        data: visitor,
        minsEarly,
        gate: gateInfo(visitor, await siteTypes.siteFor(visitor.estateId?._id || visitor.estateId), new Date(), publicPlace(await placeForUnit(visitor.hostUnitId?._id || visitor.hostUnitId).catch(() => null))),
      });
    }

    return res.json({ success: true, data: visitor, gate: gateInfo(visitor, await siteTypes.siteFor(visitor.estateId?._id || visitor.estateId), new Date(), publicPlace(await placeForUnit(visitor.hostUnitId?._id || visitor.hostUnitId).catch(() => null))) });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PATCH /visitors/:id/cancel — the host (or estate manager) withdraws a pass
// that hasn't been used yet. The gate will refuse the code from then on.
exports.cancelPass = async (req, res) => {
  try {
    const visitor = await Visitor.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!visitor) return res.status(404).json({ success: false, message: 'Visitor not found' });
    const isHost = String(visitor.hostResidentId) === String(req.user._id);
    // The care team can decline a pass held for their approval
    const isManager = ['estate_manager', 'super_admin'].includes(req.user.role)
      || (visitor.approvalBy === 'care_team' && visitor.awaitingApproval && (visitor.approverIds || []).some(id => String(id) === String(req.user._id)));
    if (!isHost && !isManager) return res.status(403).json({ success: false, message: 'Only the host can cancel this pass' });
    if (visitor.status === 'checked-in') return res.status(409).json({ success: false, message: 'Your visitor is already inside. Ask security to check them out instead.' });
    if (!['active', 'pending'].includes(visitor.status)) return res.status(409).json({ success: false, message: `This pass is already ${visitor.status.replace('-', ' ')}` });
    const declinedHeld = isManager && !isHost && visitor.awaitingApproval;
    visitor.status = 'cancelled';
    visitor.awaitingApproval = false;
    visitor.cancelledAt = new Date();
    visitor.cancelledBy = req.user._id;
    await visitor.save();
    if (declinedHeld) {
      require('../services/pushService').sendToUser(visitor.hostResidentId, {
        title: 'Visitor pass not approved', body: `Estate management did not approve ${visitor.visitorName}'s pass.`, url: `/visitors/${visitor._id}`, tag: `pass-${visitor._id}`,
      }).catch(() => {});
    }
    emitVisitorUpdate(visitor.estateId.toString(), visitor);
    return res.json({ success: true, message: 'Pass cancelled', data: visitor });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.approveEarlyEntry = async (req, res) => {
  try {
    const visitor = await Visitor.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!visitor) return res.status(404).json({ success: false, message: 'Visitor not found' });

    // Only the host of this visitor can approve
    const hostId = visitor.hostResidentId?.toString();
    if (hostId !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Only the host can approve early entry' });
    }

    visitor.earlyEntryApproved   = true;
    visitor.earlyEntryApprovedBy = req.user._id;
    visitor.earlyEntryApprovedAt = new Date();
    await visitor.save();
    await visitor.populate([
      { path: 'hostResidentId', select: 'name phone' },
      { path: 'hostUnitId',     select: 'unitNumber block' },
    ]);

    const estateId = (visitor.estateId?._id || visitor.estateId)?.toString();
    emitEarlyApproved(estateId, {
      visitorId:   visitor._id,
      visitorCode: visitor.visitorCode,
      visitorName: visitor.visitorName,
      approvedBy:  req.user.name,
      visitor,
    });

    return res.json({ success: true, message: 'Early entry approved', data: visitor });
  } catch (err) {
    console.error('approveEarlyEntry error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.checkIn = async (req, res) => {
  try {
    const visitor = await Visitor.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!visitor) return res.status(404).json({ success: false, message: 'Visitor not found' });
    if (visitor.status === 'checked-in') {
      return res.status(409).json({ success: false, message: 'Already checked in' });
    }
    if (visitor.status === 'pending' && visitor.awaitingApproval) {
      return res.status(409).json({ success: false, code: 'PASS_AWAITING_APPROVAL', message: 'This pass is awaiting estate management approval. Please contact the estate office.' });
    }
    if (['cancelled', 'blacklisted', 'checked-out'].includes(visitor.status)) {
      const msg = { cancelled: 'This pass was cancelled by the host', blacklisted: 'This visitor is blacklisted', 'checked-out': 'This pass was already used' }[visitor.status];
      return res.status(409).json({ success: false, code: `PASS_${visitor.status.toUpperCase().replace('-', '_')}`, message: msg });
    }

    const now = new Date();
    const expectedAt = new Date(visitor.expectedDate);
    const duration = visitor.expectedDuration || 720; // minutes
    const expiresAt = new Date(expectedAt.getTime() + duration * 60 * 1000);

    // Too early — visitor not yet expected, and no host approval yet
    if (now < expectedAt && !visitor.earlyEntryApproved) {
      const diffMs = expectedAt - now;
      const diffMins = Math.ceil(diffMs / 60000);
      if (diffMins > EARLY_GRACE_MIN) {
        const hrs  = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        const when = hrs > 0 ? `${hrs}h ${mins}m` : `${mins} min`;
        return res.status(425).json({
          success: false,
          code: 'TOO_EARLY',
          message: `Visitor is expected at ${expectedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${when} from now. The resident has been pinged to approve early entry.`,
        });
      }
    }

    // Pass expired
    if (now > expiresAt) {
      visitor.status = 'expired';
      await visitor.save();
      return res.status(410).json({
        success: false,
        code: 'PASS_EXPIRED',
        message: 'This visitor pass has expired.',
      });
    }

    // Site rules: contractor induction and hospital visiting hours
    const estateDoc = await siteTypes.siteFor(visitor.estateId);
    const gate = gateInfo(visitor, estateDoc, now);
    const overrideReason = typeof req.body?.overrideReason === 'string' ? req.body.overrideReason.trim() : '';
    if (gate.induction?.required) {
      if (req.body?.inductionAccepted !== true) {
        return res.status(428).json({ success: false, code: 'INDUCTION_REQUIRED', message: 'The visitor must read and accept the safety induction before entry.', gate });
      }
      visitor.inductionAcceptedAt = now;
    }
    if (gate.visiting) {
      const cfg = siteTypes.siteConfig(estateDoc);
      let problem = null;
      if (gate.visiting.outside) problem = { code: 'OUTSIDE_VISITING_HOURS', message: `Outside visiting hours (${cfg.visitingHours.start}–${cfg.visitingHours.end}).` };
      else if (cfg.visitingHours.maxPerPatient && visitor.details?.patientName) {
        const inside = await Visitor.countDocuments({
          estateId: visitor.estateId, status: 'checked-in', _id: { $ne: visitor._id },
          'details.patientName': new RegExp(`^${visitor.details.patientName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        });
        if (inside >= cfg.visitingHours.maxPerPatient) problem = { code: 'PATIENT_VISITOR_LIMIT', message: `${visitor.details.patientName} already has ${inside} visitor${inside === 1 ? '' : 's'} (limit ${cfg.visitingHours.maxPerPatient}).` };
      }
      if (problem) {
        if (!overrideReason) return res.status(409).json({ success: false, ...problem, overridable: true, gate });
        visitor.outsideHoursOverride = { reason: overrideReason.slice(0, 300), by: req.user._id, at: now };
      }
    }

    visitor.status = 'checked-in';
    visitor.entryTime = now;
    visitor.verifiedBySecurityId = req.user._id;
    await visitor.save();

    await SecurityLog.create({
      estateId: visitor.estateId,
      action: 'visitor_entry',
      visitorId: visitor._id,
      performedBy: req.user._id,
    });

    emitVisitorUpdate(visitor.estateId.toString(), visitor);
    // Gate watch: alert security if this guest's host is under a safety block.
    require('../services/safetyService').onVisitorCheckIn(visitor);

    return res.json({ success: true, message: 'Visitor checked in', data: visitor });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.checkOut = async (req, res) => {
  try {
    const visitor = await Visitor.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!visitor) return res.status(404).json({ success: false, message: 'Visitor not found' });
    // Only someone actually inside can be checked out (not blacklisted / cancelled / pending passes)
    if (visitor.status !== 'checked-in') return res.status(409).json({ success: false, message: `This visitor isn't checked in (${visitor.status.replace('-', ' ')})` });

    visitor.status = 'checked-out';
    visitor.exitTime = new Date();
    await visitor.save();

    await SecurityLog.create({
      estateId: visitor.estateId,
      action: 'visitor_exit',
      visitorId: visitor._id,
      performedBy: req.user._id,
    });

    emitVisitorUpdate(visitor.estateId.toString(), visitor);

    return res.json({ success: true, message: 'Visitor checked out', data: visitor });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.blacklistVisitor = async (req, res) => {
  try {
    const visitor = await Visitor.findOneAndUpdate(
      { _id: req.params.id, estateId: req.estateId },
      { status: 'blacklisted' },
      { new: true }
    );
    if (!visitor) return res.status(404).json({ success: false, message: 'Visitor not found' });
    return res.json({ success: true, message: 'Visitor blacklisted', data: visitor });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getVisitorById = async (req, res) => {
  try {
    const visitor = await Visitor.findOne({ _id: req.params.id, estateId: req.estateId })
      .populate('hostResidentId', 'name phone')
      .populate('hostUnitId', 'unitNumber block')
      .populate('verifiedBySecurityId', 'name');
    if (!visitor) return res.status(404).json({ success: false, message: 'Not found' });
    // Residents only see their own passes (or ones held for their care-team approval)
    if (req.user.role === 'resident' && String(visitor.hostResidentId?._id || visitor.hostResidentId) !== String(req.user._id)
      && !(visitor.approverIds || []).some((id) => String(id) === String(req.user._id))) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    // Where the visitor is going (for the shareable pass / directions)
    const place = publicPlace(await placeForUnit(visitor.hostUnitId?._id || visitor.hostUnitId).catch(() => null));
    return res.json({ success: true, data: visitor, place });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
