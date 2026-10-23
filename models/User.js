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
  // Estate manager teams: 'owner' = full access (every manager before teams);
  // 'member' = invited teammate limited to `permissions` (utils/teamAccess AREAS).
  teamRole:    { type: String, enum: ['owner', 'member'], default: 'owner' },
  permissions: { type: [String], default: [] },
  invitedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  unitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit' },
  profilePhoto: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  isDiscoverable: { type: Boolean, default: true },
  refreshToken: { type: String, default: null },
  lastSeen: { type: Date, default: Date.now },
  walletBalance: { type: Number, default: 0 },
  // Prepaid credits for resident-to-resident calls (bought from AreaConnect).
  // Only ever changed through utils/credits.js so every change is ledgered.
  callCredits: { type: Number, default: 0, min: 0 },
  paystackRecipientCode: { type: String, default: null },
  bankCode: { type: String, default: '' },
  bankName: { type: String, default: '' },
  accountNumber: { type: String, default: '' },
  accountName: { type: String, default: '' },

  // Flipped true when an admin issues a temp password (invite or an approved
  // reset). Login still works, but the client should force a change-password
  // step before anything else.
  mustChangePassword: { type: Boolean, default: false },
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
