const Campaign = require('../models/Campaign');
const CampaignStat = require('../models/CampaignStat');
const User = require('../models/User');
const Estate = require('../models/Estate');
const Subscription = require('../models/Subscription');
const PushSubscription = require('../models/PushSubscription');
const emailService = require('../services/emailService');
const { emitNotification } = require('../services/socketService');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const BRAND = {
  name: 'AreaConnect',
  tagline: 'Your estate, together.',
  logoText: 'Area<span style="color:{PRIMARY}">Connect</span>',
  footer: 'Powered by Area Connector Technologies · RC 9607864',
};

// Grounding for the AI copywriter so generated campaigns stay true to the product.
const PRODUCT_FACTS = {
  resident: [
    '- Visitor passes: create a one-time gate code in seconds and share it on WhatsApp; the guard verifies it at the gate.',
    '- Pay estate dues/levies online (card, transfer, wallet) with automatic receipts and payment history.',
    '- Security: one-tap SOS alert to estate security, live estate alerts, safety check-ins.',
    '- The Lounge: the estate social feed — posts, polls, events, community chat with neighbours.',
    '- Marketplace: buy and sell within the estate; payments are held in escrow until the buyer confirms delivery.',
    '- AreaConnect FM: platform-wide live radio and podcasts featuring estate leaders and experts.',
    '- Announcements from the estate manager, event board, polls and voting, in-app calls to neighbours and the gate.',
  ].join('\n'),
  manager: [
    '- Run the whole estate from one dashboard: residents, units, visitors, alerts, announcements.',
    '- Collect dues and levies online with invoices, receipts, reminders and direct bank payouts.',
    '- Gate security app for guards: verify visitor codes, log entries/exits, respond to SOS alerts.',
    '- Broadcast announcements, polls and events to every resident instantly.',
    '- Marketplace with escrow and community Lounge to keep residents engaged.',
    '- Plans: free trial, then paid plans unlock more features; managers can upgrade from Billing.',
  ].join('\n'),
};

const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

const DAY = 86400000;
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const brandFor = () => ({ name: 'AreaConnect', logoUrl: process.env.BRAND_LOGO_URL || '' });
const appUrl = (role) => role === 'estate_manager'
  ? (process.env.MANAGER_URL || 'https://area-connector.areaconnect.pro')
  : (process.env.RESIDENTS_URL || 'https://area-mates.areaconnect.pro');
// Relative CTA paths ("/payments") become absolute links in emails and pushes.
const absUrl = (url, role) => (!url ? '' : /^https?:\/\//.test(url) ? url : `${appUrl(role)}${url.startsWith('/') ? '' : '/'}${url}`);

/** Derived lifecycle phase used by the admin UI. */
function phaseOf(c, now = Date.now()) {
  if (c.status !== 'active') return c.status;
  if (c.schedule?.startAt && new Date(c.schedule.startAt).getTime() > now) return 'scheduled';
  if (c.schedule?.endAt && new Date(c.schedule.endAt).getTime() < now) return 'expired';
  return 'live';
}

/** estateId -> { state, subStatus } for the given estates (one query each). */
async function estateCtxMap(estateIds) {
  const ids = [...new Set(estateIds.filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const [estates, subs] = await Promise.all([
    Estate.find({ _id: { $in: ids } }).select('state').lean(),
    Subscription.find({ estateId: { $in: ids } }).select('estateId status').lean(),
  ]);
  const map = new Map(estates.map((e) => [String(e._id), { state: e.state || '', subStatus: 'none' }]));
  subs.forEach((s) => { const m = map.get(String(s.estateId)); if (m) m.subStatus = s.status; });
  return map;
}

/** All active app users who match the campaign's audience. */
async function resolveTargets(campaign) {
  const users = await User.find({ isActive: true, role: { $in: ['resident', 'estate_manager'] } })
    .select('name email role estateId createdAt lastSeen').lean();
  const ctx = campaign.needsEstateCtx() ? await estateCtxMap(users.map((u) => u.estateId)) : new Map();
  return users.filter((u) => campaign.matchesUser(u, ctx.get(String(u.estateId)) || {}));
}

/** Run promises in small batches so we don't trip the mail provider's rate limit. */
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.allSettled(items.slice(i, i + size).map(fn)));
  }
  return out;
}

