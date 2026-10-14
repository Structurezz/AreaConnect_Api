const User = require('../models/User');
const CreditTransaction = require('../models/CreditTransaction');

// ── Pricing ─────────────────────────────────────────────────────────────────
// Credits are bought from AreaConnect (platform revenue) and spent on
// resident-to-resident calls, per started minute of connected talk time.
// Emergency calls to security / estate management are always free.
const RATE_PER_MINUTE = Number(process.env.CALL_CREDITS_PER_MINUTE) || 1;

const CREDIT_PACKS = [
  { id: 'starter', credits: 50,  price: 500,  label: '50 credits'  },
  { id: 'popular', credits: 120, price: 1000, label: '120 credits', badge: '20% bonus' },
  { id: 'value',   credits: 300, price: 2000, label: '300 credits', badge: '50% bonus' },
];
const packById = (id) => CREDIT_PACKS.find((p) => p.id === id);

// ── Balance changes (always through here, always ledgered) ─────────────────

/**
 * Add credits. With a `reference` (e.g. Paystack ref) this is idempotent:
 * the ledger row is inserted first under a unique index, so a second attempt
 * for the same payment is a no-op instead of a double credit.
 * Returns { added: boolean, balance }.
 */
async function addCredits(userId, amount, { type = 'topup', description = '', reference, amountPaid = 0, estateId } = {}) {
  if (!(amount > 0)) throw new Error('addCredits: amount must be positive');
  let row;
  try {
    row = await CreditTransaction.create({
      userId, estateId, type, amount, balanceAfter: 0, description, reference, amountPaid,
    });
  } catch (e) {
    if (e.code === 11000) {
      const user = await User.findById(userId).select('callCredits').lean();
      return { added: false, balance: user?.callCredits ?? 0 };
    }
    throw e;
  }
  const user = await User.findByIdAndUpdate(userId, { $inc: { callCredits: amount } }, { new: true }).select('callCredits');
  row.balanceAfter = user.callCredits;
  await row.save();
  return { added: true, balance: user.callCredits };
}

/**
 * Spend up to `amount` credits. Never takes the balance below zero; if the
 * user has less than `amount`, whatever they have is charged.
 * Returns { charged, balance }.
 */
async function chargeCredits(userId, amount, { description = '', callId, estateId } = {}) {
  if (!(amount > 0)) {
    const u = await User.findById(userId).select('callCredits').lean();
    return { charged: 0, balance: u?.callCredits ?? 0 };
  }
  // Atomic clamp-at-zero decrement; read the value from before the update so
  // we know exactly how much was taken.
  const before = await User.findOneAndUpdate(
    { _id: userId },
    [{ $set: { callCredits: { $max: [0, { $subtract: [{ $ifNull: ['$callCredits', 0] }, amount] }] } } }],
    { new: false }
  ).select('callCredits').lean();
  const had = before?.callCredits ?? 0;
  const charged = Math.min(had, amount);
  const balance = had - charged;
  if (charged > 0) {
    await CreditTransaction.create({
      userId, estateId, type: 'call', amount: -charged, balanceAfter: balance, description, callId,
    });
  }
  return { charged, balance };
}

async function getBalance(userId) {
  const u = await User.findById(userId).select('callCredits').lean();
  return u?.callCredits ?? 0;
}

module.exports = { RATE_PER_MINUTE, CREDIT_PACKS, packById, addCredits, chargeCredits, getBalance };
