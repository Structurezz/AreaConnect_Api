// Short-lived in-process caches for the per-request auth path:
//   user(id)       — the signed-in user (no photo / bank / secrets), 15s
//   subStatus(id)  — an estate's subscription status, 60s
// Writes to User / Subscription bust the entry through schema hooks
// (models/User.js, models/Subscription.js), so changes such as suspending a
// user apply at once on this instance; other instances catch up within the TTL.
const USER_TTL = 15 * 1000;
const SUB_TTL = 60 * 1000;
const users = new Map();
const subs = new Map();

const AUTH_SELECT = '-passwordHash -refreshToken -profilePhoto -accountNumber -bankCode -bankName -accountName -paystackRecipientCode';

async function user(id) {
  const key = String(id);
  const hit = users.get(key);
  if (hit && Date.now() - hit.at < USER_TTL) return hit.value ? { ...hit.value } : null;
  const User = require('../models/User');
  const value = await User.findById(key).select(AUTH_SELECT).lean();
  users.set(key, { at: Date.now(), value });
  if (users.size > 20000) users.clear(); // simple bound
  return value ? { ...value } : null;
}

async function subStatus(estateId) {
  const key = String(estateId);
  const hit = subs.get(key);
  if (hit && Date.now() - hit.at < SUB_TTL) return hit.value;
  const Subscription = require('../models/Subscription');
  const sub = await Subscription.findOne({ estateId: key }).select('status').lean();
  const value = sub?.status || null;
  subs.set(key, { at: Date.now(), value });
  return value;
}

const bustUser = (id) => { if (id) users.delete(String(id)); };
const bustAllUsers = () => users.clear();
const bustSub = (estateId) => { if (estateId) subs.delete(String(estateId)); else subs.clear(); };

module.exports = { user, subStatus, bustUser, bustAllUsers, bustSub, AUTH_SELECT };
