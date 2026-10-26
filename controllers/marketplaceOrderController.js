const axios = require('axios');
const mongoose = require('mongoose');
const MarketplaceOrder = require('../models/MarketplaceOrder');
const MarketplaceListing = require('../models/MarketplaceListing');
const MarketplaceSettings = require('../models/MarketplaceSettings');
const Withdrawal = require('../models/Withdrawal');
const User = require('../models/User');
const escrow = require('../services/marketplaceEscrow');
const { sendWithdrawalReceiptEmail } = require('../services/emailService');

const { PAYSTACK_BASE, paystackHeaders, naira } = escrow;
const RESIDENTS_URL = () => process.env.RESIDENTS_URL || 'https://area-mates.areaconnect.pro';
const fail = (res, code, message, extra = {}) => res.status(code).json({ success: false, message, ...extra });
const MULTI_QTY = ['food', 'services', 'skills'];
const POP = [
  { path: 'buyerId', select: 'name profilePhoto phone' },
  { path: 'sellerId', select: 'name profilePhoto phone' },
];

// ───────────────────────── Buying ─────────────────────────

// POST /marketplace/:id/buy { quantity?, note? } → Paystack checkout URL
exports.buy = async (req, res) => {
  try {
    const listing = await MarketplaceListing.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!listing || listing.status !== 'active') return fail(res, 409, 'This listing is no longer available');
    if (String(listing.sellerId) === String(req.user._id)) return fail(res, 400, 'You can\'t buy your own listing');
    if (!(listing.price > 0)) return fail(res, 400, 'This listing is free — chat with the seller to arrange it');
    if (!process.env.PAYSTACK_SECRET_KEY) return fail(res, 503, 'Payments are not configured');

    const settings = await MarketplaceSettings.forEstate(req.estateId);
    const sus = (settings.suspendedSellers || []).find((s) => String(s.userId) === String(listing.sellerId) && (!s.until || s.until > new Date()));
    if (sus) return fail(res, 409, 'This seller can\'t take orders right now');

    const quantity = MULTI_QTY.includes(listing.category) ? Math.min(20, Math.max(1, parseInt(req.body.quantity) || 1)) : 1;
    // Someone else mid-checkout on a one-off item → don't let two people pay for it.
    if (listing.category === 'items_for_sale') {
      const busy = await MarketplaceOrder.exists({
        listingId: listing._id, buyerId: { $ne: req.user._id },
        $or: [{ status: { $in: escrow.ESCROW } }, { status: 'pending_payment', createdAt: { $gt: new Date(Date.now() - 15 * 60_000) } }],
      });
      if (busy) return fail(res, 409, 'Someone is already buying this item. Check back in a few minutes.');
    }

    const amount = Math.round(listing.price * quantity * 100) / 100;
    const { commission, sellerAmount } = escrow.split(amount);
    const reference = `MKT-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const order = await MarketplaceOrder.create({
      estateId: req.estateId, listingId: listing._id, buyerId: req.user._id, sellerId: listing.sellerId,
      title: listing.title, image: listing.images?.[0] || '', category: listing.category,
      unitPrice: listing.price, quantity, amount, commissionRate: escrow.COMMISSION_RATE, commission, sellerAmount,
      note: String(req.body.note || '').slice(0, 300), reference,
    });

    const origin = req.headers.origin || RESIDENTS_URL();
    try {
      const { data } = await axios.post(`${PAYSTACK_BASE}/transaction/initialize`, {
        email: req.user.email,
        amount: Math.round(amount * 100),
        reference,
        callback_url: `${origin}/marketplace?order=${reference}`,
        metadata: {
          type: 'marketplace_order', orderId: String(order._id), buyerId: String(req.user._id),
          custom_fields: [{ display_name: 'Purchase', variable_name: 'purchase', value: `${listing.title}${quantity > 1 ? ` ×${quantity}` : ''}` }],
        },
      }, { headers: paystackHeaders() });
      return res.json({ success: true, data: { authorizationUrl: data.data.authorization_url, reference, orderId: order._id } });
    } catch (e) {
      console.error('[marketplace.buy]', e.response?.data || e.message);
      order.status = 'cancelled'; order.cancelReason = 'checkout_failed'; await order.save();
      return fail(res, 502, 'Could not start payment. Try again.');
    }
  } catch (err) {
    console.error('[marketplace.buy]', err.message);
    return fail(res, 500, 'Server error');
  }
};

// GET /marketplace/orders/verify/:reference — after the Paystack redirect
exports.verify = async (req, res) => {
  try {
    const order = await MarketplaceOrder.findOne({ reference: req.params.reference, buyerId: req.user._id });
    if (!order) return fail(res, 404, 'Order not found');
    if (order.status === 'pending_payment' || (order.status === 'cancelled' && order.cancelReason === 'expired')) {
      const { data } = await axios.get(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(order.reference)}`, { headers: paystackHeaders() });
      const r = await escrow.settleOrder(data.data);
      if (!r.ok) return fail(res, 400, data.data?.status === 'success' ? 'Payment could not be applied' : 'Payment was not completed');
    }
    const fresh = await MarketplaceOrder.findById(order._id).populate(POP);
    return res.json({ success: true, data: fresh });
  } catch (e) {
    console.error('[marketplace.verify]', e.response?.data || e.message);
    return fail(res, 502, 'Could not verify payment');
  }
};

