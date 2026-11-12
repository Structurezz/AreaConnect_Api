const mongoose = require('mongoose');
const User = require('../models/User');
const Estate = require('../models/Estate');
const Payment = require('../models/Payment');
const DuesEnforcementLog = require('../models/DuesEnforcementLog');
const { managerQuery } = require('../utils/managers');
const {
  SERVICES, SERVICE_KEYS, PROTECTED, NGN, BASIS_TYPES, basisText,
  settingsOf, overdueBills, log, notifyResident, syncRestriction,
} = require('../utils/duesEnforcement');

const fail = (res, code, message) => res.status(code).json({ success: false, message });
const fullDate = (d) => new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
const serviceList = () => SERVICE_KEYS.map((key) => ({ key, ...SERVICES[key] }));

// ── Manager: settings ────────────────────────────────────────────────────────

exports.getSettings = async (req, res) => {
  try {
    const estate = await Estate.findById(req.estateId).select('settings constitution.fileName');
    return res.json({
      success: true,
      data: {
        settings: settingsOf(estate),
        services: serviceList(),
        bases: Object.entries(BASIS_TYPES).map(([key, b]) => ({ key, ...b })),
        protected: PROTECTED,
        hasConstitution: !!estate?.constitution?.fileName,
      },
    });
  } catch (err) {
    console.error('[dues getSettings]', err);
    return fail(res, 500, 'Server error');
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const { enabled, basisType, constitutionClause, noticeDays, minOverdueDays, minAmount, services } = req.body;
    const basis = BASIS_TYPES[basisType] ? basisType : 'constitution';
    const clause = String(constitutionClause || '').trim().slice(0, 500);
    if (enabled && !clause) {
      return fail(res, 400, basis === 'other'
        ? 'Describe what allows the estate to restrict services before turning this on'
        : `Give the reference (e.g. ${BASIS_TYPES[basis].example}) before turning this on`);
    }
    const picked = (Array.isArray(services) ? services : []).filter((s) => SERVICES[s]);
    if (enabled && !picked.length) return fail(res, 400, 'Choose at least one service that can be restricted');

    const clamp = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);
    const current = settingsOf(await Estate.findById(req.estateId).select('settings'));
    const next = {
      enabled: !!enabled,
      basisType: basis,
      constitutionClause: clause,
      noticeDays: clamp(noticeDays, 7, 60, 14),
      minOverdueDays: clamp(minOverdueDays, 0, 365, 30),
      minAmount: clamp(minAmount, 0, 1e9, 0),
      services: picked,
      // Re-stamp the confirmation whenever the basis changes or it's switched on
      confirmedAt: enabled && (clause !== current.constitutionClause || basis !== current.basisType || !current.enabled) ? new Date() : current.confirmedAt || null,
      confirmedBy: enabled && (clause !== current.constitutionClause || basis !== current.basisType || !current.enabled) ? req.user._id : current.confirmedBy || null,
    };
    await Estate.updateOne({ _id: req.estateId }, { $set: { 'settings.duesEnforcement': next } });
    return res.json({ success: true, message: next.enabled ? 'Dues enforcement is on' : 'Dues enforcement is off', data: next });
  } catch (err) {
    console.error('[dues updateSettings]', err);
    return fail(res, 500, 'Server error');
  }
};

// ── Manager: who is eligible / under notice / restricted ─────────────────────

