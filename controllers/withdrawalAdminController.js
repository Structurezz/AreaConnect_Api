const axios = require('axios');
const Withdrawal = require('../models/Withdrawal');
const Payment = require('../models/Payment');
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

    // Reconcile in-flight transfers with Paystack so the list matches reality
    await require('./paymentController').syncPendingWithdrawals({}, 50);

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

// Super admin — live Paystack balance vs what's owed to managers, so admin
// knows how much can safely be moved out to the AreaConnect bank account.
//   walletBalances: sum of every estate's withdrawable wallet (online-paid levies
//                   minus pending/success withdrawals, floored at 0 per estate)
//   queued:         pending withdrawals with no Paystack transfer yet — still
//                   to leave the balance (in-flight transfers already have)
exports.getBalance = async (req, res) => {
  try {
    const [paidByEstate, withdrawnByEstate, queuedAgg] = await Promise.all([
      // Only online (Paystack) dues sit in our balance — offline payments never did
      Payment.aggregate([
        { $match: { status: 'paid', method: 'paystack' } },
        { $group: { _id: '$estateId', total: { $sum: '$amount' } } },
      ]),
      Withdrawal.aggregate([
        { $match: { source: { $ne: 'marketplace' }, status: { $in: ['pending', 'success'] } } },
        { $group: { _id: '$estateId', total: { $sum: '$amount' } } },
      ]),
      Withdrawal.aggregate([
        { $match: { status: 'pending', paystackTransferCode: null } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
    ]);

    const withdrawn = Object.fromEntries(withdrawnByEstate.map(w => [String(w._id), w.total]));
    const walletBalances = paidByEstate.reduce(
      (sum, p) => sum + Math.max(0, p.total - (withdrawn[String(p._id)] || 0)), 0
    );
    const queued = { total: queuedAgg[0]?.total || 0, count: queuedAgg[0]?.count || 0 };
    // Marketplace money we hold for sellers: escrow + released-but-not-withdrawn.
    const sellers = await require('../services/marketplaceAdmin').sellerLiability();
    const owed = walletBalances + queued.total + sellers.total;

    let paystack = null;
    let paystackError = null;
    if (!process.env.PAYSTACK_SECRET_KEY) {
      paystackError = 'Payment gateway not configured';
    } else {
      try {
        const { data } = await axios.get(`${PAYSTACK_BASE}/balance`, { headers: paystackHeaders() });
        const ngn = (data.data || []).find(b => b.currency === 'NGN') || data.data?.[0];
        paystack = ngn ? { balance: ngn.balance / 100, currency: ngn.currency } : null;
      } catch (err) {
        paystackError = err.response?.data?.message || 'Could not reach Paystack';
        console.error('[Admin paystack balance]', err.response?.data || err.message);
      }
    }

    return res.json({
      success: true,
      data: {
        paystack,
        paystackError,
        walletBalances,
        sellerWallets: sellers,
        queued,
        owed,
        surplus: paystack ? paystack.balance - owed : null,
        testMode: !!process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_'),
      },
    });
  } catch (err) {
    console.error('[Admin withdrawals balance]', err.message);
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
    w.paystackStatus = paystackStatus || '';
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

// ── Transfer OTP ───────────────────────────────────────────────────────────
// With OTP enabled on the Paystack account, /transfer returns status 'otp'
// and Paystack sends a code to the BUSINESS phone/email (not the manager).
// The admin enters it here to push the parked transfer through.

const isRealTransferCode = (code) => code && !code.startsWith('MANUAL-') && code !== 'TRF_test_mock';

// POST /:id/finalize-otp { otp }
exports.finalizeWithdrawalOtp = async (req, res) => {
  try {
    const otp = String(req.body?.otp || '').trim();
    if (!otp) return res.status(400).json({ success: false, message: 'OTP is required' });

    const w = await Withdrawal.findById(req.params.id);
    if (!w) return res.status(404).json({ success: false, message: 'Withdrawal not found' });
    if (w.status !== 'pending') return res.status(400).json({ success: false, message: `Already ${w.status}` });
    if (!isRealTransferCode(w.paystackTransferCode)) {
      return res.status(400).json({ success: false, message: 'No Paystack transfer to finalise for this withdrawal' });
    }

    const { data } = await axios.post(
      `${PAYSTACK_BASE}/transfer/finalize_transfer`,
      { transfer_code: w.paystackTransferCode, otp },
      { headers: paystackHeaders() }
    );

    const paystackStatus = data.data?.status || '';
    w.paystackStatus = paystackStatus;
    if (paystackStatus === 'success') w.status = 'success';
    await w.save();

    if (w.status === 'success') {
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
    }

    return res.json({ success: true, data: w });
  } catch (err) {
    const msg = err.response?.data?.message || 'Could not finalise transfer';
    console.error('[Admin finalize otp]', err.response?.data || err.message);
    return res.status(400).json({ success: false, message: msg });
  }
};

// POST /:id/resend-otp — Paystack re-sends the OTP to the business phone
exports.resendWithdrawalOtp = async (req, res) => {
  try {
    const w = await Withdrawal.findById(req.params.id);
    if (!w) return res.status(404).json({ success: false, message: 'Withdrawal not found' });
    if (!isRealTransferCode(w.paystackTransferCode)) {
      return res.status(400).json({ success: false, message: 'No Paystack transfer for this withdrawal' });
    }
    await axios.post(
      `${PAYSTACK_BASE}/transfer/resend_otp`,
      { transfer_code: w.paystackTransferCode, reason: 'transfer' },
      { headers: paystackHeaders() }
    );
    return res.json({ success: true, message: 'OTP re-sent to the Paystack business phone' });
  } catch (err) {
    const msg = err.response?.data?.message || 'Could not resend OTP';
    console.error('[Admin resend otp]', err.response?.data || err.message);
    return res.status(400).json({ success: false, message: msg });
  }
};

// POST /:id/sync — check this withdrawal's transfer on Paystack by reference
exports.syncWithdrawal = async (req, res) => {
  try {
    const w = await Withdrawal.findById(req.params.id);
    if (!w) return res.status(404).json({ success: false, message: 'Withdrawal not found' });
    if (w.status !== 'pending') return res.json({ success: true, data: w });
    const updated = await require('./paymentController').syncWithdrawalWithPaystack(w);
    return res.json({ success: true, data: updated });
  } catch (err) {
    const msg = err.response?.status === 404
      ? 'Paystack has no transfer with this reference — if you paid it from the dashboard, use Mark as paid'
      : err.response?.data?.message || 'Could not check Paystack';
    console.error('[Admin sync withdrawal]', err.response?.data || err.message);
    return res.status(400).json({ success: false, message: msg });
  }
};
