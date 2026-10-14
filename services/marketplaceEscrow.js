const axios = require('axios');
const mongoose = require('mongoose');
const MarketplaceOrder = require('../models/MarketplaceOrder');
const MarketplaceListing = require('../models/MarketplaceListing');
const Withdrawal = require('../models/Withdrawal');
const User = require('../models/User');
const Estate = require('../models/Estate');
const { emitNotification, getIO } = require('./socketService');
const { sendManagerNotificationEmail } = require('./emailService');

// Platform commission on every marketplace sale (AreaConnect's cut).
const COMMISSION_RATE = Number(process.env.MARKETPLACE_COMMISSION_RATE || 0.2);
// Escrow: funds release to the seller this long after payment / delivery,
// unless the buyer confirms sooner or opens a dispute.
const RELEASE_AFTER_PAYMENT_MS  = 7 * 24 * 3600_000;
const RELEASE_AFTER_DELIVERY_MS = 48 * 3600_000;
const CHECKOUT_TTL_MS = 2 * 3600_000; // unpaid checkouts expire
const ESCROW = ['paid', 'delivered', 'disputed'];

const PAYSTACK_BASE = 'https://api.paystack.co';
const paystackHeaders = () => ({ Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' });
const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
const round2 = (n) => Math.round(n * 100) / 100;

function split(amount, rate = COMMISSION_RATE) {
  const commission = round2(amount * rate);
  return { commission, sellerAmount: round2(amount - commission) };
}

const oid = (id) => new mongoose.Types.ObjectId(String(id));

/**
 * A seller's marketplace wallet, derived from orders and withdrawals so it
 * can never drift: available = released earnings − withdrawals (pending or
 * paid). Failed/rejected withdrawals drop out, so the money comes back.
 */
async function sellerWallet(userId) {
  const uid = oid(userId);
  const [orders, wd] = await Promise.all([
    MarketplaceOrder.aggregate([
      { $match: { sellerId: uid, status: { $in: ['completed', ...ESCROW] } } },
      { $group: {
        _id: { $cond: [{ $eq: ['$status', 'completed'] }, 'completed', 'escrow'] },
        seller: { $sum: '$sellerAmount' }, commission: { $sum: '$commission' }, gross: { $sum: '$amount' }, n: { $sum: 1 },
      } },
    ]),
    Withdrawal.aggregate([
      { $match: { userId: uid, source: 'marketplace', status: { $in: ['pending', 'success'] } } },
      { $group: { _id: '$status', total: { $sum: '$amount' } } },
    ]),
  ]);
  const o = Object.fromEntries(orders.map((r) => [r._id, r]));
  const w = Object.fromEntries(wd.map((r) => [r._id, r.total]));
  const earned = round2(o.completed?.seller || 0);
  const withdrawn = round2(w.success || 0);
  const processing = round2(w.pending || 0);
  return {
    available: Math.max(0, round2(earned - withdrawn - processing)),
    escrow: round2(o.escrow?.seller || 0),
    escrowOrders: o.escrow?.n || 0,
    earned, withdrawn, processing,
    commissionPaid: round2(o.completed?.commission || 0),
    grossSales: round2(o.completed?.gross || 0),
    completedOrders: o.completed?.n || 0,
    commissionRate: COMMISSION_RATE,
  };
}

const notify = (userId, estateId, n) => emitNotification(estateId, {
  id: `mkt-order-${n.orderId}-${n.kind}`, type: 'marketplace_order', title: n.title, body: n.body,
  meta: { orderId: String(n.orderId) },
}, userId);

async function emailUser(userId, estateId, title, body) {
  try {
    const [u, e] = await Promise.all([User.findById(userId).select('email name'), Estate.findById(estateId).select('name')]);
    if (u?.email) await sendManagerNotificationEmail({ to: u.email, managerName: u.name?.split(' ')[0], estateName: e?.name || 'AreaMates', type: 'marketplace', title, body });
  } catch (err) { console.error('[marketplace email]', err.message); }
}

/** Paystack refund of the whole order. Never throws. */
async function paystackRefund(order) {
  if (!process.env.PAYSTACK_SECRET_KEY) return { ok: false, error: 'Payment gateway not configured' };
  try {
    await axios.post(`${PAYSTACK_BASE}/refund`, { transaction: order.reference }, { headers: paystackHeaders(), timeout: 15000 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.response?.data?.message || e.message };
  }
}

/**
 * Refund a paid order back to the buyer (seller can't deliver, dispute
 * upheld, item already sold…). Idempotent: only one caller wins.
 */
async function refundOrder(orderId, reason, { relist = true } = {}) {
  const order = await MarketplaceOrder.findOneAndUpdate(
    { _id: orderId, status: { $in: ESCROW } },
    { status: 'refunded', refund: { status: 'processing', reason, at: new Date() } },
    { new: true },
  );
  if (!order) return null;
  const r = await paystackRefund(order);
  order.refund.status = r.ok ? 'processed' : 'failed';
  order.refund.error = r.ok ? '' : r.error;
  await order.save();
  if (!r.ok) console.error('[marketplace refund]', order.reference, r.error);

  // A one-off item goes back on the market.
  if (relist && order.category === 'items_for_sale') {
    await MarketplaceListing.updateOne({ _id: order.listingId, status: 'sold' }, { status: 'active' });
  }
  notify(order.buyerId, order.estateId, { orderId: order._id, kind: 'refund', title: 'Refund on its way 💸', body: `${naira(order.amount)} for "${order.title}" — ${reason}` });
  notify(order.sellerId, order.estateId, { orderId: order._id, kind: 'refund', title: 'Order refunded', body: `"${order.title}" — ${reason}` });
  emailUser(order.buyerId, order.estateId, 'Your marketplace refund', `${naira(order.amount)} for "${order.title}" is being refunded to your card/bank. Reason: ${reason}. Refunds usually arrive within 5–10 working days.`);
  return order;
}

/** Move escrow to the seller's available balance. */
async function releaseOrder(orderId, by, { fromDispute = false } = {}) {
  const order = await MarketplaceOrder.findOneAndUpdate(
    { _id: orderId, status: { $in: fromDispute ? ESCROW : ['paid', 'delivered'] } },
    { status: 'completed', completedAt: new Date(), completedBy: by },
    { new: true },
  );
  if (!order) return null;
  notify(order.sellerId, order.estateId, { orderId: order._id, kind: 'released', title: `${naira(order.sellerAmount)} is in your wallet 💰`, body: `"${order.title}" is complete — you can withdraw it now` });
  if (by !== 'buyer') notify(order.buyerId, order.estateId, { orderId: order._id, kind: 'released', title: 'Order completed', body: `"${order.title}" — payment released to the seller` });
  return order;
}

/**
 * Apply a successful Paystack charge to its order. Shared by the redirect
 * verify and the webhook; safe to call any number of times.
 */
async function settleOrder(tx) {
  const meta = tx?.metadata || {};
  if (tx?.status !== 'success' || meta.type !== 'marketplace_order') return { ok: false };
  const order = await MarketplaceOrder.findOne({ reference: tx.reference });
  if (!order) return { ok: false, reason: 'not_found' };
  if (tx.amount < Math.round(order.amount * 100)) return { ok: false, reason: 'amount_mismatch' };
  if (order.status !== 'pending_payment' && !(order.status === 'cancelled' && order.cancelReason === 'expired')) {
    return { ok: true, order, already: true };
  }
  const now = new Date();
  const paid = await MarketplaceOrder.findOneAndUpdate(
    { _id: order._id, status: order.status },
    { status: 'paid', paidAt: now, autoReleaseAt: new Date(now.getTime() + RELEASE_AFTER_PAYMENT_MS), cancelReason: '' },
    { new: true },
  );
  if (!paid) return { ok: true, order: await MarketplaceOrder.findById(order._id), already: true };

  // One-off items: the first paid order takes it; anyone later is refunded.
  if (paid.category === 'items_for_sale') {
    const took = await MarketplaceListing.findOneAndUpdate({ _id: paid.listingId, status: 'active' }, { status: 'sold' });
    if (!took) {
      const refunded = await refundOrder(paid._id, 'The item was already sold to another buyer', { relist: false });
      return { ok: true, order: refunded, soldOut: true };
    }
  }

  const buyer = await User.findById(paid.buyerId).select('name');
  notify(paid.sellerId, paid.estateId, { orderId: paid._id, kind: 'new', title: `New order: ${paid.title} 🛍️`, body: `${buyer?.name || 'A neighbour'} paid ${naira(paid.amount)}${paid.quantity > 1 ? ` (×${paid.quantity})` : ''}. Deliver it, then mark it delivered.` });
  notify(paid.buyerId, paid.estateId, { orderId: paid._id, kind: 'paid', title: 'Payment received ✅', body: `Your money is held safely until you confirm you got "${paid.title}".` });
  emailUser(paid.sellerId, paid.estateId, `New order — ${paid.title}`, `${buyer?.name || 'A neighbour'} paid ${naira(paid.amount)} for "${paid.title}"${paid.quantity > 1 ? ` (quantity ${paid.quantity})` : ''}${paid.note ? `. Note: "${paid.note}"` : ''}. You'll receive ${naira(paid.sellerAmount)} once they confirm delivery. Open the Marketplace in AreaMates to manage the order.`);
  return { ok: true, order: paid };
}

/** Auto-release due escrow and expire stale checkouts. */
async function sweep() {
  const now = new Date();
  const due = await MarketplaceOrder.find({ status: { $in: ['paid', 'delivered'] }, autoReleaseAt: { $lte: now } }).select('_id').limit(200);
  for (const o of due) await releaseOrder(o._id, 'auto').catch((e) => console.error('[escrow release]', e.message));
  await MarketplaceOrder.updateMany(
    { status: 'pending_payment', createdAt: { $lt: new Date(now - CHECKOUT_TTL_MS) } },
    { status: 'cancelled', cancelReason: 'expired' },
  );
  return due.length;
}

function startEscrowSweeper() {
  const run = () => sweep().catch((e) => console.error('[escrow sweep]', e.message));
  setTimeout(run, 30_000);
  setInterval(run, 10 * 60_000);
}

const notifyManagers = (estateId, n) => getIO()?.to(`estate:${estateId}:estate_manager`).emit('notification', { ...n, createdAt: new Date().toISOString() });

module.exports = {
  COMMISSION_RATE, RELEASE_AFTER_DELIVERY_MS, ESCROW,
  split, sellerWallet, settleOrder, releaseOrder, refundOrder, sweep, startEscrowSweeper, notify, notifyManagers, naira,
  paystackHeaders, PAYSTACK_BASE,
};
