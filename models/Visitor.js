const mongoose = require('mongoose');

const visitorSchema = new mongoose.Schema({
  estateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  hostResidentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  hostUnitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit' },
  visitorName: { type: String, required: true, trim: true },
  visitorPhone: { type: String, default: '' },
  visitorEmail: { type: String, default: '' },
  purpose: { type: String, required: true },
  expectedDate: { type: Date, required: true },
  expectedDuration: { type: Number, default: 60 }, // in minutes
  visitorCode: { type: String, uppercase: true },
  qrCodeUrl: { type: String, default: '' },
  status: {
    type: String,
    enum: ['pending', 'active', 'checked-in', 'checked-out', 'expired', 'blacklisted'],
    default: 'active',
  },
  entryTime: { type: Date },
  exitTime: { type: Date },
  verifiedBySecurityId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  notes: { type: String, default: '' },
  isRecurring: { type: Boolean, default: false },
}, { timestamps: true });

visitorSchema.index({ estateId: 1, status: 1 });
visitorSchema.index({ visitorCode: 1 });

module.exports = mongoose.model('Visitor', visitorSchema);
