const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { geocodeAddress } = require('../services/geocoding');
const Estate = require('../models/Estate');
const User = require('../models/User');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const OnboardingInvite = require('../models/OnboardingInvite');
const { sendManagerOnboardEmail, sendOnboardingInviteEmail } = require('../services/emailService');

const MANAGER_APP = () => process.env.ESTATE_MANAGER_URL || 'https://area-connector.areaconnect.pro';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROFILE_FIELDS = ['city', 'state', 'estateType', 'contactPhone', 'contactEmail', 'adminNotes', 'logoUrl'];

const genTempPassword = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = 'Estate@';
  for (let i = 0; i < 8; i++) s += chars[crypto.randomInt(chars.length)];
  return s;
};

const resolvePlan = async (planId, planSlug) =>
  (planId && await Plan.findById(planId))
  || (planSlug && await Plan.findOne({ slug: planSlug, isActive: true }))
  || await Plan.findOne({ slug: 'starter', isActive: true })
  || await Plan.findOne({ isActive: true }).sort({ sortOrder: 1 });

// Subscription for a freshly onboarded estate: trial by default, or active/comp.
async function seedSubscription(estateId, { planId, planSlug, cycle = 'monthly', trialDays = 14, status, billingModel = 'flat', notes = '' }, adminId) {
  const plan = await resolvePlan(planId, planSlug);
  if (!plan) return null;
  const now = new Date();
  const days = Number(trialDays) || 0;
  const trialEndsAt = days > 0 ? new Date(now.getTime() + days * 86400000) : null;
  const next = new Date(now);
  if (cycle === 'annual') next.setFullYear(next.getFullYear() + 1); else next.setMonth(next.getMonth() + 1);
  return Subscription.findOneAndUpdate(
    { estateId },
    {
      planId: plan._id, cycle, billingModel,
      status: status || (trialEndsAt ? 'trial' : 'active'),
      trialEndsAt, nextBillingDate: trialEndsAt || next, startDate: now,
      notes, updatedBy: adminId,
    },
    { new: true, upsert: true, runValidators: true },
  );
}

async function createEstateDoc(data, { source, adminId, managerId, batchId = '' }) {
  const location = {};
  const geo = await geocodeAddress(data.address, data).catch(() => null);
  if (geo) Object.assign(location, geo, { geocodedAt: new Date() });
  const doc = {
    name: String(data.name).trim(), address: String(data.address).trim(),
    unitCount: Number(data.unitCount) || 0,
    managerId: managerId || undefined, location,
    onboarding: { source, byId: adminId, batchId },
  };
  for (const f of PROFILE_FIELDS) if (data[f] != null) doc[f] = String(data[f]).trim();
  if (data.settings) doc.settings = data.settings;
  return Estate.create(doc);
}

// Find or create the manager account. Returns { user, tempPassword, created }.
async function upsertManager({ userId, name, email, phone }) {
  if (userId) {
    const user = await User.findById(userId);
    if (!user) throw Object.assign(new Error('Manager not found'), { status: 404 });
    return { user, created: false };
  }
  const mail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(mail)) throw Object.assign(new Error(`Invalid manager email: ${email || '(blank)'}`), { status: 400 });
  const existing = await User.findOne({ email: mail });
  if (existing) {
    if (!['estate_manager', 'super_admin'].includes(existing.role)) {
      throw Object.assign(new Error(`${mail} is a ${existing.role} account — use a different email`), { status: 409 });
    }
    return { user: existing, created: false };
  }
  const tempPassword = genTempPassword();
  const user = await User.create({
    name: String(name || mail.split('@')[0]).trim(), email: mail, phone: phone || '',
    passwordHash: await bcrypt.hash(tempPassword, 12),
    role: 'estate_manager', teamRole: 'owner', mustChangePassword: true,
  });
  return { user, tempPassword, created: true };
}

// Attach estates to a manager's portfolio without moving their current estate.
async function attachToManager(user, estateIds) {
  const set = { $addToSet: { managedEstates: { $each: estateIds } } };
  if (!user.estateId) set.$set = { estateId: estateIds[0] };
  if (user.role !== 'super_admin' && user.role !== 'estate_manager') (set.$set ||= {}).role = 'estate_manager';
  await User.updateOne({ _id: user._id }, set);
  await Estate.updateMany({ _id: { $in: estateIds } }, { managerId: user._id });
}

const fail = (res, err) => {
  if (!err.status) console.error('[onboarding]', err);
  return res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Server error' });
};

