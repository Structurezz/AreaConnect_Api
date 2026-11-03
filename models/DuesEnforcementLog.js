const mongoose = require('mongoose');

// Audit trail for dues enforcement — every notice, restriction, lift and
// dispute, with who did it and what was owed at the time.
const duesEnforcementLogSchema = new mongoose.Schema({
  estateId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  residentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: {
    type: String,
    enum: ['notice', 'applied', 'lifted', 'auto_lifted', 'cancelled', 'dispute'],
    required: true,
  },
  byId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null = system
  services:   { type: [String], default: [] },
  amountOwed: { type: Number, default: 0 },
  note:       { type: String, default: '' },
}, { timestamps: true });

duesEnforcementLogSchema.index({ estateId: 1, residentId: 1, createdAt: -1 });

module.exports = mongoose.model('DuesEnforcementLog', duesEnforcementLogSchema);
