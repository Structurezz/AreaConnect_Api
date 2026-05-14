const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  scheduleId:  { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentSchedule', required: true },
  residentId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  estateId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  amount:      { type: Number, required: true },
  status: {
    type: String,
    enum: ['pending', 'paid', 'overdue', 'waived'],
    default: 'pending',
  },
  method: {
    type: String,
    enum: ['paystack', 'cash', 'bank_transfer', 'manual'],
    default: null,
  },
  paystackReference: { type: String, default: null },
  paidAt:       { type: Date, default: null },
  notes:        { type: String, default: '' },
  recordedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

paymentSchema.index({ estateId: 1, residentId: 1, status: 1 });
paymentSchema.index({ scheduleId: 1, status: 1 });
paymentSchema.index({ paystackReference: 1 }, { sparse: true });

module.exports = mongoose.model('Payment', paymentSchema);
