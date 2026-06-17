const axios = require('axios');
const PaymentSchedule = require('../models/PaymentSchedule');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Estate = require('../models/Estate');
const Withdrawal = require('../models/Withdrawal');
const { emitNotification } = require('../services/socketService');
const { sendManagerNotificationEmail } = require('../services/emailService');

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

    await payment.populate('residentId', 'name email');

    try {
      const fmt = (n) => `₦${Number(n).toLocaleString('en-NG')}`;
      emitNotification(req.estateId, {
        id: payment._id.toString(),
        type: 'payment_received',
        title: 'Manual Payment Recorded',
        body: `${payment.residentId?.name || 'Resident'} — ${fmt(payment.amount)} recorded manually`,
        amount: payment.amount,
        meta: { paymentId: payment._id },
      });
    } catch (e) { console.error('[notify recordManualPayment]', e.message); }

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
      await payment.populate('residentId', 'name email');
      const fmt = (n) => `₦${Number(n).toLocaleString('en-NG')}`;
      const residentName = payment.residentId?.name || 'A resident';
      const scheduleTitle = payment.scheduleId?.title || 'levy';

      const notif = {
        id: payment._id.toString(),
        type: 'payment_received',
        title: 'Payment Received',
        body: `${residentName} paid ${fmt(payment.amount)} for ${scheduleTitle}`,
        amount: payment.amount,
        meta: { paymentId: payment._id },
      };

      emitNotification(req.estateId, notif);

      const [manager, estate] = await Promise.all([
        User.findOne({ estateId: req.estateId, role: 'estate_manager' }).select('name email'),
        Estate.findById(req.estateId).select('name'),
      ]);
      if (manager && estate) {
        await sendManagerNotificationEmail({
          to: manager.email,
          managerName: manager.name,
          estateName: estate.name,
          type: 'payment_received',
          title: notif.title,
          body: notif.body,
        });
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
      'paystackRecipientCode bankName accountNumber accountName'
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

    // Mock withdrawal for test bank account
    if (isTestMode && user.paystackRecipientCode === 'RCP_test_mock') {
      await Withdrawal.create({
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

    await Withdrawal.create({
      userId: req.user._id,
      estateId: req.estateId,
      amount,
      status: data.data.status === 'success' ? 'success' : 'pending',
      paystackTransferCode: data.data.transfer_code,
      reference,
      bankName: user.bankName,
      accountNumber: user.accountNumber,
      accountName: user.accountName,
    });

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