exports.getOverview = async (req, res) => {
  try {
    const estate = await Estate.findById(req.estateId).select('settings');
    const cfg = settingsOf(estate);
    const cutoff = new Date(Date.now() - cfg.minOverdueDays * 864e5);
    const now = new Date();

    // Unpaid bills per resident, split into "overdue at all" and "past the threshold"
    const rows = await Payment.aggregate([
      { $match: { estateId: new mongoose.Types.ObjectId(String(req.estateId)), status: { $in: ['pending', 'overdue'] } } },
      { $lookup: { from: 'paymentschedules', localField: 'scheduleId', foreignField: '_id', as: 's' } },
      { $addFields: { dueDate: { $arrayElemAt: ['$s.dueDate', 0] } } },
      { $match: { dueDate: { $lt: now } } },
      { $group: {
        _id: '$residentId',
        overdue: { $sum: '$amount' },
        eligibleAmount: { $sum: { $cond: [{ $lt: ['$dueDate', cutoff] }, '$amount', 0] } },
        oldestDue: { $min: '$dueDate' },
        bills: { $sum: 1 },
      } },
    ]);
    const owing = new Map(rows.map((r) => [String(r._id), r]));

    const residents = await User.find({
      estateId: req.estateId, role: 'resident',
      $or: [{ _id: { $in: rows.map((r) => r._id) } }, { 'duesRestriction.status': { $in: ['notice', 'active'] } }],
    }).select('name email phone profilePhoto unitId duesRestriction').populate('unitId', 'unitNumber block').lean();

    const data = residents.map((r) => {
      const o = owing.get(String(r._id)) || { overdue: 0, eligibleAmount: 0, bills: 0, oldestDue: null };
      const status = r.duesRestriction?.status || 'none';
      return {
        resident: { _id: r._id, name: r.name, email: r.email, phone: r.phone, profilePhoto: r.profilePhoto, unit: r.unitId || null },
        overdue: o.overdue,
        overdueBills: o.bills,
        oldestDue: o.oldestDue,
        eligible: status === 'none' && o.eligibleAmount > 0 && o.eligibleAmount >= cfg.minAmount,
        restriction: r.duesRestriction || { status: 'none' },
        canApply: status === 'notice' && r.duesRestriction.effectiveAt && new Date(r.duesRestriction.effectiveAt) <= now,
      };
    });
    const rank = { active: 0, notice: 1 };
    data.sort((a, b) => (rank[a.restriction.status] ?? 2) - (rank[b.restriction.status] ?? 2) || b.overdue - a.overdue);

    return res.json({ success: true, data, settings: { ...cfg, basis: basisText(cfg) }, services: serviceList() });
  } catch (err) {
    console.error('[dues getOverview]', err);
    return fail(res, 500, 'Server error');
  }
};

const loadResident = (req) => User.findOne({ _id: req.params.id, estateId: req.estateId, role: 'resident' });

exports.getResident = async (req, res) => {
  try {
    let resident = await loadResident(req);
    if (!resident) return fail(res, 404, 'Resident not found');
    resident = await syncRestriction(resident);
    const [overdue, history] = await Promise.all([
      overdueBills(resident._id, req.estateId, 0),
      DuesEnforcementLog.find({ estateId: req.estateId, residentId: resident._id })
        .sort({ createdAt: -1 }).limit(30).populate('byId', 'name').lean(),
    ]);
    return res.json({ success: true, data: { restriction: resident.duesRestriction, overdue, history } });
  } catch (err) {
    console.error('[dues getResident]', err);
    return fail(res, 500, 'Server error');
  }
};

