const mongoose = require('mongoose');

/**
 * A purchase on the residents' marketplace, paid through Paystack.
 * Money flow: buyer pays → held in escrow (paid/delivered) → released to the
 * seller's wallet (completed, minus the platform commission) or refunded.
 */
const marketplaceOrderSchema = new mongoose.Schema({
  estateId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  listingId: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceListing', required: true },
  buyerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sellerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Snapshot of what was bought (the listing can change later).
  title:    { type: String, required: true },
  image:    { type: String, default: '' },
  category: { type: String, default: '' },
  unitPrice: { type: Number, required: true },
  quantity:  { type: Number, default: 1, min: 1 },
  amount:    { type: Number, required: true },          // what the buyer pays (₦)
  commissionRate: { type: Number, required: true },     // e.g. 0.2
  commission:     { type: Number, required: true },     // platform's cut (₦)
  sellerAmount:   { type: Number, required: true },     // seller's earnings (₦)
  note: { type: String, default: '', maxlength: 300 },  // buyer's delivery note

  status: {
    type: String,
    enum: ['pending_payment', 'paid', 'delivered', 'completed', 'disputed', 'refunded', 'cancelled'],
    default: 'pending_payment',
  },
  reference: { type: String, required: true, unique: true }, // Paystack reference
  paidAt:      Date,
  deliveredAt: Date,
  completedAt: Date,
  completedBy: { type: String, enum: ['buyer', 'auto', 'manager', 'admin', null], default: null },
  // Escrow auto-releases to the seller after this unless disputed.
  autoReleaseAt: Date,

  dispute: {
    reason: { type: String, default: '' },
    note:   { type: String, default: '' },
    at:     Date,
    resolution: { type: String, default: '' },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: Date,
  },
  refund: {
    status: { type: String, enum: ['none', 'processing', 'processed', 'failed'], default: 'none' },
    reason: { type: String, default: '' },
    at: Date,
    error: { type: String, default: '' },
  },
  cancelReason: { type: String, default: '' },
}, { timestamps: true });

marketplaceOrderSchema.index({ buyerId: 1, createdAt: -1 });
marketplaceOrderSchema.index({ sellerId: 1, status: 1, createdAt: -1 });
marketplaceOrderSchema.index({ estateId: 1, status: 1, createdAt: -1 });
marketplaceOrderSchema.index({ status: 1, autoReleaseAt: 1 });
marketplaceOrderSchema.index({ listingId: 1, status: 1 });

module.exports = mongoose.model('MarketplaceOrder', marketplaceOrderSchema);
