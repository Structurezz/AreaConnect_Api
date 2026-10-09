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

    await creditManagerWallet(req.estateId, payment.amount);

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
    const payment = await Payment.findOne({ _id: req.params.paymentId, estateId: req.estateId })
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

    await creditManagerWallet(req.estateId, payment.amount);

    try {
      await payment.populate([
        { path: 'residentId', populate: { path: 'unitId', select: 'unitNumber block type' } },
        { path: 'recordedBy', select: 'name' },
      ]);
      const estate   = await Estate.findById(req.estateId).select('name address estateCode logoUrl');
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

      // Notify the resident that their payment was confirmed
      emitNotification(req.estateId, {
        ...notif,
        title: 'Payment Confirmed',
        body: `Your payment of ${fmt(payment.amount)} for ${payment.scheduleId?.title || 'levy'} was received`,
      }, resident?._id);

      const manager = await User.findOne({ estateId: req.estateId, role: 'estate_manager' }).select('name email');

      // Notify only the manager about the incoming payment
      emitNotification(req.estateId, notif, manager?._id);

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

      // Send receipt to resident
      if (resident?.email) {
        const dateStr = payment.createdAt.toISOString().slice(0, 10).replace(/-/g, '');
        const invoiceNumber = `INV-${dateStr}-${payment._id.toString().slice(-6).toUpperCase()}`;
        const inv = {
          invoiceNumber,
          date: payment.createdAt,
          dueDate: payment.scheduleId?.dueDate,
          status: 'paid', paidAt: payment.paidAt, method: 'paystack',
          notes: '',  recordedBy: null,
          estate: { name: estate?.name || '', address: estate?.address || '', estateCode: estate?.estateCode || '', logoUrl: estate?.logoUrl || '' },
          resident: { name: resident.name, email: resident.email, phone: resident.phone || '', unit: unit ? `${unit.block ? unit.block + ' ' : ''}${unit.unitNumber}` : 'N/A' },
          items: [{ description: payment.scheduleId?.title || 'Payment', detail: '', frequency: payment.scheduleId?.frequency || '', quantity: 1, unitPrice: payment.amount, vat: 0, total: payment.amount }],
          subtotal: payment.amount, vatAmount: 0, total: payment.amount,
        };
        sendPaymentReceiptEmail({ to: resident.email, residentName: resident.name, estateName: estate?.name || '', inv })
          .catch(e => console.error('[receipt email]', e.message));
      }
    } catch (e) { console.error('[notify verifyPayment]', e.message); }

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

// ── Wallet (estate manager) ────────────────────────────────────────────────

exports.getWallet = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      'paystackRecipientCode bankCode bankName accountNumber accountName'
    );

    // Dynamic balance: all paid payments for this estate minus all withdrawals
    const [paymentsAgg, withdrawalsAgg, withdrawals] = await Promise.all([
      Payment.aggregate([
        { $match: { estateId: req.estateId, status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Withdrawal.aggregate([
        { $match: { userId: req.user._id, status: { $in: ['pending', 'success'] } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Withdrawal.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(20),
    ]);

    const collected = paymentsAgg[0]?.total || 0;
    const withdrawn = withdrawalsAgg[0]?.total || 0;
    const balance = Math.max(0, collected - withdrawn);

    return res.json({
      success: true,
      data: {
        balance,
        collected,
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

exports.withdrawFromWallet = async (req, res) => {
  try {
    const { amount } = req.body;

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

    // Compute live balance
    const [paymentsAgg, withdrawalsAgg] = await Promise.all([
      Payment.aggregate([
        { $match: { estateId: req.estateId, status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Withdrawal.aggregate([
        { $match: { userId: req.user._id, status: { $in: ['pending', 'success'] } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);
    const liveBalance = Math.max(0, (paymentsAgg[0]?.total || 0) - (withdrawalsAgg[0]?.total || 0));

    if (liveBalance < amount) {
      return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
    }

    const reference = generateRef();
    const isTestMode = process.env.PAYSTACK_SECRET_KEY.startsWith('sk_test_');

    const estate = await Estate.findById(req.estateId).select('name estateCode');

    // Mock withdrawal for test bank account
    if (isTestMode && user.paystackRecipientCode === 'RCP_test_mock') {
      const withdrawal = await Withdrawal.create({
        userId: req.user._id,
        estateId: req.estateId,
        amount,
        status: 'success',
        paystackTransferCode: 'TRF_test_mock',
        reference,
        bankName: user.bankName,
        accountNumber: user.accountNumber,
        accountName: user.accountName,
      });

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
        transferCode: 'TRF_test_mock',
        status: 'success',
        createdAt: withdrawal.createdAt,
      }).catch(e => console.error('[WithdrawalEmail]', e.message));

      return res.json({
        success: true,
        data: { message: 'Withdrawal initiated successfully (test mode)', transferCode: 'TRF_test_mock' },
      });
    }

    const { data } = await axios.post(
      `${PAYSTACK_BASE}/transfer`,
      {
        source: 'balance',
        amount: amount * 100,
        recipient: user.paystackRecipientCode,
        reason: `Estate manager withdrawal`,
        reference,
      },
      { headers: paystackHeaders() }
    );

    const withdrawalStatus = data.data.status === 'success' ? 'success' : 'pending';
    const withdrawal = await Withdrawal.create({
      userId: req.user._id,
      estateId: req.estateId,
      amount,
      status: withdrawalStatus,
      paystackTransferCode: data.data.transfer_code,
      reference,
      bankName: user.bankName,
      accountNumber: user.accountNumber,
      accountName: user.accountName,
    });

    sendWithdrawalReceiptEmail({
      to: user.email,
      managerName: user.name,
      estateName: estate?.name || 'Your Estate',
      amount,
      bankName: user.bankName,
      accountNumber: user.accountNumber,
      accountName: user.accountName,
      reference,
      transferCode: data.data.transfer_code,
      status: withdrawalStatus,
      createdAt: withdrawal.createdAt,
    }).catch(e => console.error('[WithdrawalEmail]', e.message));

    return res.json({
      success: true,
      data: { message: 'Withdrawal initiated successfully', transferCode: data.data.transfer_code },
    });
  } catch (err) {
    console.error('[Withdraw]', err.response?.data || err.message);
    const msg = err.response?.data?.message || 'Withdrawal failed. Please try again.';
    return res.status(500).json({ success: false, message: msg });
  }
};
