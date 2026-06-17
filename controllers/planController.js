const axios = require('axios');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const Estate = require('../models/Estate');

const PAYSTACK_BASE = 'https://api.paystack.co';
const paystackHeaders = () => ({
  Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
  'Content-Type': 'application/json',
});
const genRef = () => `PLAN-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;

// ── Plans ──────────────────────────────────────────────────────────────────

exports.getPlans = async (req, res) => {
  try {
    const plans = await Plan.find({ isActive: true }).sort({ sortOrder: 1 });
    return res.json({ success: true, data: plans });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getAllPlans = async (req, res) => {
  try {
    const plans = await Plan.find().sort({ sortOrder: 1 });
    return res.json({ success: true, data: plans });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.createPlan = async (req, res) => {
  try {
    const plan = await Plan.create(req.body);
    return res.status(201).json({ success: true, data: plan });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'Slug already exists' });
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.updatePlan = async (req, res) => {
  try {
    const plan = await Plan.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });
    return res.json({ success: true, data: plan });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.deletePlan = async (req, res) => {
  try {
    await Plan.findByIdAndUpdate(req.params.id, { isActive: false });
    return res.json({ success: true, message: 'Plan deactivated' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Subscriptions ──────────────────────────────────────────────────────────

exports.getSubscriptions = async (req, res) => {
  try {
    const subs = await Subscription.find()
      .populate('estateId', 'name address estateCode')
      .populate('planId', 'name slug color price')
      .populate('updatedBy', 'name')
      .sort({ updatedAt: -1 });
    return res.json({ success: true, data: subs });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getMySubscription = async (req, res) => {
  try {
    const sub = await Subscription.findOne({ estateId: req.estateId })
      .populate('planId');
    if (!sub) return res.status(404).json({ success: false, message: 'No subscription found' });

    // Compute days until expiry for frontend warnings
    const expiryDate = sub.status === 'trial' ? sub.trialEndsAt : sub.nextBillingDate;
    let daysUntilExpiry = null;
    if (expiryDate) {
      daysUntilExpiry = Math.ceil((new Date(expiryDate) - Date.now()) / 86400000);
    }

    return res.json({ success: true, data: { ...sub.toObject(), daysUntilExpiry } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.assignSubscription = async (req, res) => {
  try {
    const { estateId, planId, cycle, status, trialDays, notes, billingModel, residentCount } = req.body;

    const plan = await Plan.findById(planId);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    const now = new Date();
    const trialEndsAt = trialDays ? new Date(now.getTime() + trialDays * 86400000) : null;
    const nextBillingDate = new Date(now);
    if (cycle === 'annual') {
      nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
    } else {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    }

    const sub = await Subscription.findOneAndUpdate(
      { estateId },
      {
        planId, cycle: cycle || 'monthly',
        billingModel: billingModel || 'flat',
        residentCount: residentCount || 0,
        status: status || (trialDays ? 'trial' : 'active'),
        startDate: now,
        trialEndsAt,
        nextBillingDate,
        notes: notes || '',
        updatedBy: req.user._id,
      },
      { new: true, upsert: true, runValidators: true }
    ).populate('planId').populate('estateId', 'name');

    return res.json({ success: true, data: sub });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.updateSubscription = async (req, res) => {
  try {
    const { planId, cycle, status, notes, nextBillingDate } = req.body;
    const sub = await Subscription.findByIdAndUpdate(
      req.params.id,
      { planId, cycle, status, notes, nextBillingDate, updatedBy: req.user._id },
      { new: true, runValidators: true }
    ).populate('planId').populate('estateId', 'name estateCode');

    if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found' });
    return res.json({ success: true, data: sub });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Self-serve upgrade (estate manager) ───────────────────────────────────

exports.initializeUpgrade = async (req, res) => {
  try {
    const { planId, cycle, billingModel, residentCount } = req.body;
    const estateId = req.estateId;

    const plan = await Plan.findById(planId);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    let amount;
    if (billingModel === 'per_resident') {
      if (!plan.price.perResident) return res.status(400).json({ success: false, message: 'Per-resident pricing not available for this plan' });
      amount = (residentCount || 1) * plan.price.perResident;
    } else {
      amount = cycle === 'annual' ? plan.price.annual : plan.price.monthly;
    }

    if (amount === 0) {
      // Free plan — just switch directly
      const now = new Date();
      const next = new Date(now);
      cycle === 'annual' ? next.setFullYear(next.getFullYear() + 1) : next.setMonth(next.getMonth() + 1);

      await Subscription.findOneAndUpdate(
        { estateId },
        { planId, cycle, status: 'active', startDate: now, nextBillingDate: next, updatedBy: req.user._id },
        { upsert: true, new: true }
      );
      return res.json({ success: true, free: true, message: 'Switched to Free plan' });
    }

    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ success: false, message: 'Payment gateway not configured' });
    }

    const reference = genRef();
    const origin = req.headers.origin || process.env.CLIENT_URL || 'http://localhost:5173';
    const callbackUrl = `${origin}/upgrade?ref=${reference}`;

    const { data } = await axios.post(`${PAYSTACK_BASE}/transaction/initialize`, {
      email: req.user.email,
      amount: amount * 100,
      reference,
      callback_url: callbackUrl,
      metadata: {
        type: 'plan_upgrade',
        estateId: estateId.toString(),
        planId: plan._id.toString(),
        planName: plan.name,
        cycle,
        billingModel: billingModel || 'flat',
        residentCount: residentCount || 0,
        managerId: req.user._id.toString(),
      },
    }, { headers: paystackHeaders() });

    // Store pending reference on subscription
    await Subscription.findOneAndUpdate(
      { estateId },
      { pendingRef: reference, pendingPlanId: planId, pendingCycle: cycle },
      { upsert: true }
    );

    return res.json({ success: true, data: { authorizationUrl: data.data.authorization_url, reference } });
  } catch (err) {
    console.error('[Plan upgrade init]', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to initialize upgrade' });
  }
};

exports.verifyUpgrade = async (req, res) => {
  try {
    const { reference } = req.params;

    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ success: false, message: 'Gateway not configured' });
    }

    const { data } = await axios.get(`${PAYSTACK_BASE}/transaction/verify/${reference}`, { headers: paystackHeaders() });
    if (data.data.status !== 'success') {
      return res.status(400).json({ success: false, message: 'Payment not successful' });
    }

    const meta = data.data.metadata;
    const estateId     = meta.estateId;
    const planId       = meta.planId;
    const cycle        = meta.cycle;
    const billingModel = meta.billingModel || 'flat';
    const residentCount = meta.residentCount || 0;

    const plan = await Plan.findById(planId);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    const now = new Date();
    const next = new Date(now);
    cycle === 'annual' ? next.setFullYear(next.getFullYear() + 1) : next.setMonth(next.getMonth() + 1);

    const sub = await Subscription.findOneAndUpdate(
      { estateId },
      {
        planId, cycle, billingModel, residentCount, status: 'active',
        startDate: now, nextBillingDate: next,
        $unset: { pendingRef: '', pendingPlanId: '', pendingCycle: '' },
        updatedBy: req.user._id,
      },
      { upsert: true, new: true }
    ).populate('planId');

    return res.json({ success: true, data: sub });
  } catch (err) {
    console.error('[Plan upgrade verify]', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Verification failed' });
  }
};

exports.getSubscriptionStats = async (req, res) => {
  try {
    const [total, active, trial, expired] = await Promise.all([
      Subscription.countDocuments(),
      Subscription.countDocuments({ status: 'active' }),
      Subscription.countDocuments({ status: 'trial' }),
      Subscription.countDocuments({ status: { $in: ['expired', 'suspended', 'cancelled'] } }),
    ]);

    const revenueArr = await Subscription.aggregate([
      { $match: { status: 'active' } },
      { $lookup: { from: 'plans', localField: 'planId', foreignField: '_id', as: 'plan' } },
      { $unwind: '$plan' },
      { $group: {
        _id: null,
        monthly: { $sum: { $cond: [{ $eq: ['$cycle', 'monthly'] }, '$plan.price.monthly', { $divide: ['$plan.price.annual', 12] }] } },
      }},
    ]);

    const byPlan = await Subscription.aggregate([
      { $match: { status: { $in: ['active', 'trial'] } } },
      { $group: { _id: '$planId', count: { $sum: 1 } } },
      { $lookup: { from: 'plans', localField: '_id', foreignField: '_id', as: 'plan' } },
      { $unwind: '$plan' },
      { $project: { name: '$plan.name', color: '$plan.color', slug: '$plan.slug', count: 1 } },
    ]);

    return res.json({
      success: true,
      data: {
        total, active, trial, expired,
        mrr: revenueArr[0]?.monthly || 0,
        byPlan,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
