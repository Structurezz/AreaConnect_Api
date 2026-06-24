const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  estateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  residentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  unitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit' },
  type: {
    type: String,
    enum: ['security', 'fire', 'medical', 'noise', 'other'],
    default: 'security',
  },
  title: { type: String, default: '' },
  note: { type: String, default: '' },
  severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  location: { type: String, default: '' },
  actionRequired: { type: String, default: '' },
  contactNumber: { type: String, default: '' },
  status: {
    type: String,
    enum: ['open', 'acknowledged', 'resolved'],
    default: 'open',
  },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedAt: { type: Date },
  acknowledgedAt: { type: Date },
  isEmergencyBroadcast: { type: Boolean, default: false },
  raisedByRole: { type: String, enum: ['resident', 'security', 'estate_manager', 'super_admin'], default: 'resident' },
}, { timestamps: true });

alertSchema.index({ estateId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Alert', alertSchema);
