const mongoose = require('mongoose');

const estateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  address: { type: String, required: true },
  logoUrl: { type: String, default: '' },
  estateCode: {
    type: String,
    unique: true,
    uppercase: true,
    trim: true,
  },
  managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  settings: {
    requireVisitorApproval: { type: Boolean, default: false },
    marketplaceApproval: { type: Boolean, default: false },
    allowGuestChat: { type: Boolean, default: true },
  },
  constitution: {
    fileUrl: { type: String, default: '' },
    fileName: { type: String, default: '' },
    sizeBytes: { type: Number, default: 0 },
    uploadedAt: Date,
    uploadedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    extractedText: { type: String, default: '' }, // used to ground AI judge/lawyers
    pageCount: { type: Number, default: 0 },
  },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

// Generate a unique 6-char estate invite code before saving
estateSchema.pre('save', function (next) {
  if (!this.estateCode) {
    this.estateCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  }
  next();
});

module.exports = mongoose.model('Estate', estateSchema);
