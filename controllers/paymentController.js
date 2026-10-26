const axios = require('axios');
const PaymentSchedule = require('../models/PaymentSchedule');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Estate = require('../models/Estate');
const Withdrawal = require('../models/Withdrawal');
const { emitNotification } = require('../services/socketService');
const { sendManagerNotificationEmail, sendPaymentReceiptEmail, sendWithdrawalReceiptEmail } = require('../services/emailService');

const PAYSTACK_BASE = 'https://api.paystack.co';
const paystackHeaders = () => ({
  Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
  'Content-Type': 'application/json',
});

// ── Helpers ────────────────────────────────────────────────────────────────

const generateRef = () =>
  `EST-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const markOverdue = async (estateId) => {
  const now = new Date();
  const overdueSched = await PaymentSchedule.find({ estateId, isActive: true, dueDate: { $lt: now } }).select('_id');
  if (overdueSched.length) {
    await Payment.updateMany(
      { scheduleId: { $in: overdueSched.map((s) => s._id) }, status: 'pending' },
      { status: 'overdue' }
    );
  }
};

// Only dues paid online (Paystack) are money AreaConnect actually holds, so
// only they count towards the withdrawable wallet. Cash / bank transfers the
// manager records by hand were paid to the estate directly — they show as
// paid on the resident's record but must never be withdrawable.
const ONLINE_PAID = { status: 'paid', method: 'paystack' };
exports.ONLINE_PAID = ONLINE_PAID;

const creditManagerWallet = async (estateId, amount) => {
  const estate = await Estate.findById(estateId).select('managerId');
  if (estate?.managerId) {
    await User.findByIdAndUpdate(estate.managerId, { $inc: { walletBalance: amount } });
  }
};

// ── Estate Manager: create schedule ───────────────────────────────────────

exports.createSchedule = async (req, res) => {
  try {
    const { title, description, type, amount, frequency, dueDate } = req.body;

    const schedule = await PaymentSchedule.create({
      estateId: req.estateId,
      createdBy: req.user._id,
      title, description, type, amount, frequency,
      dueDate: new Date(dueDate),
    });

    const residents = await User.find({
      estateId: req.estateId,
      role: 'resident',
      isActive: true,
    }).select('_id');

    if (residents.length) {
      await Payment.insertMany(
        residents.map((r) => ({
          scheduleId: schedule._id,
          residentId: r._id,
          estateId: req.estateId,
          amount,
          status: new Date(dueDate) < new Date() ? 'overdue' : 'pending',
        }))
      );
    }

    return res.status(201).json({ success: true, data: schedule, count: residents.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getSchedules = async (req, res) => {
  try {
    await markOverdue(req.estateId);
    const schedules = await PaymentSchedule.find({ estateId: req.estateId })
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 });

    const enriched = await Promise.all(
      schedules.map(async (s) => {
        const [total, paid, overdue] = await Promise.all([
          Payment.countDocuments({ scheduleId: s._id }),
          Payment.countDocuments({ scheduleId: s._id, status: 'paid' }),
          Payment.countDocuments({ scheduleId: s._id, status: 'overdue' }),
        ]);
        const collected = await Payment.aggregate([
          { $match: { scheduleId: s._id, status: 'paid' } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]);
        return {
          ...s.toObject(),
          stats: {
            total,
            paid,
            pending: total - paid - overdue,
            overdue,
            collected: collected[0]?.total || 0,
            expected: s.amount * total,
          },
        };
      })
    );

    return res.json({ success: true, data: enriched });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getSchedulePayments = async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const schedule = await PaymentSchedule.findOne({ _id: scheduleId, estateId: req.estateId });
    if (!schedule) return res.status(404).json({ success: false, message: 'Schedule not found' });

    const payments = await Payment.find({ scheduleId })
      .populate('residentId', 'name email phone')
      .populate('recordedBy', 'name')
      .sort({ status: 1, createdAt: 1 });

    return res.json({ success: true, data: payments, schedule });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.recordManualPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { method, notes, paidAt } = req.body;

    const payment = await Payment.findOne({ _id: paymentId, estateId: req.estateId });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    if (payment.status === 'paid') return res.status(400).json({ success: false, message: 'Already paid' });

    payment.status = 'paid';
    payment.method = method || 'manual';
    payment.notes = notes || '';
    payment.paidAt = paidAt ? new Date(paidAt) : new Date();
    payment.recordedBy = req.user._id;
    await payment.save();

    // No wallet credit: this money was paid outside the platform.

    await payment.populate([
      { path: 'residentId', populate: { path: 'unitId', select: 'unitNumber block type' } },
      { path: 'scheduleId' },
      { path: 'recordedBy', select: 'name' },
      { path: 'estateId', select: 'name address estateCode logoUrl' },
    ]);

    const resident  = payment.residentId;
    const estate    = payment.estateId;
    const schedule  = payment.scheduleId;
    const unit      = resident?.unitId;
    const dateStr   = payment.createdAt.toISOString().slice(0, 10).replace(/-/g, '');
    const invoiceNumber = `INV-${dateStr}-${payment._id.toString().slice(-6).toUpperCase()}`;

    const inv = {
      invoiceNumber,
      date: payment.createdAt,
      dueDate: schedule?.dueDate,
      status: payment.status,
      paidAt: payment.paidAt,
      method: payment.method,
      notes: payment.notes,
      recordedBy: payment.recordedBy?.name || null,
      estate: { name: estate?.name || '', address: estate?.address || '', estateCode: estate?.estateCode || '', logoUrl: estate?.logoUrl || '' },
      resident: {
        name: resident?.name || 'Resident',
        email: resident?.email || '',
        phone: resident?.phone || '',
        unit: unit ? `${unit.block ? unit.block + ' ' : ''}${unit.unitNumber}` : 'N/A',
      },
      items: [{ description: schedule?.title || 'Payment', detail: schedule?.description || '', frequency: schedule?.frequency || '', quantity: 1, unitPrice: payment.amount, vat: 0, total: payment.amount }],
      subtotal: payment.amount, vatAmount: 0, total: payment.amount,
    };

    try {
      const fmt = (n) => `₦${Number(n).toLocaleString('en-NG')}`;
      emitNotification(req.estateId, {
        id: payment._id.toString(),
        type: 'payment_received',
        title: 'Payment Recorded',
        body: `Your payment of ${fmt(payment.amount)} for ${schedule?.title || 'levy'} has been recorded`,
        amount: payment.amount,
        meta: { paymentId: payment._id },
      }, resident?._id);
    } catch (e) { console.error('[notify recordManualPayment]', e.message); }

    // Send receipt email to resident (fire-and-forget)
    if (resident?.email) {
      sendPaymentReceiptEmail({
        to: resident.email,
        residentName: resident.name,
        estateName: estate?.name || 'your estate',
        inv,
      }).catch(e => console.error('[receipt email]', e.message));
    }

    return res.json({ success: true, data: payment });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getPaymentHistory = async (req, res) => {
  try {
    await markOverdue(req.estateId);

    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip  = (page - 1) * limit;

    const filter = { estateId: req.estateId };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.resident) filter.residentId = req.query.resident;

    const [payments, total] = await Promise.all([
      Payment.find(filter)
        .populate('residentId', 'name email')
        .populate('scheduleId', 'title type frequency')
        .populate('recordedBy', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Payment.countDocuments(filter),
    ]);

    return res.json({ success: true, data: payments, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[getPaymentHistory]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getInvoice = async (req, res) => {
  try {
    // Managers can open any invoice in their estate; everyone else only their
    // own — otherwise a resident with another resident's payment ID could read
    // that person's name, email, phone and unit. 404 (not 403) so the
    // existence of other residents' payments isn't revealed either.
    const filter = { _id: req.params.paymentId, estateId: req.estateId };
    if (!['estate_manager', 'super_admin'].includes(req.user.role)) {
      filter.residentId = req.user._id;
    }

    const payment = await Payment.findOne(filter)
      .populate('scheduleId')
      .populate('residentId', 'name email phone unitId')
      .populate({ path: 'residentId', populate: { path: 'unitId', select: 'unitNumber block type' } })
      .populate('recordedBy', 'name')
      .populate('estateId', 'name address estateCode logoUrl');

    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

    const estate = payment.estateId;
    const resident = payment.residentId;
    const schedule = payment.scheduleId;
    const unit = resident?.unitId;

    const dateStr = payment.createdAt.toISOString().slice(0, 10).replace(/-/g, '');
    const invoiceNumber = `INV-${dateStr}-${payment._id.toString().slice(-6).toUpperCase()}`;

    const TYPE_LABELS = {
      security_dues: 'Security Dues',
      maintenance:   'Maintenance Fee',
      levy:          'Estate Levy',
      contribution:  'Community Contribution',
      other:         'Payment',
    };

    return res.json({
      success: true,
      data: {
        invoiceNumber,
        date: payment.createdAt,
        dueDate: schedule?.dueDate,
        status: payment.status,
        paidAt: payment.paidAt,
        method: payment.method,
        notes: payment.notes,
        recordedBy: payment.recordedBy?.name || null,
        estate: {
          name: estate?.name || '',
          address: estate?.address || '',
          estateCode: estate?.estateCode || '',
          logoUrl: estate?.logoUrl || '',
        },
        resident: {
          name: resident?.name || 'Resident',
          email: resident?.email || '',
          phone: resident?.phone || '',
          unit: unit ? `${unit.block ? unit.block + ' ' : ''}${unit.unitNumber}` : 'N/A',
        },
        items: [{
          description: schedule?.title || TYPE_LABELS[schedule?.type] || 'Payment',
          detail: schedule?.description || '',
          frequency: schedule?.frequency || '',
          quantity: 1,
          unitPrice: payment.amount,
          vat: 0,
          total: payment.amount,
        }],
        subtotal: payment.amount,
        vatAmount: 0,
        total: payment.amount,
      },
    });
  } catch (err) {
    console.error('[getInvoice]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.waivePayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const payment = await Payment.findOneAndUpdate(
      { _id: paymentId, estateId: req.estateId },
      { status: 'waived', recordedBy: req.user._id, notes: req.body.notes || 'Waived by manager' },
      { new: true }
    ).populate('residentId', 'name email');

    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    return res.json({ success: true, data: payment });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getPaymentStats = async (req, res) => {
  try {
    await markOverdue(req.estateId);
    const [totalCollectedArr, pending, overdue, activeSchedules] = await Promise.all([
      Payment.aggregate([
        { $match: { estateId: req.estateId, status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Payment.countDocuments({ estateId: req.estateId, status: 'pending' }),
      Payment.countDocuments({ estateId: req.estateId, status: 'overdue' }),
      PaymentSchedule.countDocuments({ estateId: req.estateId, isActive: true }),
    ]);

    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
    const thisMonthArr = await Payment.aggregate([
      { $match: { estateId: req.estateId, status: 'paid', paidAt: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    return res.json({
      success: true,
      data: {
        totalCollected: totalCollectedArr[0]?.total || 0,
        thisMonth: thisMonthArr[0]?.total || 0,
        pending,
        overdue,
        activeSchedules,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Resident: view own payments ────────────────────────────────────────────

exports.getMyPayments = async (req, res) => {
  try {
    await markOverdue(req.estateId);
    const payments = await Payment.find({ residentId: req.user._id, estateId: req.estateId })
      .populate('scheduleId', 'title type frequency dueDate amount')
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: payments });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Paystack: resident payment ─────────────────────────────────────────────

exports.initializePayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const payment = await Payment.findOne({
      _id: paymentId,
      residentId: req.user._id,
      estateId: req.estateId,
    }).populate('scheduleId', 'title');

    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    if (payment.status === 'paid') return res.status(400).json({ success: false, message: 'Already paid' });

    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ success: false, message: 'Payment gateway not configured. Contact the estate manager.' });
    }

    const reference = generateRef();
    const origin = req.headers.origin || process.env.CLIENT_URL || 'http://localhost:5173';
    const callbackUrl = req.body.callbackUrl || `${origin}/payments?ref=${reference}`;

    const { data } = await axios.post(
      `${PAYSTACK_BASE}/transaction/initialize`,
      {
        email: req.user.email,
        amount: payment.amount * 100,
        reference,
        callback_url: callbackUrl,
        metadata: {
          paymentId: payment._id.toString(),
          scheduleTitle: payment.scheduleId?.title || '',
          residentName: req.user.name,
        },
      },
      { headers: paystackHeaders() }
    );

    payment.paystackReference = reference;
    await payment.save();

    return res.json({
      success: true,
      data: {
        authorizationUrl: data.data.authorization_url,
        reference,
        accessCode: data.data.access_code,
      },
    });
  } catch (err) {
    console.error('[Paystack init]', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Payment initialization failed' });
  }
};

// Shared settlement — flips a Payment to paid, credits the manager wallet,
// fires socket + email notifications. Idempotent: a second call for an
// already-paid payment is a no-op. Used by verifyPayment (resident callback),
// paystackWebhook (server-side event), and reconcilePayment (manager-triggered).
async function settlePaymentByReference(reference) {
  if (!reference) return { ok: false, reason: 'missing-reference' };

  const existing = await Payment.findOne({ paystackReference: reference });
  if (!existing) return { ok: false, reason: 'payment-not-found' };
  if (existing.status === 'paid') return { ok: true, alreadyPaid: true, payment: existing };

  const payment = await Payment.findOneAndUpdate(
    { paystackReference: reference, status: { $ne: 'paid' } },
    { status: 'paid', method: 'paystack', paidAt: new Date() },
    { new: true },
  ).populate('scheduleId', 'title frequency dueDate');

  if (!payment) {
    // Someone else just raced us — reload the paid version
    const now = await Payment.findOne({ paystackReference: reference });
    return { ok: true, alreadyPaid: true, payment: now };
  }

  await creditManagerWallet(payment.estateId, payment.amount);

  try {
    await payment.populate([
      { path: 'residentId', populate: { path: 'unitId', select: 'unitNumber block type' } },
      { path: 'recordedBy', select: 'name' },
    ]);
    const estate   = await Estate.findById(payment.estateId).select('name address estateCode logoUrl');
    const resident = payment.residentId;
    const unit     = resident?.unitId;
    const fmt      = (n) => `₦${Number(n).toLocaleString('en-NG')}`;

    const notif = {
      id: payment._id.toString(),
      type: 'payment_received',
      title: 'Payment Received',
      body: `${resident?.name || 'A resident'} paid ${fmt(payment.amount)} for ${payment.scheduleId?.title || 'levy'}`,
      amount: payment.amount,
      meta: { paymentId: payment._id },
    };

    emitNotification(payment.estateId, {
      ...notif,
      title: 'Payment Confirmed',
      body: `Your payment of ${fmt(payment.amount)} for ${payment.scheduleId?.title || 'levy'} was received`,
    }, resident?._id);

    const manager = await User.findOne({ estateId: payment.estateId, role: 'estate_manager' }).select('name email');
    emitNotification(payment.estateId, notif, manager?._id);

    if (manager && estate) {
      sendManagerNotificationEmail({
        to: manager.email,
        managerName: manager.name,
        estateName: estate.name,
        type: 'payment_received',
        title: notif.title,
        body: notif.body,
      }).catch(e => console.error('[manager email]', e.message));
    }

    if (resident?.email) {
      const dateStr = payment.createdAt.toISOString().slice(0, 10).replace(/-/g, '');
      const invoiceNumber = `INV-${dateStr}-${payment._id.toString().slice(-6).toUpperCase()}`;
      const inv = {
        invoiceNumber,
        date: payment.createdAt, dueDate: payment.scheduleId?.dueDate,
        status: 'paid', paidAt: payment.paidAt, method: 'paystack',
        notes: '', recordedBy: null,
        estate: { name: estate?.name || '', address: estate?.address || '', estateCode: estate?.estateCode || '', logoUrl: estate?.logoUrl || '' },
        resident: { name: resident.name, email: resident.email, phone: resident.phone || '', unit: unit ? `${unit.block ? unit.block + ' ' : ''}${unit.unitNumber}` : 'N/A' },
        items: [{ description: payment.scheduleId?.title || 'Payment', detail: '', frequency: payment.scheduleId?.frequency || '', quantity: 1, unitPrice: payment.amount, vat: 0, total: payment.amount }],
        subtotal: payment.amount, vatAmount: 0, total: payment.amount,
      };
      sendPaymentReceiptEmail({ to: resident.email, residentName: resident.name, estateName: estate?.name || '', inv })
        .catch(e => console.error('[receipt email]', e.message));
    }
  } catch (e) {
    console.error('[settlePaymentByReference notify]', e.message);
  }

  return { ok: true, payment };
}
// Expose so other controllers (plans webhook) can call it
exports.settlePaymentByReference = settlePaymentByReference;

exports.verifyPayment = async (req, res) => {
  try {
    const { reference } = req.params;

    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ success: false, message: 'Gateway not configured' });
    }

    const { data } = await axios.get(
      `${PAYSTACK_BASE}/transaction/verify/${reference}`,
      { headers: paystackHeaders() }
    );

    if (data.data.status !== 'success') {
      return res.status(400).json({ success: false, message: 'Payment not successful' });
    }

    const result = await settlePaymentByReference(reference);
    if (!result.ok) {
      return res.status(result.reason === 'payment-not-found' ? 404 : 500).json({
        success: false, message: result.reason === 'payment-not-found' ? 'Payment record not found' : 'Settlement failed',
      });
    }
    return res.json({ success: true, data: result.payment, alreadyPaid: !!result.alreadyPaid });
  } catch (err) {
    console.error('[Paystack verify]', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Verification failed' });
  }
};

// GET /api/payments/paystack/recent?status=success&limit=50
// Lists recent Paystack transactions directly from the gateway and marks
// which ones already have a matching Payment doc so the manager can see
// unmatched captures (the "paid but not reflecting" case).
exports.getPaystackLedger = async (req, res) => {
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
    const matches = await Payment.find({
      paystackReference: { $in: refs },
      estateId: req.estateId,
    })
      .populate('scheduleId', 'title')
      .populate('residentId', 'name email')
      .lean();
    const byRef = matches.reduce((m, p) => { m[p.paystackReference] = p; return m; }, {});

    const rows = transactions.map(t => ({
      reference:  t.reference,
      amount:     (t.amount || 0) / 100,
      currency:   t.currency,
      status:     t.status,
      channel:    t.channel,
      paidAt:     t.paid_at || t.paidAt || null,
      createdAt:  t.created_at || t.createdAt,
      customer: t.customer ? {
        email: t.customer.email,
        name:  [t.customer.first_name, t.customer.last_name].filter(Boolean).join(' ') || null,
      } : null,
      metadata:   t.metadata || {},
      matched:    !!byRef[t.reference],
      payment:    byRef[t.reference] || null,
    }));

    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[getPaystackLedger]', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to load Paystack transactions' });
  }
};

// POST /api/payments/paystack/attach
// body: { reference, residentId, scheduleId, notes? }
// Pulls the transaction from Paystack, creates a Payment for the given
// resident + schedule, flips it to paid via the shared settle helper.
// Use case: Paystack has a capture but we have no matching Payment doc
// (resident paid via a one-off link, or the initialize flow lost the row).
exports.attachPaystackTransaction = async (req, res) => {
  try {
    const { reference, residentId, scheduleId, notes } = req.body || {};
    if (!reference || !residentId || !scheduleId) {
      return res.status(400).json({ success: false, message: 'reference, residentId, scheduleId are required' });
    }
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ success: false, message: 'Payment gateway not configured' });
    }

    const existing = await Payment.findOne({ paystackReference: reference, estateId: req.estateId });
    if (existing && existing.status === 'paid') {
      return res.json({ success: true, data: existing, alreadyPaid: true });
    }

    const { data } = await axios.get(
      `${PAYSTACK_BASE}/transaction/verify/${reference}`,
      { headers: paystackHeaders() },
    );
    if (data?.data?.status !== 'success') {
      return res.status(400).json({ success: false, message: `Paystack status: ${data?.data?.status || 'unknown'}` });
    }
    const amountNaira = (data.data.amount || 0) / 100;

    const schedule = await PaymentSchedule.findOne({ _id: scheduleId, estateId: req.estateId });
    if (!schedule) return res.status(404).json({ success: false, message: 'Schedule not found for this estate' });

    const resident = await User.findOne({ _id: residentId, estateId: req.estateId, role: 'resident' });
    if (!resident) return res.status(404).json({ success: false, message: 'Resident not found for this estate' });

    if (existing) {
      existing.paystackReference = reference;
      existing.residentId = resident._id;
      existing.scheduleId = schedule._id;
      existing.amount     = existing.amount || amountNaira;
      if (notes) existing.notes = notes;
      await existing.save();
    } else {
      await Payment.create({
        scheduleId: schedule._id,
        residentId: resident._id,
        estateId:   req.estateId,
        amount:     amountNaira,
        status:     'pending',
        paystackReference: reference,
        notes:      notes || `Attached from Paystack transaction ${reference}`,
        recordedBy: req.user._id,
      });
    }

    const result = await settlePaymentByReference(reference);
    if (!result.ok) {
      return res.status(500).json({ success: false, message: 'Settle failed after attach' });
    }
    return res.json({ success: true, data: result.payment, attached: true });
  } catch (err) {
    console.error('[attachPaystackTransaction]', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Attach failed' });
  }
};

// POST /api/payments/reconcile/:reference  (estate_manager, super_admin)
// Force-sync a stuck pending payment against Paystack. Settles if Paystack
// confirms success, otherwise returns the gateway status so the manager can
// decide. Fire-and-forget safe: idempotent.
exports.reconcilePayment = async (req, res) => {
  try {
    const { reference } = req.params;
    if (!reference) return res.status(400).json({ success: false, message: 'Reference required' });
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ success: false, message: 'Payment gateway not configured' });
    }

    const payment = await Payment.findOne({ paystackReference: reference, estateId: req.estateId });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found for this estate' });
    if (payment.status === 'paid') {
      return res.json({ success: true, data: payment, alreadyPaid: true, message: 'Already paid' });
    }

    const { data } = await axios.get(
      `${PAYSTACK_BASE}/transaction/verify/${reference}`,
      { headers: paystackHeaders() },
    );
    if (data?.data?.status !== 'success') {
      return res.status(400).json({
        success: false,
        message: `Paystack status: ${data?.data?.status || 'unknown'}`,
        gateway: data?.data?.gateway_response || data?.message || null,
      });
    }
    const result = await settlePaymentByReference(reference);
    return res.json({ success: true, data: result.payment, reconciled: true });
  } catch (err) {
    console.error('[reconcilePayment]', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Reconcile failed' });
  }
};

exports.deleteSchedule = async (req, res) => {
  try {
    const { scheduleId } = req.params;
    await PaymentSchedule.findOneAndUpdate(
      { _id: scheduleId, estateId: req.estateId },
      { isActive: false }
    );
    return res.json({ success: true, message: 'Schedule deactivated' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Wallet (estate manager) ────────────────────────────────────────────────

exports.getWallet = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      'paystackRecipientCode bankCode bankName accountNumber accountName'
    );

    // Pull the real outcome of any in-flight transfers before computing
    await exports.syncPendingWithdrawals({ estateId: req.estateId }, 10);

    // Dynamic balance: dues paid online for this estate minus the estate's
    // withdrawals (by estate, not by user, so a new manager inherits the history).
    // Offline (cash / transfer) payments are reported separately, never withdrawable.
    const [paymentsAgg, withdrawalsAgg, withdrawals, offlineAgg] = await Promise.all([
      Payment.aggregate([
        { $match: { estateId: req.estateId, ...ONLINE_PAID } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Withdrawal.aggregate([
        { $match: { estateId: req.estateId, source: { $ne: 'marketplace' }, status: { $in: ['pending', 'success'] } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Withdrawal.find({ estateId: req.estateId, source: { $ne: 'marketplace' } }).sort({ createdAt: -1 }).limit(20),
      Payment.aggregate([
        { $match: { estateId: req.estateId, status: 'paid', method: { $ne: 'paystack' } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    const collected = paymentsAgg[0]?.total || 0;
    const collectedOffline = offlineAgg[0]?.total || 0;
    const withdrawn = withdrawalsAgg[0]?.total || 0;
    const balance = Math.max(0, collected - withdrawn);

    return res.json({
      success: true,
      data: {
        balance,
        collected,
        collectedOffline,
        withdrawn,
        bank: {
          code: user.bankCode,
          name: user.bankName,
          accountNumber: user.accountNumber,
          accountName: user.accountName,
          recipientCode: user.paystackRecipientCode,
        },
        withdrawals,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getBanks = async (req, res) => {
  try {
    const { data } = await axios.get(
      `${PAYSTACK_BASE}/bank?currency=NGN&perPage=200&use_cursor=false`,
      { headers: paystackHeaders() }
    );
    let banks = data.data || [];

    // Ensure Paystack test bank is always present when using a test secret key
    const isTestMode = process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_');
    if (isTestMode) {
      const hasTestBank = banks.some(b => b.code === '001');
      if (!hasTestBank) {
        banks = [{ name: 'Test Bank', code: '001', slug: 'test-bank' }, ...banks];
      }
    }

    return res.json({ success: true, data: banks });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch banks' });
  }
};

exports.resolveAccount = async (req, res) => {
  try {
    const { bankCode, accountNumber } = req.body;

    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ success: false, message: 'Payment gateway not configured' });
    }

    // Paystack test bank (001) does not support /bank/resolve — return mock data
    const isTestMode = process.env.PAYSTACK_SECRET_KEY.startsWith('sk_test_');
    if (isTestMode && bankCode === '001') {
      return res.json({
        success: true,
        data: { accountName: 'Test Account', accountNumber, bankCode },
      });
    }

    const { data: resolveData } = await axios.get(
      `${PAYSTACK_BASE}/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
      { headers: paystackHeaders() }
    );

    return res.json({
      success: true,
      data: { accountName: resolveData.data.account_name, accountNumber, bankCode },
    });
  } catch (err) {
    console.error('[Resolve account]', err.response?.data || err.message);
    const msg = err.response?.data?.message || 'Could not resolve account. Check the account number and bank, then try again.';
    return res.status(422).json({ success: false, message: msg });
  }
};