// ── Lookups ───────────────────────────────────────────────────────────────────
// GET /api/admin/onboarding/managers?search=
exports.listManagers = async (req, res) => {
  try {
    const q = { role: 'estate_manager', teamRole: { $ne: 'member' } };
    if (req.query.search) q.$or = [
      { name: { $regex: req.query.search, $options: 'i' } },
      { email: { $regex: req.query.search, $options: 'i' } },
    ];
    const users = await User.find(q).select('name email phone profilePhoto estateId managedEstates lastSeen createdAt')
      .populate('managedEstates', 'name estateCode').sort({ name: 1 }).limit(200).lean();
    return res.json({ success: true, data: users });
  } catch (err) { return fail(res, err); }
};

// GET /api/admin/onboarding/summary — counts + recently onboarded estates
exports.summary = async (req, res) => {
  try {
    const since = new Date(Date.now() - 30 * 86400000);
    const [recent, last30, bySource, pendingInvites, unassigned] = await Promise.all([
      Estate.find().populate('managerId', 'name email').sort({ createdAt: -1 }).limit(12)
        .select('name address city state estateCode createdAt managerId onboarding unitCount').lean(),
      Estate.countDocuments({ createdAt: { $gte: since } }),
      Estate.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: { $ifNull: ['$onboarding.source', 'self'] }, n: { $sum: 1 } } }]),
      OnboardingInvite.countDocuments({ status: 'pending', expiresAt: { $gt: new Date() } }),
      Estate.countDocuments({ $or: [{ managerId: null }, { managerId: { $exists: false } }] }),
    ]);
    return res.json({
      success: true,
      data: { recent, last30, bySource: Object.fromEntries(bySource.map(s => [s._id, s.n])), pendingInvites, unassigned },
    });
  } catch (err) { return fail(res, err); }
};

// ── 1. Guided wizard: one estate, full profile ─────────────────────────────────
// POST /api/admin/onboarding/estate
// { estate:{name,address,city,state,estateType,unitCount,contactPhone,contactEmail,adminNotes,settings},
//   manager:{mode:'new'|'existing'|'later', userId, name, email, phone, sendEmail},
//   billing:{planId, cycle, trialDays, status, billingModel, notes} }
exports.onboardEstate = async (req, res) => {
  try {
    const { estate: e = {}, manager: m = { mode: 'later' }, billing = {} } = req.body;
    if (!e.name?.trim() || !e.address?.trim()) return res.status(400).json({ success: false, message: 'Estate name and address are required' });

    let mgr = null;
    if (m.mode === 'existing' || m.mode === 'new') mgr = await upsertManager(m.mode === 'existing' ? { userId: m.userId } : m);

    const estate = await createEstateDoc(e, { source: 'wizard', adminId: req.user._id, managerId: mgr?.user._id });
    if (mgr) await attachToManager(mgr.user, [estate._id]);
    const sub = await seedSubscription(estate._id, billing, req.user._id);

    let emailed = false;
    if (mgr && m.sendEmail !== false) {
      try {
        await sendManagerOnboardEmail({ to: mgr.user.email, name: mgr.user.name, estates: [estate], tempPassword: mgr.tempPassword, trialDays: sub?.status === 'trial' ? Number(billing.trialDays ?? 14) : 0 });
        emailed = true;
      } catch (err) { console.error('[onboarding] email', err.message); }
    }

    return res.status(201).json({
      success: true,
      data: {
        estate, subscription: sub, emailed,
        manager: mgr ? { _id: mgr.user._id, name: mgr.user.name, email: mgr.user.email, created: mgr.created, tempPassword: mgr.tempPassword || null } : null,
      },
    });
  } catch (err) { return fail(res, err); }
};

