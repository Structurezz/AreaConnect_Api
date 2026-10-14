const mongoose = require('mongoose');

// A "buzz": a resident checking in on a neighbour. Kept so we can rate-limit
// and show "Ada buzzed you" history.
const buzzSchema = new mongoose.Schema({
  estateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  fromId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  toId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  kind:     { type: String, enum: ['checkin', 'greeting', 'thinking_of_you'], default: 'checkin' },
  message:  { type: String, default: '', maxlength: 200 },
  seenAt:   { type: Date },
}, { timestamps: true });

buzzSchema.index({ fromId: 1, toId: 1, createdAt: -1 });
buzzSchema.index({ toId: 1, createdAt: -1 });

module.exports = mongoose.model('Buzz', buzzSchema);
