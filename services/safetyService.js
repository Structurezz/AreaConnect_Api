const SafetyBlock = require('../models/SafetyBlock');
const SafetyIncident = require('../models/SafetyIncident');
const Alert = require('../models/Alert');
const User = require('../models/User');
require('../models/Unit');
const { emitAlert, getIO } = require('./socketService');

// Anti-stalking: safety blocks between residents, contact-attempt logging,
// escalation to estate staff (security + estate manager), "I'm being
// followed" alarms, gate watch and live location sharing.
//
// Alarms go to staff only (audience 'staff'), never estate-wide, and the
// blocked person is never told they've been blocked.

const ATTEMPT_WINDOW_MS = 24 * 3600_000;
const ATTEMPTS_TO_ALERT = 3;
const LOCATION_MAX_MS = 60 * 60_000;

const unitLabel = (u) => (u ? `${u.block ? `Block ${u.block} · ` : ''}Unit ${u.unitNumber}` : 'no unit on file');
const who = (u) => `${u?.name || 'Unknown'} (${unitLabel(u?.unitId)}${u?.phone ? `, ${u.phone}` : ''})`;
const loadPerson = (id) => User.findById(id).select('name phone profilePhoto unitId estateId').populate('unitId', 'unitNumber block').lean();

/** Block between two users, either direction (or null). */
function findBlockBetween(a, b) {
  return SafetyBlock.findOne({
    $or: [{ protectedId: a, blockedId: b }, { protectedId: b, blockedId: a }],
  }).lean();
}

/** Ids this user must not see / contact (both directions). */
async function hiddenIdsFor(userId) {
  const blocks = await SafetyBlock.find({ $or: [{ protectedId: userId }, { blockedId: userId }] })
    .select('protectedId blockedId').lean();
  return blocks.map((b) => (String(b.protectedId) === String(userId) ? b.blockedId : b.protectedId));
}

/** Create a staff-only alert about a safety situation; siren + email. */
async function raiseSafetyAlert({ estateId, protectedUser, blockedUser, kind, note = '', location = '' }) {
  const { emailAlert, ALERT_POPULATE } = require('../controllers/alertController');
  const copy = {
    followed: {
      title: '🚨 Resident being followed',
      severity: 'critical',
      text: `${who(protectedUser)} reports being followed${blockedUser ? ` by ${who(blockedUser)}` : ''}. Respond now.`,
      action: 'Go to the resident immediately and keep them on the phone.',
    },
    repeated_contact: {
      title: '⚠️ Possible stalking — repeated contact attempts',
      severity: 'high',
      text: `${who(blockedUser)} has repeatedly tried to call/buzz ${who(protectedUser)}, who has blocked them for their safety.`,
      action: 'Check on the resident and speak to the person contacting them.',
    },
    gate_guest: {
      title: '👁️ Safety watch at the gate',
      severity: 'medium',
      text: `A guest of ${who(blockedUser)} has just checked in. ${who(protectedUser)} has a safety block against them.`,
      action: `Keep watch near ${unitLabel(protectedUser?.unitId)}.`,
    },
  }[kind];

  const alert = await Alert.create({
    estateId,
    residentId: protectedUser._id,
    unitId: protectedUser.unitId?._id || protectedUser.unitId,
    type: 'security',
    title: copy.title,
    note: [copy.text, note].filter(Boolean).join('\n'),
    severity: copy.severity,
    location,
    actionRequired: copy.action,
    contactNumber: protectedUser.phone || '',
    status: 'open',
    raisedByRole: 'resident',
    audience: 'staff', // security + estate manager only — never estate-wide
  });
  await alert.populate(ALERT_POPULATE);
  emitAlert(String(estateId), alert.toObject());
  emailAlert(alert, { isBroadcast: false });
  return alert;
}

/**
 * A blocked person tried to call/buzz the person who blocked them. Log it;
 * on the 3rd attempt in 24h alert staff (at most once per 24h per pair).
 */
