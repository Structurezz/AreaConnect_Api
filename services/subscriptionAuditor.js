/**
 * Subscription auditor
 * --------------------
 * Sweeps the Subscription collection once per 24h (and on boot) and resolves
 * every stale sub:
 *
 *   - active + nextBillingDate in the past  → try a Paystack recurring charge
 *       success → advance nextBillingDate by one cycle, email a receipt
 *       fail    → mark `expired`, email the manager with a re-pay link
 *   - trial  + trialEndsAt    in the past   → mark `expired`, email
 *   - comp.isActive (and not expired)       → always skip (free perk)
 *   - comp.isActive but comp.expiresAt past → clear the comp, re-evaluate
 *
 * This file is self-starting: call `startSubscriptionAuditor()` once after
 * mongo connects and the daily interval begins.
 */

const axios = require('axios');
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const Estate = require('../models/Estate');
const User = require('../models/User');
const {
  sendRenewalReceiptEmail,
  sendSubscriptionExpiredEmail,
} = require('./emailService');

const PAYSTACK_BASE = 'https://api.paystack.co';
const paystackHeaders = () => ({
  Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
  'Content-Type': 'application/json',
});

const DAY_MS = 86_400_000;
const DEFAULT_INTERVAL_MS = Number(process.env.SUBSCRIPTION_AUDIT_INTERVAL_MS) || DAY_MS;

let timer = null;
let running = false;

