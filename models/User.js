const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, default: '' },
  passwordHash: { type: String, required: true },
  role: {
    type: String,
    enum: ['super_admin', 'estate_manager', 'resident', 'security'],
    default: 'resident',
  },
  estateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Estate' },
  managedEstates: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Estate' }],
  unitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit' },
  profilePhoto: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  refreshToken: { type: String, default: null },
  lastSeen: { type: Date, default: Date.now },
  walletBalance: { type: Number, default: 0 },
  paystackRecipientCode: { type: String, default: null },
  bankCode: { type: String, default: '' },
  bankName: { type: String, default: '' },
  accountNumber: { type: String, default: '' },
  accountName: { type: String, default: '' },
}, { timestamps: true });

userSchema.methods.comparePassword = async function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.refreshToken;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
