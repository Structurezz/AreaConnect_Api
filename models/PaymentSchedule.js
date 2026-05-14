const mongoose = require('mongoose');

const paymentScheduleSchema = new mongoose.Schema({
  estateId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:       { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  type: {
    type: String,
    enum: ['security_dues', 'maintenance', 'levy', 'contribution', 'other'],
    default: 'security_dues',
  },
  amount:    { type: Number, required: true, min: 1 },
  frequency: {
    type: String,
    enum: ['one_time', 'monthly', 'quarterly', 'annual'],
    default: 'monthly',
  },
  dueDate:  { type: Date, required: true },
  isActive: { type: Boolean, default: true },
  targetAll: { type: Boolean, default: true },
}, { timestamps: true });

paymentScheduleSchema.index({ estateId: 1, isActive: 1, createdAt: -1 });

module.exports = mongoose.model('PaymentSchedule', paymentScheduleSchema);
