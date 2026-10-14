const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
  estateId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  callerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  calleeId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // emergency = resident → security / estate manager: always free.
  kind:       { type: String, enum: ['standard', 'emergency', 'staff'], default: 'standard' },  // staff = security/manager calling anyone (free)
  status:     { type: String, enum: ['ringing', 'active', 'ended', 'missed', 'declined', 'cancelled', 'failed'], default: 'ringing' },
  ratePerMinute: { type: Number, default: 0 },   // credits per started minute (0 for emergency)
  maxSeconds:    { type: Number, default: 0 },   // talk time the caller could afford at answer
  answeredAt: { type: Date },
  endedAt:    { type: Date },
  endedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  endReason:  { type: String, default: '' },     // hangup | credits_exhausted | no_answer | declined | disconnected
  durationSec:    { type: Number, default: 0 },
  creditsCharged: { type: Number, default: 0 },
}, { timestamps: true });

callSchema.index({ callerId: 1, createdAt: -1 });
callSchema.index({ calleeId: 1, createdAt: -1 });
callSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('Call', callSchema);
