const router = require('express').Router();
const mongoose = require('mongoose');
const { authenticate, authorize } = require('../middleware/auth');
const MarketplaceOrder = require('../models/MarketplaceOrder');
const Withdrawal = require('../models/Withdrawal');
const escrow = require('../services/marketplaceEscrow');
const { sellerLiability, ESCROW } = require('../services/marketplaceAdmin');

// AreaConnect admins: marketplace revenue (commission), escrow, seller payouts.
router.use(authenticate, authorize('super_admin'));

const since = (days) => (days ? { paidAt: { $gte: new Date(Date.now() - days * 86400_000) } } : { paidAt: { $ne: null } });

router.get('/summary', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 0;
    const [byStatus, byEstate, byDay, liability, payouts] = await Promise.all([
      MarketplaceOrder.aggregate([
        { $match: since(days) },
        { $group: { _id: '$status', n: { $sum: 1 }, gross: { $sum: '$amount' }, commission: { $sum: '$commission' }, seller: { $sum: '$sellerAmount' } } },
      ]),
      MarketplaceOrder.aggregate([
        { $match: { ...since(days), status: 'completed' } },
        { $group: { _id: '$estateId', gross: { $sum: '$amount' }, commission: { $sum: '$commission' }, n: { $sum: 1 } } },
        { $sort: { gross: -1 } }, { $limit: 20 },
        { $lookup: { from: 'estates', localField: '_id', foreignField: '_id', as: 'e', pipeline: [{ $project: { name: 1 } }] } },
      ]),
      MarketplaceOrder.aggregate([
        { $match: { status: 'completed', completedAt: { $gte: new Date(Date.now() - 30 * 86400_000) } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt' } }, commission: { $sum: '$commission' }, gross: { $sum: '$amount' } } },
        { $sort: { _id: 1 } },
      ]),
      sellerLiability(),
      Withdrawal.aggregate([
        { $match: { source: 'marketplace' } },
        { $group: { _id: '$status', total: { $sum: '$amount' }, n: { $sum: 1 } } },
      ]),
    ]);
    const s = Object.fromEntries(byStatus.map((r) => [r._id, r]));
    const sum = (keys, f) => keys.reduce((t, k) => t + (s[k]?.[f] || 0), 0);
    return res.json({ success: true, data: {
      commissionRate: escrow.COMMISSION_RATE,
      commissionEarned: sum(['completed'], 'commission'),        // ours, final
      commissionPending: sum(ESCROW, 'commission'),               // ours once escrow releases
      gmv: sum(['completed', ...ESCROW], 'gross'),
      orders: sum(['completed', ...ESCROW, 'refunded'], 'n'),
      completed: s.completed?.n || 0,
      disputed: s.disputed?.n || 0,
      refunded: { n: s.refunded?.n || 0, amount: s.refunded?.gross || 0 },
      sellers: liability,
      payouts: Object.fromEntries(payouts.map((p) => [p._id, { total: p.total, n: p.n }])),
      byEstate: byEstate.map((e) => ({ estateId: e._id, name: e.e[0]?.name || 'Estate', gross: e.gross, commission: e.commission, n: e.n })),
      byDay,
    } });
  } catch (err) {
    console.error('[admin marketplace summary]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/orders', async (req, res) => {
  try {
    const { status = 'all', estateId } = req.query;
    const q = { paidAt: { $ne: null } };
    if (status !== 'all') q.status = status;
    if (estateId && mongoose.isValidObjectId(estateId)) q.estateId = estateId;
    if (req.query.refundFailed) q['refund.status'] = 'failed';
    const orders = await MarketplaceOrder.find(q).sort({ paidAt: -1 }).limit(300)
      .populate('buyerId', 'name email').populate('sellerId', 'name email').populate('estateId', 'name').lean();
    return res.json({ success: true, data: orders });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Retry a refund Paystack rejected earlier.
router.post('/orders/:id/retry-refund', async (req, res) => {
  try {
    const order = await MarketplaceOrder.findOne({ _id: req.params.id, status: 'refunded', 'refund.status': 'failed' });
    if (!order) return res.status(404).json({ success: false, message: 'No failed refund for this order' });
    const axios = require('axios');
    try {
      await axios.post(`${escrow.PAYSTACK_BASE}/refund`, { transaction: order.reference }, { headers: escrow.paystackHeaders(), timeout: 15000 });
      order.refund.status = 'processed'; order.refund.error = '';
    } catch (e) { order.refund.error = e.response?.data?.message || e.message; }
    await order.save();
    return res.json({ success: order.refund.status === 'processed', data: order, message: order.refund.error || 'Refund sent' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
