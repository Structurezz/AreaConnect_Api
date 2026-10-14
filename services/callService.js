const Call = require('../models/Call');
const { RATE_PER_MINUTE, chargeCredits, getBalance } = require('../utils/credits');

// Call lifecycle + billing. REST (callController) starts/answers/ends calls;
// sockets carry the WebRTC signalling (socketService → relaySignal) between
// the two specific devices bound to a call.
//
// Billing: standard (resident↔resident) calls cost RATE_PER_MINUTE credits per
// started minute of *connected* time, charged to the caller when the call
// ends. At answer we work out how long the caller can afford and hang up
// automatically when that runs out. Emergency / staff calls are free.

const RING_TIMEOUT_MS   = 40_000;
const LOW_CREDIT_WARN_S = 60;
const DISCONNECT_GRACE_MS = 20_000;
const MAX_FREE_CALL_S   = 2 * 60 * 60;   // safety cap for free calls

const timers  = new Map();   // callId → { ring, limit, warn, grace }
const devices = new Map();   // callId → { caller: socketId, callee: socketId }

const io = () => require('./socketService').getIO();
const toUser = (userId, event, payload) => io()?.to(`user:${userId}`).emit(event, payload);
const toSocket = (socketId, event, payload) => socketId && io()?.to(socketId).emit(event, payload);

function clearTimers(callId) {
  const t = timers.get(String(callId));
  if (t) Object.values(t).forEach((h) => clearTimeout(h));
  timers.delete(String(callId));
}
function setTimer(callId, key, ms, fn) {
  const id = String(callId);
  const t = timers.get(id) || {};
  clearTimeout(t[key]);
  t[key] = setTimeout(fn, ms);
  timers.set(id, t);
}

/** Ring the callee; auto-mark missed if nobody answers. */
function startRinging(call, payload) {
  toUser(call.calleeId, 'call:incoming', payload);
  setTimer(call._id, 'ring', RING_TIMEOUT_MS, () =>
    finalize(call._id, { ringingStatus: 'missed', reason: 'no_answer' }).catch(() => {}));
}

/**
 * Callee picked up. Returns the updated call or null if it was no longer
 * ringing (cancelled, answered on another device, timed out).
 */
async function answer(callId, calleeId) {
  const ringing = await Call.findOne({ _id: callId, calleeId, status: 'ringing' }).lean();
  if (!ringing) return null;

  let maxSeconds = MAX_FREE_CALL_S;
  if (ringing.kind === 'standard') {
    const balance = await getBalance(ringing.callerId);
    maxSeconds = Math.floor(balance / ringing.ratePerMinute) * 60;
    if (maxSeconds < 60) {
      await finalize(callId, { ringingStatus: 'failed', reason: 'caller_out_of_credits' });
      return null;
    }
  }

  const call = await Call.findOneAndUpdate(
    { _id: callId, status: 'ringing' },
    { status: 'active', answeredAt: new Date(), maxSeconds },
    { new: true }
  ).lean();
  if (!call) return null;

  clearTimers(callId);
  setTimer(callId, 'limit', maxSeconds * 1000, () =>
    finalize(callId, { reason: ringing.kind === 'standard' ? 'credits_exhausted' : 'max_duration' }).catch(() => {}));
  if (ringing.kind === 'standard' && maxSeconds > LOW_CREDIT_WARN_S) {
    setTimer(callId, 'warn', (maxSeconds - LOW_CREDIT_WARN_S) * 1000, () =>
      toUser(call.callerId, 'call:low_credit', { callId: String(callId), secondsLeft: LOW_CREDIT_WARN_S }));
  }

  // Other devices of the callee stop ringing; the caller starts WebRTC.
  toUser(call.calleeId, 'call:answered_elsewhere', { callId: String(callId) });
  toUser(call.callerId, 'call:accepted', { callId: String(callId), maxSeconds });
  return call;
}

/**
 * End a call exactly once (atomic status claim), bill it, notify both sides.
 * ringingStatus: what an unanswered call becomes (missed/declined/cancelled/failed).
 */