async function recordContactAttempt({ estateId, protectedId, blockedId, type }) {
  try {
    await SafetyIncident.create({ estateId, protectedId, blockedId, type });
    const since = new Date(Date.now() - ATTEMPT_WINDOW_MS);
    const [attempts, alreadyAlerted] = await Promise.all([
      SafetyIncident.countDocuments({ protectedId, blockedId, type: { $in: ['call_attempt', 'buzz_attempt'] }, createdAt: { $gte: since } }),
      SafetyIncident.exists({ protectedId, blockedId, 'details.escalated': true, createdAt: { $gte: since } }),
    ]);
    if (attempts < ATTEMPTS_TO_ALERT || alreadyAlerted) return;
    const [p, b] = await Promise.all([loadPerson(protectedId), loadPerson(blockedId)]);
    const alert = await raiseSafetyAlert({ estateId, protectedUser: p, blockedUser: b, kind: 'repeated_contact', note: `${attempts} attempts in the last 24 hours.` });
    await SafetyIncident.findOneAndUpdate(
      { protectedId, blockedId, type, createdAt: { $gte: since } },
      { $set: { 'details.escalated': true, alertId: alert._id } },
      { sort: { createdAt: -1 } }
    );
  } catch (e) {
    console.error('[safety attempt]', e.message);
  }
}

/** Gate watch: a guest of a blocked person just checked in. */
async function onVisitorCheckIn(visitor) {
  try {
    const blocks = await SafetyBlock.find({ blockedId: visitor.hostResidentId, gateWatch: true, estateId: visitor.estateId }).lean();
    if (!blocks.length) return;
    const blockedUser = await loadPerson(visitor.hostResidentId);
    for (const blk of blocks) {
      const protectedUser = await loadPerson(blk.protectedId);
      if (!protectedUser) continue;
      const alert = await raiseSafetyAlert({
        estateId: visitor.estateId, protectedUser, blockedUser, kind: 'gate_guest',
        note: `Guest: ${visitor.visitorName}${visitor.visitorPhone ? ` (${visitor.visitorPhone})` : ''} — purpose: ${visitor.purpose || 'n/a'}.`,
      });
      await SafetyIncident.create({ estateId: visitor.estateId, protectedId: blk.protectedId, blockedId: blk.blockedId, type: 'gate_guest', alertId: alert._id, details: { visitorId: visitor._id } });
    }
  } catch (e) {
    console.error('[safety gate watch]', e.message);
  }
}

// ── Live location sharing (in memory; staff see it in real time) ────────────
const shares = new Map(); // protectedId → { estateId, startedAt, last }

const staffRoom = (estateId) => `estate:${estateId}:staff`;

function startShare(user) {
  const id = String(user._id);
  const share = { userId: id, estateId: String(user.estateId), startedAt: Date.now(), last: null,
    person: { _id: id, name: user.name, phone: user.phone || '', profilePhoto: user.profilePhoto || '', unit: unitLabel(user.unitId) } };
  shares.set(id, share);
  getIO()?.to(staffRoom(share.estateId)).emit('safety:location_start', { ...share });
  return share;
}

function updateShare(userId, { lat, lng, accuracy }) {
  const share = shares.get(String(userId));
  if (!share) return false;
  if (Date.now() - share.startedAt > LOCATION_MAX_MS) { stopShare(userId, 'expired'); return false; }
  if (![lat, lng].every((v) => typeof v === 'number' && Number.isFinite(v))) return false;
  share.last = { lat, lng, accuracy: Number(accuracy) || null, at: Date.now() };
  getIO()?.to(staffRoom(share.estateId)).emit('safety:location', { userId: share.userId, ...share.last });
  return true;
}

function stopShare(userId, reason = 'stopped') {
  const share = shares.get(String(userId));
  if (!share) return;
  shares.delete(String(userId));
  getIO()?.to(staffRoom(share.estateId)).emit('safety:location_end', { userId: share.userId, reason });
}

const activeShares = (estateId) => [...shares.values()].filter((s) => s.estateId === String(estateId));

module.exports = {
  findBlockBetween, hiddenIdsFor, recordContactAttempt, raiseSafetyAlert, onVisitorCheckIn,
  startShare, updateShare, stopShare, activeShares, loadPerson, unitLabel,
};
