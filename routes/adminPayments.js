// Super-admin payment ops — cross-estate transactions, Paystack ledger,
// reconcile and attach against any estate. Mirrors the manager-scoped
// routes under /api/payments but drops the estate scope so platform admins
// can see and act on every capture.

const router = require('express').Router();
const axios  = require('axios');
const Payment         = require('../models/Payment');
const PaymentSchedule = require('../models/PaymentSchedule');
const User   = require('../models/User');
const Estate = require('../models/Estate');
const { authenticate, authorize } = require('../middleware/auth');

const PAYSTACK_BASE = 'https://api.paystack.co';
const paystackHeaders = () => ({
  Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
  'Content-Type': 'application/json',
});

router.use(authenticate, authorize('super_admin'));

// GET /api/admin/payments — platform-wide payments list
// Query: status, estateId, search (resident name/email or reference), limit
router.get('/', async (req, res) => {
  try {
    const { status, estateId, search, limit = 100 } = req.query;
    const q = {};
    if (status)   q.status   = status;
    if (estateId) q.estateId = estateId;

    let payments;
    if (search) {
      const trimmed = String(search).trim();
      // Match by Paystack reference exactly, otherwise fall back to a
      // name/email lookup against the User collection.
      const refMatch = await Payment.find({ ...q, paystackReference: trimmed })
        .populate('residentId', 'name email phone')
        .populate('scheduleId', 'title amount frequency')
        .populate('estateId', 'name estateCode')
        .sort({ createdAt: -1 }).limit(Number(limit) || 100).lean();

      if (refMatch.length) {
        payments = refMatch;
      } else {
        const re = new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const residents = await User.find({ role: 'resident', $or: [{ name: re }, { email: re }] }).select('_id').lean();
        q.residentId = { $in: residents.map(r => r._id) };
        payments = await Payment.find(q)
          .populate('residentId', 'name email phone')
          .populate('scheduleId', 'title amount frequency')
          .populate('estateId', 'name estateCode')
          .sort({ createdAt: -1 }).limit(Number(limit) || 100).lean();
      }
    } else {
      payments = await Payment.find(q)
        .populate('residentId', 'name email phone')
        .populate('scheduleId', 'title amount frequency')
        .populate('estateId', 'name estateCode')
        .sort({ createdAt: -1 })
        .limit(Math.min(Number(limit) || 100, 500))
        .lean();
    }

    return res.json({ success: true, data: payments });
  } catch (err) {
    console.error('[admin/payments list]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/admin/payments/stats — platform-wide payment counters
router.get('/stats', async (req, res) => {
  try {
    const now = new Date();
    const thirtyAgo = new Date(now.getTime() - 30 * 86400000);
    const [paidAll, paidThisMonth, pending, overdue, pendingPaystackRefs] = await Promise.all([
      Payment.aggregate([
        { $match: { status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Payment.aggregate([
        { $match: { status: 'paid', paidAt: { $gte: thirtyAgo } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Payment.countDocuments({ status: 'pending' }),
      Payment.countDocuments({ status: 'overdue' }),
      // Pending rows that at least started a Paystack checkout — candidates for reconcile/attach
      Payment.countDocuments({ status: { $ne: 'paid' }, paystackReference: { $exists: true, $ne: null, $ne: '' } }),
    ]);
    return res.json({
      success: true,
      data: {
        collected:          paidAll[0]?.total || 0,
        collectedCount:     paidAll[0]?.count || 0,
        collected30d:       paidThisMonth[0]?.total || 0,
        collected30dCount:  paidThisMonth[0]?.count || 0,
        pending,
        overdue,
        pendingWithPaystackRef: pendingPaystackRefs,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/admin/payments/paystack/ledger — platform-wide Paystack view
router.get('/paystack/ledger', async (req, res) => {
  try {
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ success: false, message: 'Payment gateway not configured' });
    }
    const perPage = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const status  = req.query.status || 'success';

    const { data } = await axios.get(
      `${PAYSTACK_BASE}/transaction?perPage=${perPage}&status=${encodeURIComponent(status)}`,
      { headers: paystackHeaders() },
    );
    const transactions = Array.isArray(data?.data) ? data.data : [];
    if (!transactions.length) return res.json({ success: true, data: [] });

    const refs = transactions.map(t => t.reference).filter(Boolean);
    // Cross-estate lookup — no estateId filter
    const matches = await Payment.find({ paystackReference: { $in: refs } })
      .populate('scheduleId', 'title')
      .populate('residentId', 'name email')
      .populate('estateId', 'name estateCode')
      .lean();
    const byRef = matches.reduce((m, p) => { m[p.paystackReference] = p; return m; }, {});

    const rows = transactions.map(t => ({
      reference: t.reference,
      amount:    (t.amount || 0) / 100,
      currency:  t.currency,
      status:    t.status,
      channel:   t.channel,
      paidAt:    t.paid_at || t.paidAt || null,
      createdAt: t.created_at || t.createdAt,
      customer: t.customer ? {
        email: t.customer.email,
        name:  [t.customer.first_name, t.customer.last_name].filter(Boolean).join(' ') || null,
      } : null,
      metadata:  t.metadata || {},
      matched:   !!byRef[t.reference],
      payment:   byRef[t.reference] || null,
    }));

    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[admin/paystack ledger]', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to load Paystack transactions' });
  }
});

// POST /api/admin/payments/reconcile/:reference — cross-estate reconcile
router.post('/reconcile/:reference', async (req, res) => {
  try {
    const { reference } = req.params;
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ success: false, message: 'Payment gateway not configured' });
    }
    const payment = await Payment.findOne({ paystackReference: reference });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    if (payment.status === 'paid') return res.json({ success: true, data: payment, alreadyPaid: true });

    const { data } = await axios.get(
      `${PAYSTACK_BASE}/transaction/verify/${reference}`,
      { headers: paystackHeaders() },
    );
    if (data?.data?.status !== 'success') {
      return res.status(400).json({
        success: false,
        message: `Paystack status: ${data?.data?.status || 'unknown'}`,
        gateway: data?.data?.gateway_response || null,
      });
    }
    const { settlePaymentByReference } = require('../controllers/paymentController');
    const result = await settlePaymentByReference(reference);
    return res.json({ success: true, data: result.payment, reconciled: true });
  } catch (err) {
    console.error('[admin reconcile]', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Reconcile failed' });
  }
});

// POST /api/admin/payments/paystack/attach — attach cross-estate
// body: { reference, estateId, residentId, scheduleId, notes? }
router.post('/paystack/attach', async (req, res) => {
  try {
    const { reference, estateId, residentId, scheduleId, notes } = req.body || {};
    if (!reference || !estateId || !residentId || !scheduleId) {
      return res.status(400).json({ success: false, message: 'reference, estateId, residentId and scheduleId are required' });
    }
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ success: false, message: 'Payment gateway not configured' });
    }

    const existing = await Payment.findOne({ paystackReference: reference });
    if (existing && existing.status === 'paid') {
      return res.json({ success: true, data: existing, alreadyPaid: true });
    }

    const { data } = await axios.get(
      `${PAYSTACK_BASE}/transaction/verify/${reference}`,
      { headers: paystackHeaders() },
    );
    if (data?.data?.status !== 'success') {
      return res.status(400).json({
        success: false,
        message: `Paystack status: ${data?.data?.status || 'unknown'}`,
      });
    }
    const amountNaira = (data.data.amount || 0) / 100;

    const [schedule, resident, estate] = await Promise.all([
      PaymentSchedule.findOne({ _id: scheduleId, estateId }),
      User.findOne({ _id: residentId, estateId, role: 'resident' }),
      Estate.findById(estateId).select('_id name'),
    ]);
    if (!estate)   return res.status(404).json({ success: false, message: 'Estate not found' });
    if (!schedule) return res.status(404).json({ success: false, message: 'Schedule not found for that estate' });
    if (!resident) return res.status(404).json({ success: false, message: 'Resident not found for that estate' });

    if (existing) {
      existing.estateId  = estateId;
      existing.residentId = resident._id;
      existing.scheduleId = schedule._id;
      existing.paystackReference = reference;
      existing.amount    = existing.amount || amountNaira;
      if (notes) existing.notes = notes;
      await existing.save();
    } else {
      await Payment.create({
        scheduleId: schedule._id,
        residentId: resident._id,
        estateId,
        amount:     amountNaira,
        status:     'pending',
        paystackReference: reference,
        notes:      notes || `Attached by admin from Paystack ${reference}`,
        recordedBy: req.user._id,
      });
    }

    const { settlePaymentByReference } = require('../controllers/paymentController');
    const result = await settlePaymentByReference(reference);
    return res.json({ success: true, data: result.payment, attached: true });
  } catch (err) {
    console.error('[admin attach]', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Attach failed' });
  }
});

module.exports = router;
