const axios = require('axios');
const mongoose = require('mongoose');
const Call = require('../models/Call');
const Buzz = require('../models/Buzz');
const User = require('../models/User');
const Estate = require('../models/Estate');
const CreditTransaction = require('../models/CreditTransaction');
const calls = require('../services/callService');
const { getIO, emitNotification } = require('../services/socketService');
const { RATE_PER_MINUTE, CREDIT_PACKS, packById, addCredits, getBalance } = require('../utils/credits');
const { avatarUrl } = require('../utils/avatarUrl');
const { sendBuzzEmail } = require('../services/emailService');

const PAYSTACK_BASE = 'https://api.paystack.co';
const paystackHeaders = () => ({ Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' });
const RESIDENTS_URL = () => process.env.RESIDENTS_URL || 'https://area-mates.areaconnect.pro';
const STAFF_ROLES = ['security', 'estate_manager', 'super_admin'];

const unitLabel = (u) => (u ? `${u.block ? `Block ${u.block} · ` : ''}Unit ${u.unitNumber}` : '');
const isOnline = (userId) => (getIO()?.of('/').adapter.rooms.get(`user:${userId}`)?.size || 0) > 0;
const publicProfile = (u) => u && ({
  _id: u._id, name: u.name, role: u.role, profilePhoto: u.profilePhoto || '',
  unit: unitLabel(u.unitId), online: isOnline(u._id),
});

// STUN only (free, public) — lets two devices find a direct path when one
// exists. When it doesn't, calls carry on over our own audio relay
// (services/callService.relayAudio); there is no TURN dependency.
const iceServers = () => [{ urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }];

// Is `user` (any role) a member of `estateId`? Managers may manage several.
const inEstate = (user, estateId) =>
  String(user.estateId) === String(estateId) ||
  (user.managedEstates || []).some((e) => String(e) === String(estateId));

// ── Config / directory ──────────────────────────────────────────────────────

exports.getConfig = async (req, res) => {
  const balance = await getBalance(req.user._id);
  res.json({ success: true, data: { iceServers: iceServers(), ratePerMinute: RATE_PER_MINUTE, packs: CREDIT_PACKS, balance } });
};

exports.getDirectory = async (req, res) => {
  try {
    const estateId = req.estateId;
    const [neighbours, staff] = await Promise.all([
      User.find({ estateId, role: 'resident', isActive: true, isDiscoverable: { $ne: false }, _id: { $ne: req.user._id } })
        .select('name role profilePhoto unitId').populate('unitId', 'unitNumber block').sort({ name: 1 }).lean(),
      User.find({
        isActive: true, _id: { $ne: req.user._id },
        $or: [{ role: 'security', estateId }, { role: 'estate_manager', $or: [{ estateId }, { managedEstates: estateId }] }],
      }).select('name role profilePhoto').sort({ role: 1, name: 1 }).lean(),
    ]);
    res.json({ success: true, data: { neighbours: neighbours.map(publicProfile), staff: staff.map(publicProfile) } });
  } catch (e) {
    console.error('[calls.directory]', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Calls ───────────────────────────────────────────────────────────────────

exports.startCall = async (req, res) => {
  try {
    const { calleeId } = req.body;
    const me = req.user;
    if (!mongoose.isValidObjectId(calleeId) || String(calleeId) === String(me._id)) {
      return res.status(400).json({ success: false, message: 'Pick someone to call' });
    }
    const callee = await User.findById(calleeId).select('name role profilePhoto estateId managedEstates isActive isDiscoverable unitId').populate('unitId', 'unitNumber block').lean();
    if (!callee || !callee.isActive || !inEstate(callee, req.estateId)) {
      return res.status(404).json({ success: false, message: 'That person isn\'t in your estate' });
    }

    // Who pays: resident → resident is a paid call. Resident → security /
    // management is an emergency call (free). Staff calling anyone is free.
    let kind;
    if (STAFF_ROLES.includes(me.role)) kind = 'staff';
    else if (STAFF_ROLES.includes(callee.role)) kind = 'emergency';
    else if (callee.role === 'resident') {
      if (callee.isDiscoverable === false) return res.status(403).json({ success: false, message: 'This neighbour isn\'t taking calls' });
      kind = 'standard';
    } else return res.status(403).json({ success: false, message: 'You can\'t call this account' });

    if (kind === 'standard') {
      const balance = await getBalance(me._id);
      if (balance < RATE_PER_MINUTE) {
        return res.status(402).json({ success: false, code: 'NO_CREDITS', message: 'You need call credits to call a neighbour. Emergency calls to security and management are free.' });
      }
    }

    // One call at a time, both sides. Abuse guard: ≤ 10 call attempts / 5 min.
    const [busy, recent] = await Promise.all([
      Call.findOne({ status: { $in: ['ringing', 'active'] }, $or: [{ callerId: { $in: [me._id, callee._id] } }, { calleeId: { $in: [me._id, callee._id] } }] }).select('callerId calleeId').lean(),
      Call.countDocuments({ callerId: me._id, createdAt: { $gt: new Date(Date.now() - 5 * 60_000) } }),
    ]);
    if (busy) {
      const meBusy = [String(busy.callerId), String(busy.calleeId)].includes(String(me._id));
      return res.status(409).json({ success: false, code: 'BUSY', message: meBusy ? 'You\'re already on a call' : `${callee.name.split(' ')[0]} is on another call` });
    }
    if (recent >= 10) return res.status(429).json({ success: false, message: 'Too many calls in a short time — try again in a few minutes' });

    const call = await Call.create({
      estateId: req.estateId, callerId: me._id, calleeId: callee._id, kind,
      ratePerMinute: kind === 'standard' ? RATE_PER_MINUTE : 0,
    });
    const meFull = await User.findById(me._id).select('name role profilePhoto unitId').populate('unitId', 'unitNumber block').lean();
    calls.startRinging(call, {
      callId: String(call._id), kind,
      from: publicProfile(meFull),
      iceServers: iceServers(),
    });

    res.status(201).json({ success: true, data: { call, callee: publicProfile(callee), iceServers: iceServers() } });
  } catch (e) {
    console.error('[calls.start]', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.answerCall = async (req, res) => {
  const call = await calls.answer(req.params.id, req.user._id);
  if (!call) return res.status(409).json({ success: false, message: 'This call has ended' });
  res.json({ success: true, data: { call, iceServers: iceServers() } });
};

// decline (callee), cancel (caller while ringing), end (either, any time)
const endBy = (ringingStatus, reason) => async (req, res) => {
  const call = await Call.findById(req.params.id).select('callerId calleeId').lean();
  const uid = String(req.user._id);
  if (!call || (String(call.callerId) !== uid && String(call.calleeId) !== uid)) {
    return res.status(404).json({ success: false, message: 'Call not found' });
  }
  const done = await calls.finalize(req.params.id, { ringingStatus, reason, endedBy: req.user._id });
  res.json({ success: true, data: done });
};
exports.declineCall = endBy('declined', 'declined');
exports.cancelCall  = endBy('cancelled', 'cancelled');
exports.endCall     = endBy('cancelled', 'hangup');

exports.getHistory = async (req, res) => {
  const me = req.user._id;
  const list = await Call.find({ $or: [{ callerId: me }, { calleeId: me }] })
    .sort({ createdAt: -1 }).limit(50)
    .populate('callerId', 'name role profilePhoto')
    .populate('calleeId', 'name role profilePhoto')
    .lean();
  res.json({ success: true, data: list.map((c) => ({ ...c, direction: String(c.callerId?._id) === String(me) ? 'outgoing' : 'incoming' })) });
};

// ── Credits ─────────────────────────────────────────────────────────────────

exports.getCredits = async (req, res) => {
  const [balance, ledger] = await Promise.all([
    getBalance(req.user._id),
    CreditTransaction.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(30).lean(),
  ]);
  res.json({ success: true, data: { balance, ratePerMinute: RATE_PER_MINUTE, packs: CREDIT_PACKS, ledger } });
};

exports.startTopup = async (req, res) => {
  try {
    const pack = packById(req.body.packId);
    if (!pack) return res.status(400).json({ success: false, message: 'Pick a credit pack' });
    if (!process.env.PAYSTACK_SECRET_KEY) return res.status(503).json({ success: false, message: 'Payments are not configured' });
    const reference = `CRD-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const origin = req.headers.origin || RESIDENTS_URL();
    const { data } = await axios.post(`${PAYSTACK_BASE}/transaction/initialize`, {
      email: req.user.email,
      amount: pack.price * 100,
      reference,
      callback_url: `${origin}/neighbours?topup=${reference}`,
      metadata: {
        type: 'credit_topup', userId: String(req.user._id), estateId: String(req.estateId || ''),
        packId: pack.id, credits: pack.credits,
        custom_fields: [{ display_name: 'Purchase', variable_name: 'purchase', value: `${pack.credits} call credits` }],
      },
    }, { headers: paystackHeaders() });
    res.json({ success: true, data: { authorizationUrl: data.data.authorization_url, reference } });
  } catch (e) {
    console.error('[credits.topup]', e.response?.data || e.message);
    res.status(502).json({ success: false, message: 'Could not start payment. Try again.' });
  }
};

/**
 * Credit a verified Paystack transaction. Shared by the redirect verify and
 * the webhook; idempotent on the Paystack reference.
 */
async function settleTopup(tx) {
  const meta = tx?.metadata || {};
  if (tx?.status !== 'success' || meta.type !== 'credit_topup') return { ok: false };
  const pack = packById(meta.packId);
  // Trust what Paystack says was paid, not just the metadata.
  if (!pack || tx.amount < pack.price * 100) return { ok: false, reason: 'amount_mismatch' };
  const r = await addCredits(meta.userId, pack.credits, {
    type: 'topup', reference: tx.reference, amountPaid: tx.amount / 100,
    estateId: mongoose.isValidObjectId(meta.estateId) ? meta.estateId : undefined,
    description: `Bought ${pack.label}`,
  });
  if (r.added) {
    emitNotification(null, {
      id: `credits-${tx.reference}`, type: 'credits_added',
      title: 'Call credits added', body: `${pack.credits} credits added — balance ${r.balance}`,
      meta: { balance: r.balance },
    }, meta.userId);
  }
  return { ok: true, ...r, credits: pack.credits };
}
exports.settleTopup = settleTopup;

exports.verifyTopup = async (req, res) => {
  try {
    const { data } = await axios.get(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(req.params.reference)}`, { headers: paystackHeaders() });
    const tx = data.data;
    if (String(tx?.metadata?.userId) !== String(req.user._id)) return res.status(404).json({ success: false, message: 'Payment not found' });
    const r = await settleTopup(tx);
    if (!r.ok) return res.status(400).json({ success: false, message: tx?.status === 'success' ? 'Payment could not be applied' : 'Payment was not completed' });
    res.json({ success: true, data: { balance: r.balance, credits: r.credits, alreadyApplied: !r.added } });
  } catch (e) {
    console.error('[credits.verify]', e.response?.data || e.message);
    res.status(502).json({ success: false, message: 'Could not verify payment' });
  }
};

// ── Buzz ────────────────────────────────────────────────────────────────────

const BUZZ_KINDS = ['checkin', 'greeting', 'thinking_of_you'];
const BUZZ_TITLE = {
  checkin: (n) => `${n} is checking up on you 👋`,
  greeting: (n) => `${n} says hello 😊`,
  thinking_of_you: (n) => `${n} is thinking of you 💛`,
};

exports.sendBuzz = async (req, res) => {
  try {
    const { toUserId, kind: rawKind, message } = req.body;
    const kind = BUZZ_KINDS.includes(rawKind) ? rawKind : 'checkin';
    if (!mongoose.isValidObjectId(toUserId) || String(toUserId) === String(req.user._id)) {
      return res.status(400).json({ success: false, message: 'Pick a neighbour to buzz' });
    }
    const to = await User.findOne({ _id: toUserId, estateId: req.estateId, role: 'resident', isActive: true, isDiscoverable: { $ne: false } })
      .select('name email').lean();
    if (!to) return res.status(404).json({ success: false, message: 'Neighbour not found' });

    // Friendly, not spammy: one buzz per neighbour every 2 hours, 20 a day.
    const [lastToThem, today] = await Promise.all([
      Buzz.findOne({ fromId: req.user._id, toId: to._id, createdAt: { $gt: new Date(Date.now() - 2 * 3600_000) } }).select('createdAt').lean(),
      Buzz.countDocuments({ fromId: req.user._id, createdAt: { $gt: new Date(Date.now() - 24 * 3600_000) } }),
    ]);
    if (lastToThem) return res.status(429).json({ success: false, message: `You buzzed ${to.name.split(' ')[0]} recently — give it a little while` });
    if (today >= 20) return res.status(429).json({ success: false, message: 'Daily buzz limit reached — try again tomorrow' });

    const note = typeof message === 'string' ? message.trim().slice(0, 200) : '';
    const buzz = await Buzz.create({ estateId: req.estateId, fromId: req.user._id, toId: to._id, kind, message: note });

    const from = await User.findById(req.user._id).select('name profilePhoto unitId').populate('unitId', 'unitNumber block').lean();
    const fromProfile = publicProfile({ ...from, role: 'resident' });
    emitNotification(null, {
      id: `buzz-${buzz._id}`, type: 'neighbour_buzz',
      title: BUZZ_TITLE[kind](from.name.split(' ')[0]),
      body: note || `${from.name}${fromProfile.unit ? ` · ${fromProfile.unit}` : ''}`,
      meta: { buzzId: String(buzz._id), kind, message: note, from: fromProfile },
    }, to._id);

    // Email in the background — never hold the response for it.
    Estate.findById(req.estateId).select('name').lean().then((estate) => sendBuzzEmail({
      to: to.email, toName: to.name, fromName: from.name, fromPhotoUrl: avatarUrl(from),
      fromUnit: fromProfile.unit, estateName: estate?.name || 'your estate', kind, message: note,
      appUrl: `${RESIDENTS_URL()}/neighbours?buzzback=${from._id}`,
    })).catch((e) => console.error('[buzz email]', e.message));

    res.status(201).json({ success: true, message: `Buzzed ${to.name.split(' ')[0]}!`, data: { _id: buzz._id } });
  } catch (e) {
    console.error('[buzz]', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getBuzzes = async (req, res) => {
  const list = await Buzz.find({ toId: req.user._id }).sort({ createdAt: -1 }).limit(20)
    .populate('fromId', 'name profilePhoto').lean();
  res.json({ success: true, data: list });
};
