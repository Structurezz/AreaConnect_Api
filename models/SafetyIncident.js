const mongoose = require('mongoose');

// Audit trail of safety events for a protected resident.
const safetyIncidentSchema = new mongoose.Schema({
  estateId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  protectedId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  blockedId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type: {
    type: String,
    enum: ['call_attempt', 'buzz_attempt', 'followed', 'gate_guest', 'location_share'],
    required: true,
  },
  alertId: { type: mongoose.Schema.Types.ObjectId, ref: 'Alert', default: null },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

safetyIncidentSchema.index({ protectedId: 1, blockedId: 1, createdAt: -1 });
safetyIncidentSchema.index({ estateId: 1, createdAt: -1 });

module.exports = mongoose.model('SafetyIncident', safetyIncidentSchema);
