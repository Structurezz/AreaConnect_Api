const mongoose = require('mongoose');

// Buyer's rating of a seller, tied to a listing (one review per listing per buyer).
const marketplaceReviewSchema = new mongoose.Schema({
  estateId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  sellerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  listingId:  { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceListing', required: true },
  rating:  { type: Number, min: 1, max: 5, required: true },
  comment: { type: String, default: '', maxlength: 400 },
}, { timestamps: true });

marketplaceReviewSchema.index({ listingId: 1, reviewerId: 1 }, { unique: true });
marketplaceReviewSchema.index({ sellerId: 1, createdAt: -1 });

module.exports = mongoose.model('MarketplaceReview', marketplaceReviewSchema);