// GET /marketplace/orders?as=buyer|seller
exports.myOrders = async (req, res) => {
  try {
    const as = req.query.as === 'seller' ? 'sellerId' : 'buyerId';
    const orders = await MarketplaceOrder.find({ [as]: req.user._id, status: { $ne: 'pending_payment' }, cancelReason: { $ne: 'checkout_failed' } })
      .sort({ createdAt: -1 }).limit(100).populate(POP).lean();
    // Unpaid checkouts are noise; expired ones are hidden too.
    return res.json({ success: true, data: orders.filter((o) => !(o.status === 'cancelled' && !o.paidAt)) });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

async function ownOrder(req, field) {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  return MarketplaceOrder.findOne({ _id: req.params.id, [field]: req.user._id });
}

// Seller: I've handed it over → buyer has 48h to confirm or dispute.
exports.markDelivered = async (req, res) => {
  try {
    const order = await ownOrder(req, 'sellerId');
    if (!order) return fail(res, 404, 'Order not found');
    if (order.status !== 'paid') return fail(res, 409, `Order is ${order.status}`);
    const at = new Date();
    order.status = 'delivered';
    order.deliveredAt = at;
    order.autoReleaseAt = new Date(Math.min(order.autoReleaseAt?.getTime() || Infinity, at.getTime() + escrow.RELEASE_AFTER_DELIVERY_MS));
    await order.save();
    escrow.notify(order.buyerId, order.estateId, { orderId: order._id, kind: 'delivered', title: `"${order.title}" delivered?`, body: 'Tap to confirm you got it — or report a problem within 48 hours.' });
    return res.json({ success: true, data: await order.populate(POP) });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

// Buyer: got it → release the money to the seller now.
exports.confirmReceived = async (req, res) => {
  try {
    const order = await ownOrder(req, 'buyerId');
    if (!order) return fail(res, 404, 'Order not found');
    const done = await escrow.releaseOrder(order._id, 'buyer');
    if (!done) return fail(res, 409, `Order is ${order.status}`);
    return res.json({ success: true, data: await done.populate(POP) });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

// Seller can't fulfil a paid order → full refund to the buyer.
exports.sellerCancel = async (req, res) => {
  try {
    const order = await ownOrder(req, 'sellerId');
    if (!order) return fail(res, 404, 'Order not found');
    if (!['paid', 'delivered'].includes(order.status)) return fail(res, 409, `Order is ${order.status}`);
    const reason = String(req.body.reason || 'The seller cancelled the order').slice(0, 200);
    const done = await escrow.refundOrder(order._id, reason);
    if (!done) return fail(res, 409, 'Order can no longer be cancelled');
    return res.json({ success: true, data: await done.populate(POP) });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

// Buyer: problem with the order → funds frozen until estate management decides.
exports.dispute = async (req, res) => {
  try {
    const order = await ownOrder(req, 'buyerId');
    if (!order) return fail(res, 404, 'Order not found');
    if (!['paid', 'delivered'].includes(order.status)) return fail(res, 409, order.status === 'completed' ? 'This order is already complete — report the seller from the listing instead' : `Order is ${order.status}`);
    const reason = String(req.body.reason || '').trim();
    if (!reason) return fail(res, 400, 'Tell us what went wrong');
    order.status = 'disputed';
    order.dispute = { reason: reason.slice(0, 100), note: String(req.body.note || '').slice(0, 500), at: new Date() };
    await order.save();
    escrow.notify(order.sellerId, order.estateId, { orderId: order._id, kind: 'dispute', title: 'Buyer reported a problem', body: `"${order.title}" — ${order.dispute.reason}. Payment is on hold while estate management reviews it.` });
    escrow.notifyManagers(order.estateId, { id: `mkt-dispute-${order._id}`, type: 'marketplace_dispute', title: 'Marketplace order disputed', body: `"${order.title}" (${naira(order.amount)}) — ${order.dispute.reason}`, meta: { orderId: String(order._id) } });
    return res.json({ success: true, data: await order.populate(POP) });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

// ───────────────────────── Seller wallet ─────────────────────────

exports.wallet = async (req, res) => {
  try {
    const paymentCtrl = require('./paymentController');
    await paymentCtrl.syncPendingWithdrawals({ userId: req.user._id, source: 'marketplace' }, 10).catch(() => {});
    const [w, user, withdrawals, recent] = await Promise.all([
      escrow.sellerWallet(req.user._id),
      User.findById(req.user._id).select('bankCode bankName accountNumber accountName paystackRecipientCode'),
      Withdrawal.find({ userId: req.user._id, source: 'marketplace' }).sort({ createdAt: -1 }).limit(20).lean(),
      MarketplaceOrder.find({ sellerId: req.user._id, status: { $in: ['completed', 'refunded', ...escrow.ESCROW] } })
        .sort({ updatedAt: -1 }).limit(30).populate('buyerId', 'name').lean(),
    ]);
    // One timeline: sales (and refunds) in, withdrawals out.
    const activity = [
      ...recent.map((o) => ({
        kind: o.status === 'completed' ? 'sale' : o.status === 'refunded' ? 'refund' : 'escrow',
        id: String(o._id), at: o.completedAt || o.paidAt || o.updatedAt, title: o.title, buyer: o.buyerId?.name,
        gross: o.amount, commission: o.commission, amount: o.sellerAmount, status: o.status,
      })),
      ...withdrawals.map((x) => ({ kind: 'withdrawal', id: String(x._id), at: x.createdAt, amount: x.amount, status: x.status, bankName: x.bankName, accountNumber: x.accountNumber, failureReason: x.failureReason })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 40);
    return res.json({ success: true, data: {
      ...w,
      bank: { code: user.bankCode, name: user.bankName, accountNumber: user.accountNumber, accountName: user.accountName, recipientCode: user.paystackRecipientCode },
      activity,
    } });
  } catch (err) {
    console.error('[marketplace.wallet]', err.message);
    return fail(res, 500, 'Server error');
  }
};

// One withdrawal at a time per seller, so double taps queue instead of both
// failing the balance re-check. (The re-check below stays as the backstop.)
const withdrawLocks = new Map();
exports.withdraw = async (req, res) => {
  const key = String(req.user._id);
  const prev = withdrawLocks.get(key) || Promise.resolve();
  let release;
  const mine = new Promise((r) => { release = r; });
  withdrawLocks.set(key, prev.then(() => mine));
  await prev;
  try { return await doWithdraw(req, res); } finally {
    release();
    if (withdrawLocks.get(key) === mine || withdrawLocks.size > 1000) withdrawLocks.delete(key);
  }
};

// POST /marketplace/wallet/withdraw { amount } — straight to the seller's bank.
async function doWithdraw(req, res) {
  let withdrawal = null;
  try {
    const amount = Math.round(Number(req.body.amount) * 100) / 100;
    if (!amount || amount < 100) return fail(res, 400, 'Minimum withdrawal is ₦100');
    if (!process.env.PAYSTACK_SECRET_KEY) return fail(res, 503, 'Payment gateway not configured');
    const user = await User.findById(req.user._id).select('paystackRecipientCode bankName accountNumber accountName email name');
    if (!user.paystackRecipientCode) return fail(res, 400, 'Add your bank account first');

    if ((await escrow.sellerWallet(req.user._id)).available < amount) return fail(res, 400, 'Insufficient wallet balance');
    const reference = `MKW-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    withdrawal = await Withdrawal.create({
      userId: req.user._id, estateId: req.estateId, amount, status: 'pending', reference, source: 'marketplace',
      bankName: user.bankName, accountNumber: user.accountNumber, accountName: user.accountName,
    });
    require('../services/socketService').emitPlatform('withdrawal', req.estateId, { amount, name: user.name, bankName: user.bankName, source: 'marketplace' });
    // Reserve first, then re-check — a racing second request backs out.
    const after = await escrow.sellerWallet(req.user._id);
    if (after.earned - after.withdrawn - after.processing < -0.001) {
      withdrawal.status = 'failed'; withdrawal.failureReason = 'Insufficient wallet balance'; await withdrawal.save();
      return fail(res, 400, 'Insufficient wallet balance');
    }

    const isTestMode = process.env.PAYSTACK_SECRET_KEY.startsWith('sk_test_');
    if (isTestMode && user.paystackRecipientCode === 'RCP_test_mock') {
      withdrawal.status = 'success'; withdrawal.paystackTransferCode = 'TRF_test_mock';
    } else {
      try {
        const { data } = await axios.post(`${PAYSTACK_BASE}/transfer`, {
          source: 'balance', amount: Math.round(amount * 100), recipient: user.paystackRecipientCode,
          reason: `AreaMates marketplace payout — ${reference}`, reference,
        }, { headers: paystackHeaders() });
        withdrawal.status = data.data?.status === 'success' ? 'success' : 'pending';
        withdrawal.paystackStatus = data.data?.status || '';
        withdrawal.paystackTransferCode = data.data?.transfer_code || null;
      } catch (err) {
        const msg = err.response?.data?.message || 'Transfer failed';
        console.error('[marketplace withdraw]', err.response?.data || err.message);
        withdrawal.status = 'failed'; withdrawal.failureReason = msg; await withdrawal.save();
        return fail(res, 502, `Withdrawal failed: ${msg}`);
      }
    }
    await withdrawal.save();
    sendWithdrawalReceiptEmail({
      to: user.email, managerName: user.name, estateName: 'AreaMates Marketplace', estateCode: '',
      amount, bankName: user.bankName, accountNumber: user.accountNumber, accountName: user.accountName,
      reference, transferCode: withdrawal.paystackTransferCode, status: withdrawal.status, createdAt: withdrawal.createdAt,
    }).catch((e) => console.error('[marketplace withdraw email]', e.message));
    return res.json({ success: true, data: {
      status: withdrawal.status, reference,
      message: withdrawal.status === 'success' ? 'Sent — the money is on its way to your bank.'
        : withdrawal.paystackStatus === 'otp' ? 'Submitted — awaiting payout authorisation. We\'ll email you once it\'s sent.'
        : 'Withdrawal started — it will arrive in your bank shortly.',
    } });
  } catch (err) {
    console.error('[marketplace withdraw]', err.message);
    if (withdrawal && withdrawal.status === 'pending' && !withdrawal.paystackTransferCode) {
      withdrawal.status = 'failed'; withdrawal.failureReason = 'Withdrawal could not be completed';
      await withdrawal.save().catch(() => {});
    }
    return fail(res, 500, 'Withdrawal failed. Please try again.');
  }
}

// ───────────────────────── Estate management ─────────────────────────

exports.adminOrders = async (req, res) => {
  try {
    const status = req.query.status || 'disputed';
    const q = { estateId: req.estateId, status: status === 'all' ? { $nin: ['pending_payment'] } : status };
    if (status === 'all') q.paidAt = { $ne: null };
    const [orders, totals] = await Promise.all([
      MarketplaceOrder.find(q).sort({ updatedAt: -1 }).limit(200).populate(POP).populate('dispute.resolvedBy', 'name').lean(),
      MarketplaceOrder.aggregate([
        { $match: { estateId: new mongoose.Types.ObjectId(String(req.estateId)), paidAt: { $ne: null } } },
        { $group: { _id: '$status', n: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
    ]);
    return res.json({ success: true, data: orders, totals: Object.fromEntries(totals.map((t) => [t._id, { n: t.n, amount: t.amount }])) });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};

// POST /admin/orders/:id/resolve { action: 'release'|'refund', note }
exports.resolveDispute = async (req, res) => {
  try {
    const { action } = req.body;
    const note = String(req.body.note || '').trim().slice(0, 300);
    if (!['release', 'refund'].includes(action)) return fail(res, 400, 'action must be release or refund');
    const order = await MarketplaceOrder.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!order) return fail(res, 404, 'Order not found');
    if (!escrow.ESCROW.includes(order.status)) return fail(res, 409, `Order is ${order.status}`);
    const by = 'manager';
    await MarketplaceOrder.updateOne({ _id: order._id }, {
      'dispute.resolution': note || (action === 'refund' ? 'Refunded to buyer' : 'Released to seller'),
      'dispute.resolvedBy': req.user._id, 'dispute.resolvedAt': new Date(),
    });
    const done = action === 'refund'
      ? await escrow.refundOrder(order._id, note || 'Estate management refunded this order')
      : await escrow.releaseOrder(order._id, by, { fromDispute: true });
    if (!done) return fail(res, 409, 'Order was already settled');
    return res.json({ success: true, data: done });
  } catch (err) {
    return fail(res, 500, 'Server error');
  }
};
