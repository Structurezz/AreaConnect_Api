const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
  userId:               { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  estateId:             { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  amount:               { type: Number, required: true },
  status:               { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
  paystackTransferCode: { type: String, default: null },
  // Raw Paystack transfer status ('otp', 'pending', 'success', ...). 'otp'
  // means the transfer is parked until the business-phone OTP is entered.
  paystackStatus:       { type: String, default: '' },
  reference:            { type: String, required: true },
  bankName:             { type: String, default: '' },
  accountNumber:        { type: String, default: '' },
  accountName:          { type: String, default: '' },
  failureReason:        { type: String, default: '' },
  // 'estate' = estate manager's dues wallet · 'marketplace' = a seller's
  // marketplace earnings. Each wallet only counts its own withdrawals.
  source:               { type: String, enum: ['estate', 'marketplace'], default: 'estate' },
}, { timestamps: true });

withdrawalSchema.index({ userId: 1, createdAt: -1 });
withdrawalSchema.index({ userId: 1, source: 1, status: 1 });

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
