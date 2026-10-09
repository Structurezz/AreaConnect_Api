const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  estateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true, unique: true },
  planId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },

  billingModel: { type: String, enum: ['flat', 'per_resident'], default: 'flat' },
  residentCount: { type: Number, default: 0 }, // used for per_resident billing

  cycle:  { type: String, enum: ['monthly', 'annual'], default: 'monthly' },
  status: { type: String, enum: ['active', 'trial', 'expired', 'suspended', 'cancelled'], default: 'trial' },

  startDate:       { type: Date, default: Date.now },
  endDate:         { type: Date },
  nextBillingDate: { type: Date },
  trialEndsAt:     { type: Date },

  notes:     { type: String, default: '' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // Pending upgrade (awaiting Paystack confirmation)
  pendingRef:    { type: String },
  pendingPlanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },
  pendingCycle:  { type: String },

  // Tracks which day-thresholds have already had a reminder email sent (e.g. [7, 3, 1])
  remindersSent: { type: [Number], default: [] },

  // ── Comp / promo override ────────────────────────────────────────────────
  // When comp.isActive is true (and comp.expiresAt is null or in the future),
  // the estate gets the features of `comp.planId` for free, regardless of
  // their actual billed `planId`. Lets super-admins run promos, VIP comps,
  // etc. without touching billing. Revoking the comp falls back to `planId`.
  comp: {
    isActive:   { type: Boolean, default: false },
    planId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },
    reason:     { type: String, default: '' },
    expiresAt:  { type: Date,   default: null },
    grantedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    grantedAt:  { type: Date,   default: null },
  },
}, { timestamps: true });

subscriptionSchema.index({ status: 1 });
subscriptionSchema.index({ 'comp.isActive': 1, 'comp.expiresAt': 1 });

// Returns true when a comp is granted and either has no expiry or is still unexpired.
subscriptionSchema.methods.isCompActive = function () {
  if (!this.comp || !this.comp.isActive || !this.comp.planId) return false;
  if (!this.comp.expiresAt) return true;
  return new Date(this.comp.expiresAt) > new Date();
};

module.exports = mongoose.model('Subscription', subscriptionSchema);