// Step 1 — written notice. Nothing is restricted yet.
exports.sendNotice = async (req, res) => {
  try {
    const estate = await Estate.findById(req.estateId).select('name settings');
    const cfg = settingsOf(estate);
    if (!cfg.enabled || !cfg.constitutionClause) {
      return fail(res, 400, 'Turn on dues enforcement in Payments → Enforcement settings first');
    }
    const resident = await loadResident(req);
    if (!resident) return fail(res, 404, 'Resident not found');
    if (resident.duesRestriction?.status && resident.duesRestriction.status !== 'none') {
      return fail(res, 409, 'This resident already has a notice or restriction in place');
    }

    // `manual` = the manager chose this resident themselves, so the automatic
    // days/amount thresholds don't apply — but a bill must still be overdue.
    const manual = req.body.manual === true;
    const { amount, bills } = await overdueBills(resident._id, req.estateId, manual ? 0 : cfg.minOverdueDays);
    if (!amount) {
      return fail(res, 400, manual
        ? 'This resident has no overdue bills, so a notice can\'t be sent'
        : `No bills are more than ${cfg.minOverdueDays} days overdue for this resident`);
    }
    if (!manual && amount < cfg.minAmount) return fail(res, 400, `Overdue amount ${NGN(amount)} is below your ${NGN(cfg.minAmount)} threshold`);

    const picked = (Array.isArray(req.body.services) ? req.body.services : cfg.services).filter((s) => cfg.services.includes(s));
    if (!picked.length) return fail(res, 400, 'Choose at least one service');
    const note = String(req.body.note || '').trim().slice(0, 1000);
    const now = new Date();
    const effectiveAt = new Date(now.getTime() + cfg.noticeDays * 864e5);

    resident.duesRestriction = { status: 'notice', services: picked, amountOwed: amount, noticeAt: now, effectiveAt, appliedAt: null, note, dispute: {} };
    await resident.save();
    await log(req.estateId, resident._id, 'notice', { byId: req.user._id, services: picked, amountOwed: amount, note: [manual && '(Manual notice)', note].filter(Boolean).join(' ') });

    notifyResident(resident, estate, 'notice', {
      subject: `Notice of overdue estate bills — ${NGN(amount)}`,
      lines: [
        `Our records show ${NGN(amount)} in estate bills that are overdue: ${bills.map((b) => b.title).join(', ')}.`,
        ...(note ? [`Message from estate management: ${note}`] : []),
        `Under ${basisText(cfg)}, if these are not cleared by ${fullDate(effectiveAt)}, the estate may pause the following services until they are paid:`,
      ],
      items: picked.map((s) => `${SERVICES[s].label} — ${SERVICES[s].effect}`),
      pushTitle: 'Notice: overdue estate bills',
      pushBody: `${NGN(amount)} overdue. Please pay by ${fullDate(effectiveAt)} to avoid some services being paused.`,
    });
    return res.json({ success: true, message: `Notice sent. Restrictions can be applied from ${fullDate(effectiveAt)}.`, data: resident.duesRestriction });
  } catch (err) {
    console.error('[dues sendNotice]', err);
    return fail(res, 500, 'Server error');
  }
};

// Step 2 — after the notice period, the manager confirms the restriction.
exports.applyRestriction = async (req, res) => {
  try {
    const estate = await Estate.findById(req.estateId).select('name settings');
    const cfg = settingsOf(estate);
    if (!cfg.enabled) return fail(res, 400, 'Dues enforcement is turned off for this estate');

    let resident = await loadResident(req);
    if (!resident) return fail(res, 404, 'Resident not found');
    resident = await syncRestriction(resident);
    const r = resident.duesRestriction;
    if (r?.status !== 'notice') {
      return fail(res, 409, r?.status === 'active' ? 'Restrictions are already in place' : 'Send a notice first — or the resident has since paid');
    }
    if (new Date(r.effectiveAt) > new Date()) {
      return fail(res, 400, `The notice period runs until ${fullDate(r.effectiveAt)}. Restrictions can't be applied before then.`);
    }

    const { amount } = await overdueBills(resident._id, req.estateId, 0);
    const services = r.services.filter((s) => cfg.services.includes(s));
    resident.duesRestriction.status = 'active';
    resident.duesRestriction.services = services;
    resident.duesRestriction.amountOwed = amount;
    resident.duesRestriction.appliedAt = new Date();
    await resident.save();
    await log(req.estateId, resident._id, 'applied', { byId: req.user._id, services, amountOwed: amount, note: String(req.body.note || '').slice(0, 1000) });

    notifyResident(resident, estate, 'applied', {
      subject: 'Some estate services are paused',
      lines: [
        `The notice period has ended and ${NGN(amount)} in estate bills is still overdue, so under ${basisText(cfg)} the following are paused:`,
        'Everything is restored automatically as soon as your overdue bills are paid.',
      ],
      items: services.map((s) => `${SERVICES[s].label} — ${SERVICES[s].effect}`),
      pushTitle: 'Some estate services are paused',
      pushBody: `${NGN(amount)} overdue. Pay in the app to restore them instantly.`,
    });

    return res.json({ success: true, message: 'Restrictions applied', data: resident.duesRestriction });
  } catch (err) {
    console.error('[dues applyRestriction]', err);
    return fail(res, 500, 'Server error');
  }
};

