const axios = require('axios');
const PaymentSchedule = require('../models/PaymentSchedule');
const Payment = require('../models/Payment');
const User = require('../models/User');

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

    // Auto-generate pending Payment records for every active resident
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

    // Attach collection summary to each
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

    await payment.populate('residentId', 'name email');
    return res.json({ success: true, data: payment });
  } catch (err) {
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

    // This month
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

// ── Paystack ───────────────────────────────────────────────────────────────

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
    const callbackUrl = `${origin}/payments?ref=${reference}`;

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

    const payment = await Payment.findOneAndUpdate(
      { paystackReference: reference, estateId: req.estateId },
      { status: 'paid', method: 'paystack', paidAt: new Date() },
      { new: true }
    ).populate('scheduleId', 'title');

    if (!payment) return res.status(404).json({ success: false, message: 'Payment record not found' });

    return res.json({ success: true, data: payment });
  } catch (err) {
    console.error('[Paystack verify]', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Verification failed' });
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
