const mongoose = require('mongoose');

// Ledger of every change to a user's call credits. The balance on the User
// is the source of truth for spending; this is the audit trail behind it.
const creditTransactionSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  estateId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Estate' },
  type:         { type: String, enum: ['topup', 'call', 'refund', 'grant'], required: true },
  amount:       { type: Number, required: true },          // + added, − spent
  balanceAfter: { type: Number, required: true },
  description:  { type: String, default: '' },
  callId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Call', default: null },
  // Top-ups: Paystack reference + what was paid. Unique so a payment can
  // never be credited twice (webhook + redirect verify racing).
  reference:    { type: String, default: undefined },
  amountPaid:   { type: Number, default: 0 },               // naira
}, { timestamps: true });

creditTransactionSchema.index({ userId: 1, createdAt: -1 });
creditTransactionSchema.index({ reference: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('CreditTransaction', creditTransactionSchema);
