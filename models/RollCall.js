const mongoose = require('mongoose');

// Emergency roll-call (evacuation / muster): everyone expected on site taps
// "I'm safe" or "I need help"; the manager sees who hasn't answered.
const rollCallSchema = new mongoose.Schema({
  estateId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true, index: true },
  startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason:    { type: String, default: '', trim: true, maxlength: 300 },
  expected:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  responses: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['safe', 'help'], default: 'safe' },
    note:   { type: String, default: '' },
    at:     { type: Date, default: Date.now },
  }],
  endedAt:   { type: Date, default: null },
  endedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

rollCallSchema.index({ estateId: 1, endedAt: 1, createdAt: -1 });

module.exports = mongoose.model('RollCall', rollCallSchema);
