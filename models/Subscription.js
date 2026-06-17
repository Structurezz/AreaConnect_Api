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
}, { timestamps: true });

subscriptionSchema.index({ status: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
