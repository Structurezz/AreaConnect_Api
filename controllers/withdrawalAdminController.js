const axios = require('axios');
const Withdrawal = require('../models/Withdrawal');
const User = require('../models/User');
const Estate = require('../models/Estate');
const {
  sendWithdrawalReceiptEmail,
  sendWithdrawalRejectedEmail,
} = require('../services/emailService');

const PAYSTACK_BASE = 'https://api.paystack.co';
const paystackHeaders = () => ({
  Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
  'Content-Type': 'application/json',
});

// Super admin — list every withdrawal request across the platform, newest first.
exports.listWithdrawals = async (req, res) => {
  try {
    const { status, limit = 100 } = req.query;
    const q = {};
    if (status && ['pending', 'success', 'failed'].includes(status)) q.status = status;

    const [withdrawals, counts] = await Promise.all([
      Withdrawal.find(q)
        .populate('userId', 'name email phone')
        .populate('estateId', 'name estateCode')
        .sort({ createdAt: -1 })
        .limit(Math.min(Number(limit) || 100, 500))
        .lean(),
      Withdrawal.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$amount' } } },
      ]),
    ]);

    const totals = { pending: { count: 0, total: 0 }, success: { count: 0, total: 0 }, failed: { count: 0, total: 0 } };
    counts.forEach(c => { totals[c._id] = { count: c.count, total: c.total }; });

    return res.json({ success: true, data: { withdrawals, totals } });
  } catch (err) {
    console.error('[Admin withdrawals list]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Admin confirms they paid out manually (e.g. via the Paystack dashboard).
// Status flips to success; nothing hits the Paystack transfer API.
exports.markWithdrawalPaid = async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body || {};

    const w = await Withdrawal.findById(id);
    if (!w) return res.status(404).json({ success: false, message: 'Withdrawal not found' });
    if (w.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Already ${w.status}` });
    }

    w.status = 'success';
    w.paystackTransferCode = w.paystackTransferCode || `MANUAL-${Date.now()}`;
    if (note) w.failureReason = `Manual payout: ${note}`;
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
        status: 'success',
        createdAt: w.updatedAt,
      }).catch(e => console.error('[WithdrawalEmail]', e.message));
    }

    return res.json({ success: true, data: w });
  } catch (err) {
    console.error('[Admin mark paid]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Admin opts to fire the Paystack transfer themselves rather than paying out
// via the dashboard. Still only triggered by admin — managers never cause this.
exports.processWithdrawalViaPaystack = async (req, res) => {
  try {
    const { id } = req.params;

    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ success: false, message: 'Payment gateway not configured' });
    }

    const w = await Withdrawal.findById(id);
    if (!w) return res.status(404).json({ success: false, message: 'Withdrawal not found' });
    if (w.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Already ${w.status}` });
    }

    const user = await User.findById(w.userId).select('paystackRecipientCode email name');
    if (!user?.paystackRecipientCode) {
      return res.status(400).json({ success: false, message: 'Manager has no Paystack transfer recipient saved' });
    }

    const { data } = await axios.post(
      `${PAYSTACK_BASE}/transfer`,
      {
        source: 'balance',
        amount: w.amount * 100,
        recipient: user.paystackRecipientCode,
        reason: `Estate manager withdrawal — ${w.reference}`,
        reference: w.reference,
      },
      { headers: paystackHeaders() }
    );

    const paystackStatus = data.data?.status;
    // Paystack returns 'success' only for OTP-less transfers; most return 'pending'
    // and finalise via the transfer.success webhook. We mark success optimistically
    // when Paystack confirms it, else leave as 'pending' with the transfer code saved.
    w.status = paystackStatus === 'success' ? 'success' : 'pending';
    w.paystackTransferCode = data.data?.transfer_code || w.paystackTransferCode;
    await w.save();

    const estate = await Estate.findById(w.estateId).select('name estateCode');
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

    return res.json({ success: true, data: w });
  } catch (err) {
    const msg = err.response?.data?.message || 'Paystack transfer failed';
    console.error('[Admin process paystack]', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: msg });
  }
};

// Admin rejects — flips to failed with a reason. Because failed withdrawals
// aren't counted in the live-balance query, the manager's wallet balance
// bounces back automatically on their next load.
exports.rejectWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    const w = await Withdrawal.findById(id);
    if (!w) return res.status(404).json({ success: false, message: 'Withdrawal not found' });
    if (w.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Already ${w.status}` });
    }

    w.status = 'failed';
    w.failureReason = reason || 'Rejected by admin';
    await w.save();

    const [user, estate] = await Promise.all([
      User.findById(w.userId).select('email name'),
      Estate.findById(w.estateId).select('name'),
    ]);
    if (user?.email && typeof sendWithdrawalRejectedEmail === 'function') {
      sendWithdrawalRejectedEmail({
        to: user.email,
        managerName: user.name,
        estateName: estate?.name || 'Your Estate',
        amount: w.amount,
        reference: w.reference,
        reason: w.failureReason,
      }).catch(e => console.error('[WithdrawalRejectEmail]', e.message));
    }

    return res.json({ success: true, data: w });
  } catch (err) {
    console.error('[Admin reject]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
