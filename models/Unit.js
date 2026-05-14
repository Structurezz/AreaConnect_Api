const mongoose = require('mongoose');

const unitSchema = new mongoose.Schema({
  estateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  unitNumber: { type: String, required: true, trim: true },
  block: { type: String, default: '' },
  type: {
    type: String,
    enum: ['apartment', 'house', 'shop', 'office'],
    default: 'apartment',
  },
  residentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  maxOccupants: { type: Number, default: 7, min: 1, max: 7 },
  status: {
    type: String,
    enum: ['occupied', 'vacant'],
    default: 'vacant',
  },
  duesStatus: {
    type: String,
    enum: ['paid', 'owing', 'exempt'],
    default: 'paid',
  },
  amountOwed: { type: Number, default: 0 },
}, { timestamps: true });

unitSchema.index({ estateId: 1, unitNumber: 1 }, { unique: true });

module.exports = mongoose.model('Unit', unitSchema);
