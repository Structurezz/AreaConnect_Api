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
  status: {
    type: String,
    enum: ['active', 'sold', 'pending_approval'],
    default: 'active',
  },
  contactPhone: { type: String, default: '' },
  views: { type: Number, default: 0 },
}, { timestamps: true });

marketplaceListingSchema.index({ estateId: 1, category: 1, status: 1 });

module.exports = mongoose.model('MarketplaceListing', marketplaceListingSchema);