// ── 2. Bulk import ────────────────────────────────────────────────────────────
// POST /api/admin/onboarding/bulk
// { rows:[{name,address,city,state,estateType,unitCount,managerName,managerEmail,managerPhone,planSlug,trialDays}],
//   defaults:{planId,cycle,trialDays}, sendEmails, dryRun }
exports.bulkImport = async (req, res) => {
  try {
    const { rows = [], defaults = {}, sendEmails = true, dryRun = false } = req.body;
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ success: false, message: 'No rows to import' });
    if (rows.length > 200) return res.status(400).json({ success: false, message: 'Import at most 200 estates at a time' });

    // Validate first so the admin can fix the sheet before anything is written
    const existingNames = new Set((await Estate.find().select('name').lean()).map(x => x.name.trim().toLowerCase()));
    const seen = new Set();
    const checked = rows.map((r, i) => {
      const errors = [], warnings = [];
      const name = String(r.name || '').trim();
      if (!name) errors.push('Estate name is missing');
      if (!String(r.address || '').trim()) errors.push('Address is missing');
      if (r.managerEmail && !EMAIL_RE.test(String(r.managerEmail).trim())) errors.push('Manager email is invalid');
      const key = name.toLowerCase();
      if (key && seen.has(key)) errors.push('Duplicate name in this file');
      if (key && existingNames.has(key)) warnings.push('An estate with this name already exists');
      if (!r.managerEmail) warnings.push('No manager — estate will be unassigned');
      seen.add(key);
      return { row: i + 1, name, errors, warnings };
    });
    if (dryRun) return res.json({ success: true, data: { checked } });

    const batchId = `B${Date.now().toString(36).toUpperCase()}`;
    const results = [];
    const perManager = new Map(); // email → { mgr, estates[] }
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (checked[i].errors.length) { results.push({ row: i + 1, name: checked[i].name, ok: false, error: checked[i].errors.join('; ') }); continue; }
      try {
        let mgr = null;
        const mail = String(r.managerEmail || '').trim().toLowerCase();
        if (mail) {
          mgr = perManager.get(mail)?.mgr || await upsertManager({ name: r.managerName, email: mail, phone: r.managerPhone });
        }
        const estate = await createEstateDoc(r, { source: 'bulk', adminId: req.user._id, managerId: mgr?.user._id, batchId });
        if (mgr) {
          await attachToManager(mgr.user, [estate._id]);
          mgr.user.estateId ||= estate._id;
          if (!perManager.has(mail)) perManager.set(mail, { mgr, estates: [] });
          perManager.get(mail).estates.push(estate);
        }
        await seedSubscription(estate._id, {
          planId: defaults.planId, planSlug: r.planSlug, cycle: defaults.cycle || 'monthly',
          trialDays: r.trialDays ?? defaults.trialDays ?? 14,
        }, req.user._id);
        results.push({ row: i + 1, name: estate.name, ok: true, estateId: estate._id, estateCode: estate.estateCode, manager: mgr?.user.email || null, managerCreated: !!mgr?.created });
      } catch (err) {
        results.push({ row: i + 1, name: checked[i].name, ok: false, error: err.status ? err.message : 'Server error' });
        if (!err.status) console.error('[onboarding bulk]', err);
      }
    }

    // One email per manager listing every estate they received
    let emailsSent = 0;
    if (sendEmails) {
      for (const { mgr, estates } of perManager.values()) {
        try {
          await sendManagerOnboardEmail({ to: mgr.user.email, name: mgr.user.name, estates, tempPassword: mgr.tempPassword, trialDays: Number(defaults.trialDays ?? 14) });
          emailsSent++;
        } catch (err) { console.error('[onboarding bulk] email', mgr.user.email, err.message); }
      }
    }

    return res.status(201).json({
      success: true,
      data: {
        batchId, results, emailsSent,
        created: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length,
        credentials: [...perManager.values()].filter(x => x.mgr.tempPassword)
          .map(x => ({ email: x.mgr.user.email, name: x.mgr.user.name, tempPassword: x.mgr.tempPassword, estates: x.estates.map(e => e.name) })),
      },
    });
  } catch (err) { return fail(res, err); }
};

// ── 3. Portfolio: add estates to an existing manager ──────────────────────────
// POST /api/admin/onboarding/portfolio
// { managerId, estates:[{name,address,city,state,estateType,unitCount}], existingEstateIds:[], billing:{}, sendEmail }
exports.addToPortfolio = async (req, res) => {
  try {
    const { managerId, estates = [], existingEstateIds = [], billing = {}, sendEmail = true } = req.body;
    const { user } = await upsertManager({ userId: managerId });
    const valid = estates.filter(e => e?.name?.trim() && e?.address?.trim());
    if (!valid.length && !existingEstateIds.length) return res.status(400).json({ success: false, message: 'Add at least one estate' });

    const created = [];
    for (const e of valid) {
      const estate = await createEstateDoc(e, { source: 'portfolio', adminId: req.user._id, managerId: user._id });
      await seedSubscription(estate._id, billing, req.user._id);
      created.push(estate);
    }
    const moved = existingEstateIds.length ? await Estate.find({ _id: { $in: existingEstateIds } }) : [];
    // Handover: take moved estates out of any previous owner's portfolio
    for (const est of moved) {
      const prev = await User.find({ _id: { $ne: user._id }, teamRole: { $ne: 'member' }, managedEstates: est._id });
      for (const p of prev) {
        p.managedEstates = p.managedEstates.filter(id => String(id) !== String(est._id));
        if (String(p.estateId) === String(est._id)) p.estateId = p.managedEstates[0] || null;
        await p.save();
      }
    }
    const all = [...created, ...moved];
    await attachToManager(user, all.map(e => e._id));

    let emailed = false;
    if (sendEmail && all.length) {
      try { await sendManagerOnboardEmail({ to: user.email, name: user.name, estates: all, trialDays: created.length ? Number(billing.trialDays ?? 14) : 0 }); emailed = true; }
      catch (err) { console.error('[onboarding portfolio] email', err.message); }
    }
    return res.status(201).json({ success: true, data: { manager: { _id: user._id, name: user.name, email: user.email }, created, assigned: moved, emailed } });
  } catch (err) { return fail(res, err); }
};