const LIGHT = '-seenBy -dismissedBy -clickedBy';

async function withCounts(docs) {
  const ids = docs.map((d) => d._id);
  const sizes = await Campaign.aggregate([
    { $match: { _id: { $in: ids } } },
    { $project: { reach: { $size: { $ifNull: ['$seenBy', []] } }, clickers: { $size: { $ifNull: ['$clickedBy', []] } } } },
  ]);
  const m = new Map(sizes.map((s) => [String(s._id), s]));
  const now = Date.now();
  return docs.map((d) => {
    const s = m.get(String(d._id)) || {};
    const imp = d.metrics?.impressions || 0;
    return { ...d, phase: phaseOf(d, now), reach: s.reach || 0, clickers: s.clickers || 0, ctr: imp ? +(((d.metrics?.clicks || 0) / imp) * 100).toFixed(1) : 0 };
  });
}

// ── Admin: list / read ──────────────────────────────────────────────────────
exports.listAll = async (req, res) => {
  try {
    const { status, placement, goal, q } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (placement) filter.placements = placement;
    if (goal) filter.goal = goal;
    if (q) filter.name = { $regex: q, $options: 'i' };

    const docs = await Campaign.find(filter).select(`${LIGHT} -email.htmlBody`)
      .populate('createdBy', 'name email')
      .populate('audience.estateIds', 'name')
      .sort({ createdAt: -1 }).lean();

    return res.json({ success: true, data: await withCounts(docs) });
  } catch (err) {
    console.error('listAll campaigns', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getById = async (req, res) => {
  try {
    const c = await Campaign.findById(req.params.id).select(LIGHT).populate('createdBy', 'name email').lean();
    if (!c) return res.status(404).json({ success: false, message: 'Not found' });
    const [withC] = await withCounts([c]);
    return res.json({ success: true, data: withC });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /campaigns/overview?days=30 — KPIs, trend and leaderboards for the hub
exports.overview = async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 90);
    const since = dayKey(Date.now() - (days - 1) * DAY);
    const prevSince = dayKey(Date.now() - (days * 2 - 1) * DAY);

    const [docs, rows, prevRows] = await Promise.all([
      Campaign.find().select(`${LIGHT} -email.htmlBody`).lean(),
      CampaignStat.aggregate([
        { $match: { day: { $gte: since } } },
        { $group: { _id: '$day', impressions: { $sum: '$impressions' }, clicks: { $sum: '$clicks' }, dismissals: { $sum: '$dismissals' }, emails: { $sum: '$emails' }, pushes: { $sum: '$pushes' } } },
      ]),
      CampaignStat.aggregate([
        { $match: { day: { $gte: prevSince, $lt: since } } },
        { $group: { _id: null, impressions: { $sum: '$impressions' }, clicks: { $sum: '$clicks' } } },
      ]),
    ]);
    const list = await withCounts(docs);

    const byDay = new Map(rows.map((r) => [r._id, r]));
    const series = Array.from({ length: days }, (_, i) => {
      const d = dayKey(Date.now() - (days - 1 - i) * DAY);
      const r = byDay.get(d) || {};
      return { day: d, impressions: r.impressions || 0, clicks: r.clicks || 0, dismissals: r.dismissals || 0, emails: r.emails || 0, pushes: r.pushes || 0 };
    });
    const sum = (k) => series.reduce((a, r) => a + r[k], 0);
    const period = { impressions: sum('impressions'), clicks: sum('clicks'), dismissals: sum('dismissals'), emails: sum('emails'), pushes: sum('pushes') };
    const prev = prevRows[0] || { impressions: 0, clicks: 0 };

    const phases = {};
    list.forEach((c) => { phases[c.phase] = (phases[c.phase] || 0) + 1; });
    const channels = {};
    list.forEach((c) => (c.placements || []).forEach((p) => {
      channels[p] = channels[p] || { campaigns: 0, live: 0, impressions: 0, clicks: 0 };
      channels[p].campaigns += 1;
      if (c.phase === 'live') channels[p].live += 1;
      channels[p].impressions += c.metrics?.impressions || 0;
      channels[p].clicks += c.metrics?.clicks || 0;
    }));
    const goals = {};
    list.forEach((c) => {
      const g = c.goal || 'onboarding';
      goals[g] = goals[g] || { campaigns: 0, impressions: 0, clicks: 0 };
      goals[g].campaigns += 1; goals[g].impressions += c.metrics?.impressions || 0; goals[g].clicks += c.metrics?.clicks || 0;
    });

    const lifetime = list.reduce((a, c) => ({
      impressions: a.impressions + (c.metrics?.impressions || 0),
      clicks: a.clicks + (c.metrics?.clicks || 0),
      emails: a.emails + (c.metrics?.emailsSent || 0),
      pushes: a.pushes + (c.metrics?.pushesSent || 0),
      reach: a.reach + c.reach,
    }), { impressions: 0, clicks: 0, emails: 0, pushes: 0, reach: 0 });

    const slim = (c) => ({ _id: c._id, name: c.name, goal: c.goal, phase: c.phase, placements: c.placements, ctr: c.ctr, reach: c.reach, metrics: c.metrics, schedule: c.schedule, content: { headline: c.content?.headline, theme: c.content?.theme } });
    const top = list.filter((c) => (c.metrics?.impressions || 0) >= 10).sort((a, b) => b.ctr - a.ctr).slice(0, 5).map(slim);
    const now = Date.now();
    const attention = [];
    list.forEach((c) => {
      if (c.phase === 'live' && !(c.metrics?.impressions) && (c.placements || []).some((p) => ['modal', 'dashboard_banner', 'lounge_feed'].includes(p)) && now - new Date(c.updatedAt).getTime() > 2 * DAY)
        attention.push({ ...slim(c), reason: 'Live for 2+ days with no impressions — check the audience' });
      else if (c.phase === 'live' && (c.metrics?.impressions || 0) >= 50 && c.ctr < 1)
        attention.push({ ...slim(c), reason: `Low click-through (${c.ctr}%) — try a sharper headline or CTA` });
      else if (c.phase === 'live' && c.schedule?.endAt && new Date(c.schedule.endAt).getTime() - now < 3 * DAY)
        attention.push({ ...slim(c), reason: 'Ends within 3 days' });
      else if (c.phase === 'expired')
        attention.push({ ...slim(c), reason: 'Schedule has ended but it is still marked active' });
      else if ((c.placements || []).includes('email') && c.phase === 'live' && !(c.metrics?.emailsSent) && !c.email?.sendOnUserSignup)
        attention.push({ ...slim(c), reason: 'Email channel is on but nothing has been sent yet' });
    });
    const upcoming = list.filter((c) => c.phase === 'scheduled').sort((a, b) => new Date(a.schedule.startAt) - new Date(b.schedule.startAt)).slice(0, 5).map(slim);

    const [residents, managers, pushUsers] = await Promise.all([
      User.countDocuments({ role: 'resident', isActive: true }),
      User.countDocuments({ role: 'estate_manager', isActive: true }),
      PushSubscription.distinct('userId'),
    ]);

    return res.json({ success: true, data: {
      days, series, period, prev, phases, channels, goals, lifetime, top, attention: attention.slice(0, 6), upcoming,
      total: list.length, addressable: { residents, managers, push: pushUsers.length },
    } });
  } catch (err) {
    console.error('campaign overview', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /campaigns/estimate { audience } — live reach estimate for the builder
exports.estimate = async (req, res) => {
  try {
    const probe = new Campaign({ name: 'probe', slug: 'probe', content: { headline: 'x' }, audience: req.body?.audience || {} });
    const targets = await resolveTargets(probe);
    const ids = targets.map((u) => u._id);
    const pushIds = await PushSubscription.distinct('userId', { userId: { $in: ids } });

    const byRole = { resident: 0, estate_manager: 0 };
    const byEstate = new Map();
    targets.forEach((u) => {
      byRole[u.role] = (byRole[u.role] || 0) + 1;
      if (u.estateId) byEstate.set(String(u.estateId), (byEstate.get(String(u.estateId)) || 0) + 1);
    });
    const topIds = [...byEstate.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const names = await Estate.find({ _id: { $in: topIds.map(([id]) => id) } }).select('name').lean();
    const nameOf = new Map(names.map((e) => [String(e._id), e.name]));

    return res.json({ success: true, data: {
      total: targets.length,
      byRole,
      estates: byEstate.size,
      withEmail: targets.filter((u) => u.email).length,
      withPush: pushIds.length,
      active30: targets.filter((u) => u.lastSeen && Date.now() - new Date(u.lastSeen).getTime() < 30 * DAY).length,
      topEstates: topIds.map(([id, n]) => ({ _id: id, name: nameOf.get(id) || 'Estate', users: n })),
    } });
  } catch (err) {
    console.error('campaign estimate', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /campaigns/:id/stats — trend, funnel and send history for one campaign
exports.stats = async (req, res) => {
  try {
    const c = await Campaign.findById(req.params.id).select(LIGHT).populate('sends.by', 'name').lean();
    if (!c) return res.status(404).json({ success: false, message: 'Not found' });
    const [withC] = await withCounts([c]);
    const days = 30;
    const since = dayKey(Date.now() - (days - 1) * DAY);
    const rows = await CampaignStat.find({ campaignId: c._id, day: { $gte: since } }).lean();
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const series = Array.from({ length: days }, (_, i) => {
      const d = dayKey(Date.now() - (days - 1 - i) * DAY);
      const r = byDay.get(d) || {};
      return { day: d, impressions: r.impressions || 0, clicks: r.clicks || 0, dismissals: r.dismissals || 0, emails: r.emails || 0, pushes: r.pushes || 0 };
    });
    return res.json({ success: true, data: {
      campaign: withC, series,
      funnel: { reach: withC.reach, impressions: c.metrics?.impressions || 0, clicks: c.metrics?.clicks || 0, clickers: withC.clickers, dismissals: c.metrics?.dismissals || 0 },
      sends: (c.sends || []).slice(-20).reverse(),
    } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Admin: write ────────────────────────────────────────────────────────────
const WRITABLE = ['name', 'status', 'goal', 'priority', 'frequency', 'notes', 'placements', 'audience', 'content', 'email', 'push', 'schedule'];
const pick = (body) => Object.fromEntries(WRITABLE.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));

async function uniqueSlug(name) {
  const baseSlug = slugify(name) || `campaign-${Date.now()}`;
  let slug = baseSlug;
  let n = 1;
  while (await Campaign.exists({ slug })) { n += 1; slug = `${baseSlug}-${n}`; }
  return slug;
}

exports.create = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.name || !body.content?.headline) {
      return res.status(400).json({ success: false, message: 'name and content.headline required' });
    }
    const campaign = await Campaign.create({ ...pick(body), slug: await uniqueSlug(body.slug || body.name), createdBy: req.user._id });
    return res.status(201).json({ success: true, data: campaign });
  } catch (err) {
    console.error('create campaign', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

exports.update = async (req, res) => {
  try {
    const c = await Campaign.findByIdAndUpdate(req.params.id, pick(req.body || {}), { new: true, runValidators: true }).select(LIGHT);
    if (!c) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, data: c });
  } catch (err) {
    console.error('update campaign', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

exports.duplicate = async (req, res) => {
  try {
    const src = await Campaign.findById(req.params.id).lean();
    if (!src) return res.status(404).json({ success: false, message: 'Not found' });
    const copy = await Campaign.create({
      ...pick(src), name: `${src.name} (copy)`, status: 'draft',
      slug: await uniqueSlug(`${src.name} copy`), createdBy: req.user._id,
    });
    return res.status(201).json({ success: true, data: copy });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

exports.setStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!Campaign.STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const c = await Campaign.findByIdAndUpdate(req.params.id, { status }, { new: true }).select(LIGHT);
    if (!c) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, data: c });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.remove = async (req, res) => {
  try {
    await Campaign.findByIdAndDelete(req.params.id);
    await CampaignStat.deleteMany({ campaignId: req.params.id });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── End users ───────────────────────────────────────────────────────────────
exports.getActiveForUser = async (req, res) => {
  try {
    const { placement } = req.query;
    const filter = { status: 'active' };
    if (placement) filter.placements = placement;

    const now = new Date();
    const candidates = await Campaign.find(filter).select('-email.htmlBody').sort({ priority: 1, createdAt: -1 });
    const live = candidates.filter((c) => !(c.schedule?.startAt && c.schedule.startAt > now) && !(c.schedule?.endAt && c.schedule.endAt < now));

    let ctx = {};
    if (live.some((c) => c.needsEstateCtx()) && req.user.estateId) {
      ctx = (await estateCtxMap([req.user.estateId])).get(String(req.user.estateId._id || req.user.estateId)) || {};
    }

    const uid = req.user._id.toString();
    const has = (arr) => (arr || []).some((id) => id.toString() === uid);
    const data = live
      .filter((c) => c.matchesUser(req.user, ctx))
      .filter((c) => {
        if (has(c.dismissedBy)) return false;
        if (c.frequency === 'once' && has(c.seenBy)) return false;
        if (c.frequency === 'until_clicked' && has(c.clickedBy)) return false;
        return true;
      })
      .map((c) => {
        const o = c.toObject();
        const viewer = { seen: has(c.seenBy), dismissed: false };
        delete o.seenBy; delete o.dismissedBy; delete o.clickedBy; delete o.sends; delete o.notes;
        return { ...o, _viewer: viewer };
      });

    return res.json({ success: true, data });
  } catch (err) {
    console.error('getActiveForUser', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.markSeen = async (req, res) => {
  try {
    await Campaign.findByIdAndUpdate(req.params.id, {
      $addToSet: { seenBy: req.user._id },
      $inc: { 'metrics.impressions': 1 },
    });
    CampaignStat.bump(req.params.id, 'impressions');
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.dismiss = async (req, res) => {
  try {
    await Campaign.findByIdAndUpdate(req.params.id, {
      $addToSet: { dismissedBy: req.user._id },
      $inc: { 'metrics.dismissals': 1 },
    });
    CampaignStat.bump(req.params.id, 'dismissals');
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.click = async (req, res) => {
  try {
    await Campaign.findByIdAndUpdate(req.params.id, { $inc: { 'metrics.clicks': 1 }, $addToSet: { clickedBy: req.user._id } });
    CampaignStat.bump(req.params.id, 'clicks');
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Sends ───────────────────────────────────────────────────────────────────
const emailArgs = (c, u) => ({
  to: u.email,
  name: u.name,
  subject: c.email.subject,
  preheader: c.email.preheader,
  htmlBody: c.email.htmlBody,
  ctaUrl: absUrl(c.content.ctaUrl, u.role),
  ctaText: c.content.ctaText,
  theme: c.content.theme,
  brand: brandFor(),
});

exports.sendEmailBlast = async (req, res) => {
  try {
    const c = await Campaign.findById(req.params.id).select(LIGHT);
    if (!c) return res.status(404).json({ success: false, message: 'Not found' });
    if (!c.placements.includes('email')) {
      return res.status(400).json({ success: false, message: 'Turn on the Email channel for this campaign first' });
    }
    if (!c.email?.subject || !c.email?.htmlBody) {
      return res.status(400).json({ success: false, message: 'Email subject and body required' });
    }

    const targets = (await resolveTargets(c)).filter((u) => u.email);
    const results = await inBatches(targets, 8, (u) => emailService.sendCampaignEmail(emailArgs(c, u)));
    const sent = results.filter((r) => r.status === 'fulfilled' && !r.value?.skipped).length;

    await Campaign.findByIdAndUpdate(c._id, {
      $inc: { 'metrics.emailsSent': sent },
      $push: { sends: { channel: 'email', targeted: targets.length, sent, by: req.user._id } },
    });
    if (sent) CampaignStat.bump(c._id, 'emails', sent);

    return res.json({ success: true, data: { targeted: targets.length, sent } });
  } catch (err) {
    console.error('sendEmailBlast', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// POST /campaigns/:id/test-email — preview the email in the admin's own inbox
exports.sendTestEmail = async (req, res) => {
  try {
    const c = await Campaign.findById(req.params.id).select(LIGHT);
    if (!c) return res.status(404).json({ success: false, message: 'Not found' });
    if (!c.email?.subject || !c.email?.htmlBody) return res.status(400).json({ success: false, message: 'Add an email subject and body first' });
    const to = (req.body?.to || req.user.email || '').trim();
    const r = await emailService.sendCampaignEmail({ ...emailArgs(c, { email: to, name: req.user.name, role: 'resident' }), subject: `[Test] ${c.email.subject}` });
    if (r?.skipped) return res.status(503).json({ success: false, message: 'Email is not configured on the server (RESEND_API_KEY)' });
    await Campaign.findByIdAndUpdate(c._id, { $push: { sends: { channel: 'test_email', targeted: 1, sent: 1, by: req.user._id } } });
    return res.json({ success: true, data: { to } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// POST /campaigns/:id/send-push — bell notification + device push to every match
exports.sendPush = async (req, res) => {
  try {
    const c = await Campaign.findById(req.params.id).select(LIGHT);
    if (!c) return res.status(404).json({ success: false, message: 'Not found' });
    if (!c.placements.includes('push')) return res.status(400).json({ success: false, message: 'Turn on the Push channel for this campaign first' });
    const title = (c.push?.title || c.content?.headline || '').trim();
    const body = (c.push?.body || c.content?.subheadline || '').trim();
    if (!title) return res.status(400).json({ success: false, message: 'Add a push title first' });

    const targets = await resolveTargets(c);
    const push = require('../services/pushService');
    const relUrl = c.push?.url || c.content?.ctaUrl || '/';
    let devices = 0;
    await inBatches(targets, 20, async (u) => {
      emitNotification(String(u.estateId || ''), {
        id: `campaign:${c._id}:${u._id}`, type: 'campaign', title, body,
        meta: { kind: 'campaign', campaignId: String(c._id), url: relUrl },
      }, String(u._id));
      const r = await push.sendToUser(u._id, { title, body, url: relUrl, tag: `campaign-${c._id}` }, { ttl: 86400 });
      if (r?.sent) devices += 1;
    });

    await Campaign.findByIdAndUpdate(c._id, {
      $inc: { 'metrics.pushesSent': targets.length },
      $push: { sends: { channel: 'push', targeted: targets.length, sent: devices, by: req.user._id } },
    });
    if (targets.length) CampaignStat.bump(c._id, 'pushes', targets.length);

    return res.json({ success: true, data: { targeted: targets.length, devices } });
  } catch (err) {
    console.error('sendPush', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// ── AI: generate email + ad content with Gemini ─────────────────────────────
exports.generateEmailContent = async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ success: false, message: 'GEMINI_API_KEY not configured' });
    }

    const {
      goal = 'Welcome new members and introduce the platform',
      audience = 'new residents on AreaConnect',
      tone = 'warm, confident, briefly witty',
      theme = {},
      brand = {},
      ctaText,
      ctaUrl,
      includeAd = true,
      app = 'resident',
    } = req.body || {};

    const primary   = theme.primaryColor     || '#059669';
    const accent    = theme.accentColor      || '#34D399';
    const bg        = theme.backgroundColor  || '#0F172A';
    const textColor = theme.textColor        || '#FFFFFF';
    const brandName = brand.name  || BRAND.name;
    const logoUrl   = brand.logoUrl || '';

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `You are a senior email designer + copywriter for "${brandName}", a Nigerian estate-management SaaS. Write a marketing email that looks like a modern SaaS product email (Linear, Notion, Stripe) — visually structured, not a wall of text.

WHAT ${brandName.toUpperCase()} ACTUALLY OFFERS — only promise things from this list, never invent features, prices or discounts:
${app === 'estate_manager' ? PRODUCT_FACTS.manager : PRODUCT_FACTS.resident}

GOAL: ${goal}
AUDIENCE: ${audience}
TONE: ${tone}
BRAND COLORS: primary=${primary}, accent=${accent}, background=${bg}, text=${textColor}
CTA TEXT (if provided, keep it): ${ctaText || '(pick one)'}
CTA URL: ${ctaUrl || '(none — do not invent one)'}

DESIGN LANGUAGE (the server wraps a logo header + gradient stripe + footer around your snippet — do NOT include those):
- Open with a bold H1 headline (fontSize:22-26px, fontWeight:800, letterSpacing:-0.02em, color:#0F172A, marginBottom:8px). One line.
- Follow with an intro paragraph (fontSize:15px, color:#475569, lineHeight:1.65).
- Include 2-4 "feature callouts" as div blocks with borderLeft:3px solid ${primary}, background:#F8FAFC, padding:14px 16px, borderRadius:8px, marginBottom:12px. Each has a bold title line (fontSize:14px, fontWeight:700, color:#0F172A) and a supporting line (fontSize:13px, color:#64748B, lineHeight:1.55). A single small emoji at the START of the title is fine.
- Between blocks, use a subtle divider: <div style="height:1px;background:#F1F5F9;margin:20px 0;"></div>
- Optionally add a quote/highlight card with background:${primary}0F, border:1px solid ${primary}33, padding:16px 18px, borderRadius:12px.
- Close with one short human sign-off paragraph (fontSize:14px, color:#475569).

HARD RULES
- HTML is a snippet only — no <html>, <head>, <body>, <style>, <script>, <link>, or <img> tags. No class attributes. Inline styles only.
- Address the reader once as "Hi {{name}}," on its own line before the H1. Use the literal placeholder — the server substitutes it.
- No "click here" language. CTAs are concrete verbs.
- Max 3 emojis in the entire body. None in subject or preheader.
- The subject uses no emojis. Under 60 chars. Concrete.
- The preheader is a distinct value-prop teaser (not "welcome to X"). Under 90 chars.
- Do NOT include the CTA button in htmlBody — the server appends it based on ctaText/ctaUrl.

RESPOND WITH ONLY RAW JSON — no markdown, no code fences, no commentary. Start with { and end with }.

Schema:
{
  "subject": "email subject line (max 60 chars, no emojis)",
  "preheader": "preview text shown in inbox (max 90 chars, no emojis, no {{name}})",
  "htmlBody": "the styled HTML snippet described above (structured divs, not paragraphs)",
  "ad": {
    "badge": "SHORT UPPERCASE BADGE (max 3 words)",
    "headline": "punchy headline (max 60 chars)",
    "subheadline": "one-line follow-up (max 80 chars)",
    "body": "2–3 short lines, plain text, separated by \\n\\n",
    "ctaText": "concrete verb CTA (2–4 words)"
  }
}`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) {
        return res.status(500).json({ success: false, message: 'AI returned unparseable content' });
      }
      parsed = JSON.parse(match[0]);
    }

    // Basic sanitization
    const email = {
      subject:   String(parsed.subject   || '').slice(0, 140),
      preheader: String(parsed.preheader || '').slice(0, 180),
      htmlBody:  String(parsed.htmlBody  || ''),
    };
    const ad = includeAd && parsed.ad ? {
      badge:       String(parsed.ad.badge       || '').slice(0, 40),
      headline:    String(parsed.ad.headline    || '').slice(0, 120),
      subheadline: String(parsed.ad.subheadline || '').slice(0, 180),
      body:        String(parsed.ad.body        || ''),
      ctaText:     String(parsed.ad.ctaText     || 'Get Started').slice(0, 40),
    } : null;

    return res.json({
      success: true,
      data: {
        email,
        ad,
        theme: { primaryColor: primary, accentColor: accent, backgroundColor: bg, textColor },
        brand: { name: brandName, logoUrl },
      },
    });
  } catch (err) {
    console.error('generateEmailContent', err);
    return res.status(500).json({ success: false, message: err.message || 'AI generation failed' });
  }
};

// Called from authController on signup — fires email campaigns marked sendOnUserSignup
exports.onUserSignup = async (user) => {
  try {
    const campaigns = await Campaign.find({
      status: 'active',
      placements: 'email',
      'email.sendOnUserSignup': true,
    });

    for (const c of campaigns) {
      let ctx = {};
      if (c.needsEstateCtx() && user.estateId) ctx = (await estateCtxMap([user.estateId])).get(String(user.estateId)) || {};
      if (!c.matchesUser(user, ctx)) continue;
      if (!c.email?.subject || !c.email?.htmlBody) continue;

      try {
        await emailService.sendCampaignEmail({
          to: user.email,
          name: user.name,
          subject: c.email.subject,
          preheader: c.email.preheader,
          htmlBody: c.email.htmlBody,
          ctaUrl: absUrl(c.content.ctaUrl, user.role),
          ctaText: c.content.ctaText,
          theme: c.content.theme,
          brand: brandFor(),
        });
        await Campaign.findByIdAndUpdate(c._id, { $inc: { 'metrics.emailsSent': 1 } });
        CampaignStat.bump(c._id, 'emails');
      } catch (e) {
        console.error('campaign email on signup failed', c.slug, e.message);
      }
    }
  } catch (err) {
    console.error('onUserSignup campaigns', err);
  }
};