const genRef = () => `RENEW-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const advanceBillingDate = (from, cycle) => {
  const d = new Date(from);
  if (cycle === 'annual') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
};

const computeAmount = (plan, cycle, billingModel, residentCount) => {
  if (!plan) return 0;
  if (billingModel === 'per_resident' && plan.price?.perResident) {
    return Math.max(1, residentCount || 1) * plan.price.perResident;
  }
  return cycle === 'annual' ? Number(plan.price?.annual || 0) : Number(plan.price?.monthly || 0);
};

const findManagerFor = (estateId) =>
  User.findOne({ estateId, role: 'estate_manager' }).select('name email');

// Attempt a recurring charge via Paystack `transaction/charge_authorization`.
// Returns { ok, data } or { ok: false, reason, retriable }.
async function chargeStoredAuth({ sub, plan, amount }) {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    return { ok: false, reason: 'Payment gateway not configured', retriable: false };
  }
  const auth = sub.paystackAuth || {};
  if (!auth.authorizationCode) {
    return { ok: false, reason: 'No saved authorization', retriable: false };
  }
  if (!auth.customerEmail) {
    return { ok: false, reason: 'No customer email on file', retriable: false };
  }

  const reference = genRef();
  try {
    const { data } = await axios.post(
      `${PAYSTACK_BASE}/transaction/charge_authorization`,
      {
        email: auth.customerEmail,
        amount: amount * 100,
        authorization_code: auth.authorizationCode,
        reference,
        metadata: {
          type: 'plan_renewal',
          estateId: sub.estateId.toString(),
          planId: plan._id.toString(),
          planName: plan.name,
          cycle: sub.cycle,
        },
      },
      { headers: paystackHeaders() }
    );

    if (data?.data?.status === 'success') {
      return { ok: true, reference, raw: data.data };
    }
    return {
      ok: false,
      reason: data?.data?.gateway_response || data?.message || 'Charge failed',
      retriable: true,
      reference,
    };
  } catch (err) {
    const msg = err?.response?.data?.message || err.message || 'Charge errored';
    return { ok: false, reason: msg, retriable: true, reference };
  }
}

async function processOne(sub) {
  const now = new Date();

  // 1) Comp handling — perpetual perk wins
  if (sub.comp?.isActive) {
    const expired = sub.comp.expiresAt && new Date(sub.comp.expiresAt) <= now;
    if (!expired) return { sub, outcome: 'skip-comp-active' };
    // Comp just expired → clear comp fields and fall through to re-evaluate
    sub.comp = {
      isActive: false, planId: null, reason: '',
      expiresAt: null, grantedBy: null, grantedAt: null,
    };
    await sub.save();
  }

  // 2) Trial expiry → immediate expiry (no card charge expected)
  if (sub.status === 'trial') {
    if (sub.trialEndsAt && new Date(sub.trialEndsAt) <= now) {
      sub.status = 'expired';
      sub.lastRenewalError = 'Trial ended';
      await sub.save();
      await notifyExpired(sub);
      return { sub, outcome: 'trial-expired' };
    }
    return { sub, outcome: 'skip-trial-active' };
  }

  // 3) Active + billing date passed → attempt renewal
  if (sub.status === 'active') {
    if (!sub.nextBillingDate || new Date(sub.nextBillingDate) > now) {
      return { sub, outcome: 'skip-active-not-due' };
    }

    const plan = sub.planId && typeof sub.planId === 'object'
      ? sub.planId
      : await Plan.findById(sub.planId);
    if (!plan) {
      sub.status = 'expired';
      sub.lastRenewalError = 'Plan missing';
      await sub.save();
      await notifyExpired(sub);
      return { sub, outcome: 'expired-missing-plan' };
    }

    const amount = computeAmount(plan, sub.cycle, sub.billingModel, sub.residentCount);

    // Free plan → just extend
    if (!amount) {
      sub.nextBillingDate = advanceBillingDate(now, sub.cycle);
      sub.renewalAttempts = 0;
      sub.lastRenewalError = '';
      sub.lastSuccessfulRenewalAt = now;
      await sub.save();
      return { sub, outcome: 'extended-free' };
    }

    sub.renewalAttempts = (sub.renewalAttempts || 0) + 1;
    sub.lastRenewalAttemptAt = now;

    const result = await chargeStoredAuth({ sub, plan, amount });

    if (result.ok) {
      sub.status = 'active';
      sub.nextBillingDate = advanceBillingDate(now, sub.cycle);
      sub.renewalAttempts = 0;
      sub.lastRenewalError = '';
      sub.lastRenewalReference = result.reference;
      sub.lastSuccessfulRenewalAt = now;
      sub.remindersSent = [];
      await sub.save();
      await notifyRenewed(sub, { plan, amount, reference: result.reference });
      return { sub, outcome: 'renewed' };
    }

    // Failure → expire + email. We don't retry mid-sweep; the next daily
    // sweep will try again if the admin has resolved the card issue.
    sub.status = 'expired';
    sub.lastRenewalError = result.reason;
    if (result.reference) sub.lastRenewalReference = result.reference;
    await sub.save();
    await notifyExpired(sub, {
      plan,
      amount,
      failureReason: result.reason,
      hasAuth: !!(sub.paystackAuth && sub.paystackAuth.authorizationCode),
    });
    return { sub, outcome: 'expired-charge-failed' };
  }

  return { sub, outcome: 'skip-no-op' };
}

async function notifyRenewed(sub, { plan, amount, reference }) {
  try {
    const [manager, estate] = await Promise.all([
      findManagerFor(sub.estateId),
      Estate.findById(sub.estateId).select('name'),
    ]);
    if (!manager?.email || !estate) return;
    await sendRenewalReceiptEmail({
      to: manager.email,
      managerName: manager.name,
      estateName: estate.name,
      plan,
      cycle: sub.cycle,
      amount,
      reference,
      cardLast4: sub.paystackAuth?.cardLast4,
      cardBrand: sub.paystackAuth?.cardBrand,
      nextBillingDate: sub.nextBillingDate,
    });
  } catch (e) {
    console.error('[auditor] renewed email failed', e.message);
  }
}

async function notifyExpired(sub, meta = {}) {
  try {
    const [manager, estate] = await Promise.all([
      findManagerFor(sub.estateId),
      Estate.findById(sub.estateId).select('name'),
    ]);
    if (!manager?.email || !estate) return;
    const planName = meta.plan?.name || (sub.planId && typeof sub.planId === 'object' ? sub.planId.name : null);
    await sendSubscriptionExpiredEmail({
      to: manager.email,
      managerName: manager.name,
      estateName: estate.name,
      planName,
      amountDue: meta.amount,
      failureReason: meta.failureReason,
      hasAuth: meta.hasAuth,
    });
  } catch (e) {
    console.error('[auditor] expired email failed', e.message);
  }
}

async function runAuditPass({ reason = 'scheduled' } = {}) {
  if (running) {
    console.log('[auditor] previous pass still running — skipping');
    return { skipped: true };
  }
  running = true;
  const startedAt = Date.now();
  const counts = { total: 0, renewed: 0, expired: 0, skipped: 0, other: 0 };

  try {
    const now = new Date();
    // Grab candidates: not already a final state, and either due or trial-ending or comp possibly expired
    const subs = await Subscription.find({
      $or: [
        { status: 'active', nextBillingDate: { $lte: now } },
        { status: 'trial',  trialEndsAt:     { $lte: now } },
        { 'comp.isActive': true, 'comp.expiresAt': { $lte: now, $ne: null } },
      ],
    }).populate('planId');

    counts.total = subs.length;
    if (!subs.length) {
      console.log(`[auditor] ${reason} pass: no stale subscriptions`);
      return counts;
    }

    for (const sub of subs) {
      try {
        const { outcome } = await processOne(sub);
        if (outcome === 'renewed' || outcome === 'extended-free') counts.renewed++;
        else if (outcome?.startsWith('expired') || outcome === 'trial-expired') counts.expired++;
        else if (outcome?.startsWith('skip')) counts.skipped++;
        else counts.other++;
      } catch (e) {
        console.error('[auditor] processOne errored for sub', sub._id, e.message);
        counts.other++;
      }
    }

    console.log(
      `[auditor] ${reason} pass done in ${Date.now() - startedAt}ms`,
      counts,
    );
    return counts;
  } finally {
    running = false;
  }
}

function startSubscriptionAuditor({ intervalMs = DEFAULT_INTERVAL_MS, bootPassDelayMs = 15_000 } = {}) {
  if (timer) return; // idempotent

  // Boot pass — gives mongo + indexes a few seconds to settle, then catches
  // anything that's been stale while the server was down.
  setTimeout(() => {
    runAuditPass({ reason: 'boot' }).catch((e) =>
      console.error('[auditor] boot pass failed', e.message)
    );
  }, bootPassDelayMs);

  timer = setInterval(() => {
    runAuditPass({ reason: 'interval' }).catch((e) =>
      console.error('[auditor] interval pass failed', e.message)
    );
  }, intervalMs);

  console.log(
    `[auditor] subscription auditor started — sweeping every ${(intervalMs / 3600000).toFixed(2)}h`
  );
}

function stopSubscriptionAuditor() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  startSubscriptionAuditor,
  stopSubscriptionAuditor,
  runAuditPass, // exported for manual trigger / tests
};