exports.saveBankAccount = async (req, res) => {
  try {
    const { bankCode, accountNumber } = req.body;

    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ success: false, message: 'Payment gateway not configured' });
    }

    const isTestMode = process.env.PAYSTACK_SECRET_KEY.startsWith('sk_test_');

    // Test bank (001) — skip live API calls, store mock data directly
    if (isTestMode && bankCode === '001') {
      await User.findByIdAndUpdate(req.user._id, {
        bankCode,
        accountNumber,
        accountName: 'Test Account',
        bankName: 'Test Bank',
        paystackRecipientCode: 'RCP_test_mock',
      });
      return res.json({
        success: true,
        data: { accountName: 'Test Account', bankName: 'Test Bank', accountNumber },
      });
    }

    // Resolve account name
    const { data: resolveData } = await axios.get(
      `${PAYSTACK_BASE}/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
      { headers: paystackHeaders() }
    );
    const accountName = resolveData.data.account_name;

    // Fetch bank name from banks list
    const { data: banksData } = await axios.get(
      `${PAYSTACK_BASE}/bank?currency=NGN&perPage=200`,
      { headers: paystackHeaders() }
    );
    const bank = banksData.data.find((b) => b.code === bankCode);

    // Create Paystack transfer recipient
    const { data: recipientData } = await axios.post(
      `${PAYSTACK_BASE}/transferrecipient`,
      {
        type: 'nuban',
        name: req.user.name,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: 'NGN',
      },
      { headers: paystackHeaders() }
    );

    await User.findByIdAndUpdate(req.user._id, {
      bankCode,
      accountNumber,
      accountName,
      bankName: bank?.name || bankCode,
      paystackRecipientCode: recipientData.data.recipient_code,
    });

    return res.json({
      success: true,
      data: { accountName, bankName: bank?.name || bankCode, accountNumber },
    });
  } catch (err) {
    console.error('[Bank save]', err.response?.data || err.message);
    const msg = err.response?.data?.message || 'Failed to save bank account';
    return res.status(500).json({ success: false, message: msg });
  }
};

// Managers withdraw directly — fires a Paystack /transfer to their saved
// recipient with no admin involvement. The Withdrawal is created as 'pending'
// BEFORE the transfer so the balance is reserved (no double-spend from rapid
// repeat taps); the transfer.success/failed/reversed webhook finalises it.
// Requires OTP to be disabled for transfers on the Paystack account.
exports.withdrawFromWallet = async (req, res) => {
  let withdrawal = null;
  try {
    const amount = Number(req.body.amount);

    if (!amount || amount < 100) {
      return res.status(400).json({ success: false, message: 'Minimum withdrawal is ₦100' });
    }

    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ success: false, message: 'Payment gateway not configured' });
    }

    const user = await User.findById(req.user._id).select(
      'paystackRecipientCode bankName accountNumber accountName email name'
    );

    if (!user.paystackRecipientCode) {
      return res.status(400).json({ success: false, message: 'No bank account saved. Add your bank account first.' });
    }

    const liveBalance = async () => {
      const [paymentsAgg, withdrawalsAgg] = await Promise.all([
        Payment.aggregate([
          { $match: { estateId: req.estateId, ...ONLINE_PAID } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        Withdrawal.aggregate([
          { $match: { estateId: req.estateId, source: { $ne: 'marketplace' }, status: { $in: ['pending', 'success'] } } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
      ]);
      return (paymentsAgg[0]?.total || 0) - (withdrawalsAgg[0]?.total || 0);
    };

    if ((await liveBalance()) < amount) {
      return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
    }

    const estate = await Estate.findById(req.estateId).select('name estateCode');
    const reference = generateRef();

    withdrawal = await Withdrawal.create({
      userId: req.user._id,
      estateId: req.estateId,
      amount,
      status: 'pending',
      paystackTransferCode: null,
      reference,
      bankName: user.bankName,
      accountNumber: user.accountNumber,
      accountName: user.accountName,
    });
    require('../services/socketService').emitPlatform('withdrawal', req.estateId, { amount, name: user.name, bankName: user.bankName });

    // Re-check after reserving — if two requests raced past the first check,
    // the later one sees a negative balance and backs out.
    if ((await liveBalance()) < 0) {
      withdrawal.status = 'failed';
      withdrawal.failureReason = 'Insufficient wallet balance';
      await withdrawal.save();
      return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
    }

    const isTestMode = process.env.PAYSTACK_SECRET_KEY.startsWith('sk_test_');
    if (isTestMode && user.paystackRecipientCode === 'RCP_test_mock') {
      withdrawal.status = 'success';
      withdrawal.paystackTransferCode = 'TRF_test_mock';
    } else {
      try {
        const { data } = await axios.post(
          `${PAYSTACK_BASE}/transfer`,
          {
            source: 'balance',
            amount: Math.round(amount * 100),
            recipient: user.paystackRecipientCode,
            reason: `Estate manager withdrawal — ${reference}`,
            reference,
          },
          { headers: paystackHeaders() }
        );
        withdrawal.status = data.data?.status === 'success' ? 'success' : 'pending';
        withdrawal.paystackStatus = data.data?.status || '';
        withdrawal.paystackTransferCode = data.data?.transfer_code || null;
      } catch (err) {
        const msg = err.response?.data?.message || 'Transfer failed';
        console.error('[Withdraw transfer]', err.response?.data || err.message);
        withdrawal.status = 'failed';
        withdrawal.failureReason = msg;
        await withdrawal.save();
        return res.status(502).json({ success: false, message: `Withdrawal failed: ${msg}` });
      }
    }
    await withdrawal.save();

    sendWithdrawalReceiptEmail({
      to: user.email,
      managerName: user.name,
      estateName: estate?.name || 'Your Estate',
      estateCode: estate?.estateCode || '',
      amount,
      bankName: user.bankName,
      accountNumber: user.accountNumber,
      accountName: user.accountName,
      reference,
      transferCode: withdrawal.paystackTransferCode,
      status: withdrawal.status,
      createdAt: withdrawal.createdAt,
    }).catch(e => console.error('[WithdrawalEmail]', e.message));

    return res.json({
      success: true,
      data: {
        message: withdrawal.status === 'success'
          ? 'Withdrawal successful — funds are on their way to your bank.'
          : withdrawal.paystackStatus === 'otp'
            ? 'Withdrawal submitted — awaiting payout authorisation. You\'ll get an email once it\'s sent.'
            : 'Withdrawal initiated — funds will arrive in your bank shortly.',
        withdrawalId: withdrawal._id,
        reference,
        transferCode: withdrawal.paystackTransferCode,
        status: withdrawal.status,
      },
    });
  } catch (err) {
    console.error('[Withdraw]', err.message);
    // Release the reserved balance if we failed before the transfer resolved
    if (withdrawal && withdrawal.status === 'pending' && !withdrawal.paystackTransferCode) {
      withdrawal.status = 'failed';
      withdrawal.failureReason = 'Withdrawal could not be completed';
      await withdrawal.save().catch(() => {});
    }
    return res.status(500).json({ success: false, message: 'Withdrawal failed. Please try again.' });
  }
};

// Called by the Paystack webhook on transfer.success / transfer.failed /
// transfer.reversed. Idempotent — only moves a withdrawal out of 'pending'
// (or 'success' → 'failed' on reversal). Failed/reversed withdrawals drop out
// of the balance query, so the manager's funds come back automatically.
exports.settleWithdrawalByReference = async (reference, event, reason) => {
  const w = await Withdrawal.findOne({ reference });
  if (!w) return null;

  const nextStatus = event === 'transfer.success' ? 'success' : 'failed';
  if (w.status === nextStatus) return w;
  if (w.status === 'failed') return w;
  if (w.status === 'success' && event !== 'transfer.reversed') return w;

  w.status = nextStatus;
  w.paystackStatus = event.replace('transfer.', '');
  if (nextStatus === 'failed') {
    w.failureReason = reason || (event === 'transfer.reversed' ? 'Transfer reversed' : 'Transfer failed');
  }
  await w.save();

  const [user, estate] = await Promise.all([
    User.findById(w.userId).select('email name'),
    Estate.findById(w.estateId).select('name estateCode'),
  ]);
  if (user?.email) {
    sendWithdrawalReceiptEmail({
      to: user.email,
      managerName: user.name,
      estateName: estate?.name || 'Your Estate',
      estateCode: estate?.estateCode || '',
      amount: w.amount,
      bankName: w.bankName,
      accountNumber: w.accountNumber,
      accountName: w.accountName,
      reference: w.reference,
      transferCode: w.paystackTransferCode,
      status: w.status,
      createdAt: w.updatedAt,
    }).catch(e => console.error('[WithdrawalEmail]', e.message));
  }
  return w;
};

// Ask Paystack for the real state of a withdrawal's transfer and settle it.
// Safety net for when the transfer.* webhook never arrives (webhook URL not
// set, transfer approved from the Paystack dashboard, etc.).
const PAYSTACK_FAILED = ['failed', 'reversed', 'abandoned', 'rejected', 'blocked'];
const syncWithdrawalWithPaystack = async (w) => {
  if (!process.env.PAYSTACK_SECRET_KEY || w.status !== 'pending') return w;
  const { data } = await axios.get(
    `${PAYSTACK_BASE}/transfer/verify/${encodeURIComponent(w.reference)}`,
    { headers: paystackHeaders(), timeout: 8000 }
  );
  const t = data.data || {};
  if (t.status === 'success') {
    return exports.settleWithdrawalByReference(w.reference, 'transfer.success');
  }
  if (PAYSTACK_FAILED.includes(t.status)) {
    return exports.settleWithdrawalByReference(
      w.reference, t.status === 'reversed' ? 'transfer.reversed' : 'transfer.failed',
      `Paystack status: ${t.status}`
    );
  }
  if (t.status && t.status !== w.paystackStatus) {
    w.paystackStatus = t.status;
    if (!w.paystackTransferCode && t.transfer_code) w.paystackTransferCode = t.transfer_code;
    await w.save();
  }
  return w;
};
exports.syncWithdrawalWithPaystack = syncWithdrawalWithPaystack;

// Sync every pending withdrawal (matching `filter`) that has a live Paystack
// transfer. Errors per-withdrawal are logged and skipped.
exports.syncPendingWithdrawals = async (filter = {}, limit = 25) => {
  if (!process.env.PAYSTACK_SECRET_KEY) return;
  const pending = await Withdrawal.find({
    ...filter,
    status: 'pending',
    paystackTransferCode: { $nin: [null, 'TRF_test_mock'], $not: /^MANUAL-/ },
  }).sort({ createdAt: -1 }).limit(limit);
  await Promise.all(pending.map(w =>
    syncWithdrawalWithPaystack(w).catch(e =>
      console.error('[Withdrawal sync]', w.reference, e.response?.data?.message || e.message))
  ));
};
