const mongoose = require('mongoose');

// A resident ("protected") has blocked another resident for their safety.
// The blocked person is never told. Both disappear from each other's
// directory, calls/buzzes between them are refused, and contact attempts by
// the blocked person are logged and escalated to estate staff.
const safetyBlockSchema = new mongoose.Schema({
  estateId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  protectedId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  blockedId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason:      { type: String, default: '', maxlength: 300 },   // private, staff-visible in alerts
  gateWatch:   { type: Boolean, default: true },                 // alert security when their guests arrive
}, { timestamps: true });

safetyBlockSchema.index({ protectedId: 1, blockedId: 1 }, { unique: true });
safetyBlockSchema.index({ blockedId: 1 });

module.exports = mongoose.model('SafetyBlock', safetyBlockSchema);
