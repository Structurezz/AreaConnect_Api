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
  location: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    formattedAddress: { type: String, default: '' },
    placeId: { type: String, default: '' },
    geocodedAt: Date,
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
  // Profile captured during admin onboarding
  city:         { type: String, default: '', trim: true },
  state:        { type: String, default: '', trim: true },
  estateType:   { type: String, default: '' }, // gated, residential, mixed, commercial, cooperative
  unitCount:    { type: Number, default: 0 },
  contactPhone: { type: String, default: '' },
  contactEmail: { type: String, default: '' },
  adminNotes:   { type: String, default: '' },
  onboarding: {
    source:  { type: String, enum: ['self', 'wizard', 'bulk', 'invite', 'portfolio', 'legacy'], default: 'self' },
    byId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    batchId: { type: String, default: '' },
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
