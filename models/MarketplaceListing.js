const mongoose = require('mongoose');

const marketplaceListingSchema = new mongoose.Schema({
  estateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  images: [{ type: String }],
  price: { type: Number, required: true, min: 0 },
  category: {
    type: String,
    enum: ['food', 'services', 'skills', 'items_for_sale', 'rentals'],
    required: true,
  },
  // active = live · pending_approval = waiting for estate management ·
  // rejected / removed = taken down by management (reason in moderation) · sold
  status: {
    type: String,
    enum: ['active', 'sold', 'pending_approval', 'rejected', 'removed'],
    default: 'active',
  },
  // Why a listing was held/rejected/removed, and by whom.
  moderation: {
    reason: { type: String, default: '' },
    by:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    at:     { type: Date, default: null },
  },
  // Automatic checks that sent it to review (price_outlier, reported, …).
  flags: [{
    type:   { type: String, enum: ['price_outlier', 'reported', 'approval_required'] },
    detail: { type: String, default: '' },
    at:     { type: Date, default: Date.now },
    _id: false,
  }],
  // Consumer protection: every price the listing has had.
  priceHistory: [{ price: Number, at: { type: Date, default: Date.now }, _id: false }],
  reportCount: { type: Number, default: 0 },
  contactPhone: { type: String, default: '' },
  views: { type: Number, default: 0 },
  condition: { type: String, enum: ['new', 'like_new', 'good', 'fair'], default: 'good' },
  isNegotiable: { type: Boolean, default: false },
  savedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

marketplaceListingSchema.index({ estateId: 1, category: 1, status: 1 });
marketplaceListingSchema.index({ estateId: 1, sellerId: 1, status: 1 });
marketplaceListingSchema.index({ title: 'text', description: 'text', tags: 'text' });

module.exports = mongoose.model('MarketplaceListing', marketplaceListingSchema);
