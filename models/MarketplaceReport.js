const mongoose = require('mongoose');

// A resident reporting a listing (consumer protection).
const marketplaceReportSchema = new mongoose.Schema({
  estateId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  listingId:  { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceListing', required: true },
  sellerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason: { type: String, enum: ['scam', 'overpriced', 'misleading', 'unsafe', 'not_delivered', 'other'], required: true },
  note:   { type: String, default: '', maxlength: 500 },
  status: { type: String, enum: ['open', 'upheld', 'dismissed'], default: 'open' },
  resolution: { type: String, default: '' },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedAt: { type: Date, default: null },
}, { timestamps: true });

marketplaceReportSchema.index({ listingId: 1, reporterId: 1 }, { unique: true }); // one report per person per listing
marketplaceReportSchema.index({ estateId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('MarketplaceReport', marketplaceReportSchema);
