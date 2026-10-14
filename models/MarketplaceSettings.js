const mongoose = require('mongoose');

// Per-estate marketplace rules set by the estate manager.
const CATEGORIES = ['food', 'services', 'skills', 'items_for_sale', 'rentals'];

const marketplaceSettingsSchema = new mongoose.Schema({
  estateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true, unique: true },
  // Every new/edited listing waits for approval before going live.
  requireApproval: { type: Boolean, default: false },
  // Hard price ceilings per category (naira). null = no cap.
  priceCaps: {
    food:           { type: Number, default: null },
    services:       { type: Number, default: null },
    skills:         { type: Number, default: null },
    items_for_sale: { type: Number, default: null },
    rentals:        { type: Number, default: null },
  },
  // Price-gouging guard: a listing priced above (median of similar live
  // listings × this) is held for review. 0 = off.
  outlierMultiplier: { type: Number, default: 3, min: 0 },
  bannedWords:        [{ type: String, trim: true, lowercase: true }],
  maxActivePerSeller: { type: Number, default: 10, min: 1 },
  // Listing goes to review once this many different residents report it.
  autoHideReports:    { type: Number, default: 3, min: 1 },
  suspendedSellers: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, default: '' },
    until:  { type: Date },
    by:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    _id: false,
  }],
}, { timestamps: true });

marketplaceSettingsSchema.statics.CATEGORIES = CATEGORIES;
marketplaceSettingsSchema.statics.forEstate = async function (estateId) {
  return (await this.findOne({ estateId })) || this.create({ estateId });
};

module.exports = mongoose.model('MarketplaceSettings', marketplaceSettingsSchema);
