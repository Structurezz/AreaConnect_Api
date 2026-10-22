/**
 * Trial check-in sweeper.
 *
 * Once per trial, when an estate has ≤ CHECKIN_WINDOW_DAYS left on its free
 * trial, email its manager(s) the "How has your trial been so far?" note
 * (emailService.sendTrialEndingEmail). Runs on boot and then hourly.
 *
 * Each subscription is claimed atomically via `trialCheckinSentAt` before
 * sending, so restarts or multiple server instances never send duplicates.
 * A failed send releases the claim so the next sweep retries.
 *
 * Opt out with TRIAL_CHECKIN=off.
 */
const Subscription = require('../models/Subscription');
const Estate = require('../models/Estate');
const User = require('../models/User');
require('../models/Plan');
const { sendTrialEndingEmail } = require('./emailService');

const DAY_MS = 86_400_000;
const CHECKIN_WINDOW_DAYS = Number(process.env.TRIAL_CHECKIN_DAYS) || 3;
const INTERVAL_MS = Number(process.env.TRIAL_CHECKIN_INTERVAL_MS) || 3_600_000;

let timer = null;
let running = false;

const managersFor = async (estate) => User.find({
  role: 'estate_manager',
  $or: [
    ...(estate.managerId ? [{ _id: estate.managerId }] : []),
    { estateId: estate._id },
    { managedEstates: estate._id },
  ],
}).select('name email').lean();

async function runTrialCheckinPass({ reason = 'manual' } = {}) {
  if (running) return { skipped: 'already-running' };
  running = true;
  const counts = { sent: 0, noManager: 0, failed: 0 };
  try {
    const now = new Date();
    const due = await Subscription.find({
      status: 'trial',
      trialEndsAt: { $gt: now, $lte: new Date(now.getTime() + CHECKIN_WINDOW_DAYS * DAY_MS) },
      trialCheckinSentAt: null,
      'comp.isActive': { $ne: true },
    }).select('_id').lean();

    for (const { _id } of due) {
      // Claim it first — only one sweep (or instance) wins
      const sub = await Subscription.findOneAndUpdate(
        { _id, trialCheckinSentAt: null },
        { $set: { trialCheckinSentAt: new Date() } },
        { new: true },
      ).populate('planId', 'name price');
      if (!sub) continue;

      const estate = await Estate.findById(sub.estateId).select('name managerId').lean();
      const managers = estate ? (await managersFor(estate)).filter(m => m.email) : [];
      if (!managers.length) { counts.noManager++; continue; } // stays claimed: nobody to email

      let delivered = 0;
      for (const m of managers) {
        try {
          await sendTrialEndingEmail({
            to: m.email,
            managerName: m.name,
            estateName: estate.name,
            trialEndsAt: sub.trialEndsAt,
            planName: sub.planId?.name,
            monthlyPrice: sub.planId?.price?.monthly,
          });
          delivered++;
        } catch (e) {
          console.error('[trial-checkin] send failed', estate.name, m.email, e.message);
        }
        await new Promise(r => setTimeout(r, 600)); // stay under Resend's rate limit
      }

      if (delivered) counts.sent++;
      else {
        counts.failed++;
        await Subscription.updateOne({ _id }, { $set: { trialCheckinSentAt: null } }); // retry next sweep
      }
    }

    if (due.length) console.log(`[trial-checkin] ${reason} pass`, counts);
    return counts;
  } finally {
    running = false;
  }
}

function startTrialCheckin({ bootDelayMs = 30_000 } = {}) {
  if (timer) return;
  setTimeout(() => runTrialCheckinPass({ reason: 'boot' }).catch(e => console.error('[trial-checkin] boot pass failed', e.message)), bootDelayMs);
  timer = setInterval(() => runTrialCheckinPass({ reason: 'interval' }).catch(e => console.error('[trial-checkin] pass failed', e.message)), INTERVAL_MS);
  console.log(`[trial-checkin] started — emails managers ≤${CHECKIN_WINDOW_DAYS}d before trial ends, sweeping every ${(INTERVAL_MS / 3_600_000).toFixed(1)}h`);
}

module.exports = { startTrialCheckin, runTrialCheckinPass };