// Manager withdraws a notice or lifts a restriction early (payment plan, dispute upheld…)
exports.liftRestriction = async (req, res) => {
  try {
    const resident = await loadResident(req);
    if (!resident) return fail(res, 404, 'Resident not found');
    const r = resident.duesRestriction;
    if (!r || r.status === 'none') return fail(res, 409, 'Nothing to lift');

    const wasActive = r.status === 'active';
    const services = r.services || [];
    const note = String(req.body.note || '').trim().slice(0, 1000);
    resident.duesRestriction = { status: 'none', services: [] };
    await resident.save();
    await log(req.estateId, resident._id, wasActive ? 'lifted' : 'cancelled', { byId: req.user._id, services, amountOwed: r.amountOwed, note });

    const estate = await Estate.findById(req.estateId).select('name');
    notifyResident(resident, estate, 'restored', {
      subject: wasActive ? 'Your services have been restored' : 'Dues notice withdrawn',
      lines: [wasActive
        ? 'Estate management has restored the services that were paused on your account.'
        : 'Estate management has withdrawn the notice about restricting services on your account.'],
      pushTitle: wasActive ? 'Services restored' : 'Dues notice withdrawn',
      pushBody: wasActive ? 'Everything that was paused is working again.' : 'No services will be paused.',
    });

    return res.json({ success: true, message: wasActive ? 'Restrictions lifted' : 'Notice withdrawn' });
  } catch (err) {
    console.error('[dues liftRestriction]', err);
    return fail(res, 500, 'Server error');
  }
};

// ── Resident ─────────────────────────────────────────────────────────────────

exports.getMine = async (req, res) => {
  try {
    const user = await syncRestriction(await User.findById(req.user._id));
    const r = user.duesRestriction || { status: 'none' };
    if (r.status === 'none') return res.json({ success: true, data: { status: 'none' } });
    const estate = await Estate.findById(req.estateId).select('settings');
    const { amount, bills } = await overdueBills(user._id, req.estateId, 0);
    return res.json({
      success: true,
      data: {
        status: r.status,
        services: (r.services || []).map((key) => ({ key, ...SERVICES[key] })).filter((s) => s.label),
        noticeAt: r.noticeAt,
        effectiveAt: r.effectiveAt,
        appliedAt: r.appliedAt,
        clause: basisText(settingsOf(estate)),
        overdue: amount,
        bills,
        protected: PROTECTED,
        dispute: r.dispute?.at ? r.dispute : null,
      },
    });
  } catch (err) {
    console.error('[dues getMine]', err);
    return fail(res, 500, 'Server error');
  }
};

exports.disputeMine = async (req, res) => {
  try {
    const message = String(req.body.message || '').trim().slice(0, 2000);
    if (message.length < 10) return fail(res, 400, 'Please explain the issue in a sentence or two');
    const user = await User.findById(req.user._id);
    const r = user?.duesRestriction;
    if (!r || r.status === 'none') return fail(res, 409, 'There is nothing to dispute');

    user.duesRestriction.dispute = { message, at: new Date() };
    await user.save();
    await log(req.estateId, user._id, 'dispute', { byId: user._id, services: r.services, amountOwed: r.amountOwed, note: message });

    // Tell the estate's managers
    const { sendManagerNotificationEmail } = require('../services/emailService');
    const { sendToUser } = require('../services/pushService');
    const [estate, managers] = await Promise.all([
      Estate.findById(req.estateId).select('name'),
      User.find({ ...managerQuery(req.estateId), isActive: true }).select('name email'),
    ]);
    managers.forEach((m) => {
      sendToUser(m._id, { title: 'Dues dispute', body: `${user.name} disputed their dues notice`, url: '/payments?tab=enforcement', tag: `dues-dispute-${user._id}` }).catch(() => {});
      if (m.email) {
        sendManagerNotificationEmail({
          to: m.email, managerName: m.name, estateName: estate?.name || 'Your estate',
          type: 'dues_dispute', title: `${user.name} disputed their dues ${r.status === 'active' ? 'restriction' : 'notice'}`,
          body: message.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])),
        }).catch((e) => console.error('[dues dispute email]', e.message));
      }
    });

    return res.json({ success: true, message: 'Sent to estate management. They will get back to you.' });
  } catch (err) {
    console.error('[dues disputeMine]', err);
    return fail(res, 500, 'Server error');
  }
};