// ── 4. Invitations: manager self-onboards via the Register page ───────────────
const inviteLink = (inv) => {
  const p = new URLSearchParams({ invite: inv.token, plan: 'trial', email: inv.email });
  if (inv.name) p.set('name', inv.name);
  if (inv.phone) p.set('phone', inv.phone);
  if (inv.estateName) p.set('estate', inv.estateName);
  if (inv.estateAddress) p.set('address', inv.estateAddress);
  return `${MANAGER_APP()}/register?${p.toString()}`;
};

// POST /api/admin/onboarding/invites  { invites:[{name,email,phone,estateName,estateAddress,planSlug}], note }
exports.createInvites = async (req, res) => {
  try {
    const list = Array.isArray(req.body.invites) ? req.body.invites : [req.body];
    const note = String(req.body.note || '').slice(0, 600);
    const out = [];
    for (const raw of list.slice(0, 100)) {
      const email = String(raw.email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) { out.push({ email: raw.email, ok: false, error: 'Invalid email' }); continue; }
      if (await User.exists({ email })) { out.push({ email, ok: false, error: 'Already has an account — use “Add to portfolio”' }); continue; }
      await OnboardingInvite.updateMany({ email, status: 'pending' }, { status: 'revoked' });
      const inv = await OnboardingInvite.create({
        token: crypto.randomBytes(18).toString('hex'),
        name: raw.name || '', email, phone: raw.phone || '',
        estateName: raw.estateName || '', estateAddress: raw.estateAddress || '',
        planSlug: raw.planSlug || 'growth', note,
        expiresAt: new Date(Date.now() + 30 * 86400000), invitedBy: req.user._id,
      });
      const link = inviteLink(inv);
      let emailed = false;
      try { await sendOnboardingInviteEmail({ to: email, name: inv.name, estateName: inv.estateName, link, note }); emailed = true; }
      catch (err) { console.error('[onboarding invite] email', err.message); }
      out.push({ email, ok: true, emailed, link, inviteId: inv._id });
    }
    return res.status(201).json({ success: true, data: out });
  } catch (err) { return fail(res, err); }
};

// GET /api/admin/onboarding/invites
exports.listInvites = async (req, res) => {
  try {
    await OnboardingInvite.updateMany({ status: 'pending', expiresAt: { $lte: new Date() } }, { status: 'expired' });
    const invites = await OnboardingInvite.find().populate('estateId', 'name estateCode').populate('invitedBy', 'name')
      .sort({ createdAt: -1 }).limit(200).lean();
    return res.json({ success: true, data: invites.map(i => ({ ...i, link: i.status === 'pending' ? inviteLink(i) : null })) });
  } catch (err) { return fail(res, err); }
};

// POST /api/admin/onboarding/invites/:id/resend
exports.resendInvite = async (req, res) => {
  try {
    const inv = await OnboardingInvite.findById(req.params.id);
    if (!inv || inv.status === 'accepted') return res.status(404).json({ success: false, message: 'Invite not found or already accepted' });
    inv.status = 'pending'; inv.sentCount += 1; inv.lastSentAt = new Date();
    inv.expiresAt = new Date(Date.now() + 30 * 86400000);
    await inv.save();
    await sendOnboardingInviteEmail({ to: inv.email, name: inv.name, estateName: inv.estateName, link: inviteLink(inv), note: inv.note });
    return res.json({ success: true, data: inv });
  } catch (err) { return fail(res, err); }
};

// DELETE /api/admin/onboarding/invites/:id
exports.revokeInvite = async (req, res) => {
  try {
    await OnboardingInvite.updateOne({ _id: req.params.id, status: 'pending' }, { status: 'revoked' });
    return res.json({ success: true });
  } catch (err) { return fail(res, err); }
};

// Called from auth.register when a manager signs up — marks their invite accepted.
exports.markInviteAccepted = async ({ token, email, userId, estateId }) => {
  const q = token ? { token } : { email: String(email || '').toLowerCase(), status: 'pending' };
  const inv = await OnboardingInvite.findOne(q);
  if (!inv || inv.status === 'accepted') return;
  inv.status = 'accepted'; inv.acceptedAt = new Date(); inv.userId = userId; inv.estateId = estateId;
  await inv.save();
  if (estateId) await Estate.updateOne({ _id: estateId }, { 'onboarding.source': 'invite', 'onboarding.byId': inv.invitedBy });
};
