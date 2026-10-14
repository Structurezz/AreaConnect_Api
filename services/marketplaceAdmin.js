const MarketplaceOrder = require('../models/MarketplaceOrder');
const Withdrawal = require('../models/Withdrawal');

const ESCROW = ['paid', 'delivered', 'disputed'];

/**
 * Money the platform holds for marketplace sellers: escrow plus released
 * earnings not yet withdrawn. Used by the admin balance check so Paystack
 * payouts never eat into sellers' funds.
 */
async function sellerLiability() {
  const [orders, wd] = await Promise.all([
    MarketplaceOrder.aggregate([
      { $match: { status: { $in: ['completed', ...ESCROW] } } },
      { $group: { _id: { $cond: [{ $eq: ['$status', 'completed'] }, 'completed', 'escrow'] }, total: { $sum: '$sellerAmount' } } },
    ]),
    Withdrawal.aggregate([
      { $match: { source: 'marketplace', status: { $in: ['pending', 'success'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);
  const o = Object.fromEntries(orders.map((r) => [r._id, r.total]));
  const escrow = o.escrow || 0;
  const available = Math.max(0, (o.completed || 0) - (wd[0]?.total || 0));
  return { escrow, available, total: escrow + available };
}

module.exports = { sellerLiability, ESCROW };