async function finalize(callId, { ringingStatus = 'cancelled', reason = 'hangup', endedBy } = {}) {
  const now = new Date();
  const before = await Call.findOneAndUpdate(
    { _id: callId, status: { $in: ['ringing', 'active'] } },
    { $set: { endedAt: now, endReason: reason, endedBy, status: 'ended' } },
    { new: false }
  ).lean();
  if (!before) return null; // already finished elsewhere
  clearTimers(callId);

  let status = 'ended';
  let durationSec = 0;
  let creditsCharged = 0;
  if (before.status === 'ringing') {
    status = ringingStatus;
  } else if (before.answeredAt) {
    durationSec = Math.max(0, Math.round((now - new Date(before.answeredAt)) / 1000));
    if (before.maxSeconds) durationSec = Math.min(durationSec, before.maxSeconds);
    if (before.kind === 'standard' && durationSec > 0) {
      const minutes = Math.ceil(durationSec / 60);
      const res = await chargeCredits(before.callerId, minutes * before.ratePerMinute, {
        description: `Call · ${minutes} min`, callId: before._id, estateId: before.estateId,
      });
      creditsCharged = res.charged;
    }
  }

  await Call.updateOne({ _id: callId }, { $set: { status, durationSec, creditsCharged } });
  devices.delete(String(callId));

  const payload = { callId: String(callId), status, reason, durationSec, creditsCharged };
  toUser(before.callerId, 'call:ended', payload);
  toUser(before.calleeId, 'call:ended', payload);
  return { ...before, status, durationSec, creditsCharged };
}

// ── Device binding + signalling ─────────────────────────────────────────────

/** A device says "I'm the caller/callee for this call" so signals reach it. */
async function bindDevice(socket, callId) {
  const userId = socket.data?.userId;
  if (!userId || !callId) return;
  const call = await Call.findById(callId).select('callerId calleeId status').lean();
  if (!call || !['ringing', 'active'].includes(call.status)) return;
  const side = String(call.callerId) === userId ? 'caller' : String(call.calleeId) === userId ? 'callee' : null;
  if (!side) return;
  const d = devices.get(String(callId)) || {};
  d[side] = socket.id;
  devices.set(String(callId), d);
  socket.data.calls = new Set([...(socket.data.calls || []), String(callId)]);
  const t = timers.get(String(callId));
  if (t?.grace) { clearTimeout(t.grace); delete t.grace; } // reconnected in time
}

/** Forward an offer/answer/ICE candidate to the *other* party's bound device. */
async function relaySignal(socket, { callId, data } = {}) {
  const userId = socket.data?.userId;
  const d = devices.get(String(callId));
  if (!userId || !d || !data) return;
  if (d.caller === socket.id) return toSocket(d.callee, 'call:signal', { callId, data });
  if (d.callee === socket.id) return toSocket(d.caller, 'call:signal', { callId, data });
}

/** A bound device dropped: give it a short grace period to reconnect. */
function handleDisconnect(socket) {
  for (const callId of socket.data?.calls || []) {
    const d = devices.get(callId);
    if (!d || (d.caller !== socket.id && d.callee !== socket.id)) continue;
    setTimer(callId, 'grace', DISCONNECT_GRACE_MS, () =>
      finalize(callId, { reason: 'disconnected', ringingStatus: 'cancelled' }).catch(() => {}));
  }
}

// ── Safety sweep (server restarts lose in-memory timers) ────────────────────
let sweeper = null;
function startSweeper() {
  if (sweeper || process.env.NODE_ENV === 'test') return;
  sweeper = setInterval(async () => {
    try {
      const now = Date.now();
      const stale = await Call.find({
        $or: [
          { status: 'ringing', createdAt: { $lt: new Date(now - RING_TIMEOUT_MS - 15_000) } },
          { status: 'active', answeredAt: { $lt: new Date(now - MAX_FREE_CALL_S * 1000) } },
          { status: 'active', kind: 'standard', answeredAt: { $exists: true } },
        ],
      }).select('status kind answeredAt maxSeconds').lean();
      for (const c of stale) {
        if (c.status === 'ringing') { await finalize(c._id, { ringingStatus: 'missed', reason: 'no_answer' }); continue; }
        const limitMs = (c.maxSeconds || MAX_FREE_CALL_S) * 1000 + 30_000;
        if (now - new Date(c.answeredAt).getTime() > limitMs) await finalize(c._id, { reason: 'credits_exhausted' });
      }
    } catch (e) { console.error('[call sweeper]', e.message); }
  }, 30_000);
  sweeper.unref?.();
}

module.exports = {
  RATE_PER_MINUTE, RING_TIMEOUT_MS,
  startRinging, answer, finalize, bindDevice, relaySignal, handleDisconnect, startSweeper,
};
