require('dotenv').config();
const mongoose = require('mongoose');
const Estate = require('../models/Estate');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');

const APPLY = process.argv.includes('--apply');

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error('✗ MONGODB_URI not set in environment');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');
  console.log(APPLY ? 'Mode: APPLY (will create subscriptions)' : 'Mode: DRY RUN (use --apply to write)');

  const estates = await Estate.find({}).select('_id name estateCode createdAt').lean();
  const estateIds = estates.map(e => e._id);
  const subs = await Subscription.find({ estateId: { $in: estateIds } }).select('estateId').lean();
  const haveSubs = new Set(subs.map(s => s.estateId.toString()));

  const missing = estates.filter(e => !haveSubs.has(e._id.toString()));
  console.log(`Found ${estates.length} estate(s); ${missing.length} missing a subscription.`);

  if (missing.length === 0) {
    await mongoose.disconnect();
    return;
  }

  const plan = await Plan.findOne({ slug: 'starter', isActive: true })
    || await Plan.findOne({ isActive: true }).sort({ sortOrder: 1 });
  if (!plan) {
    console.error('✗ No active plan found — seed plans first');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`Seed plan: ${plan.name} (${plan.slug})`);
  console.log('');

  for (const e of missing) {
    console.log(`  · ${e.name || '(unnamed)'} — ${e.estateCode || e._id.toString()}`);
  }

  if (!APPLY) {
    console.log('');
    console.log('Dry run complete. Re-run with --apply to create trial subscriptions.');
    await mongoose.disconnect();
    return;
  }

  console.log('');
  let created = 0, failed = 0;
  for (const e of missing) {
    try {
      const trialEndsAt = new Date(Date.now() + 14 * 86400000);
      await Subscription.create({
        estateId: e._id,
        planId: plan._id,
        billingModel: 'flat',
        cycle: 'monthly',
        status: 'trial',
        trialEndsAt,
        nextBillingDate: trialEndsAt,
        startDate: new Date(),
      });
      created++;
    } catch (err) {
      console.error(`  ✗ ${e.name || e._id}: ${err.message}`);
      failed++;
    }
  }

  console.log('');
  console.log(`Done. Created ${created}, failed ${failed}.`);
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Script error:', err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
