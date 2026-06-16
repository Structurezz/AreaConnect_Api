require('dotenv').config();
const mongoose = require('mongoose');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const Estate = require('../models/Estate');

const PLANS = [
  {
    name: 'Starter',
    slug: 'starter',
    description: 'Get your estate online fast — perfect for small communities.',
    color: '#64748B',
    badge: '',
    price: { monthly: 20000, annual: 192000 },
    sortOrder: 0,
    isDefault: true,
    features: {
      maxResidents: 50,
      maxUnits: 30,
      maxVisitorsPerMonth: 200,
      visitorManagement: true,
      residentManagement: true,
      unitManagement: true,
      announcements: true,
      communityChat: false,
      nkechiAI: false,
      marketplace: false,
      paymentSystem: false,
      securityPortal: true,
      emergencyBroadcast: true,
      residentLounge: false,
      musicPlayer: false,
      fridayNightFunTimes: false,
      eventBoard: false,
      pollsAndVoting: false,
      analytics: 'basic',
      customBranding: false,
      apiAccess: false,
      prioritySupport: false,
      whiteLabel: false,
    },
  },
  {
    name: 'Growth',
    slug: 'growth',
    description: 'The full platform — everything most estates need.',
    color: '#10B981',
    badge: 'Most popular',
    price: { monthly: 47000, annual: 451200 },
    sortOrder: 1,
    features: {
      maxResidents: 200,
      maxUnits: 120,
      maxVisitorsPerMonth: -1,
      visitorManagement: true,
      residentManagement: true,
      unitManagement: true,
      announcements: true,
      communityChat: true,
      nkechiAI: false,
      marketplace: true,
      paymentSystem: true,
      securityPortal: true,
      emergencyBroadcast: true,
      residentLounge: false,
      musicPlayer: false,
      fridayNightFunTimes: false,
      eventBoard: true,
      pollsAndVoting: true,
      analytics: 'full',
      customBranding: false,
      apiAccess: false,
      prioritySupport: false,
      whiteLabel: false,
    },
  },
  {
    name: 'Premium',
    slug: 'premium',
    description: 'Larger estates with full community and lounge features.',
    color: '#6366F1',
    badge: 'Best value',
    price: { monthly: 80000, annual: 768000 },
    sortOrder: 2,
    features: {
      maxResidents: 500,
      maxUnits: 300,
      maxVisitorsPerMonth: -1,
      visitorManagement: true,
      residentManagement: true,
      unitManagement: true,
      announcements: true,
      communityChat: true,
      nkechiAI: true,
      marketplace: true,
      paymentSystem: true,
      securityPortal: true,
      emergencyBroadcast: true,
      residentLounge: true,
      musicPlayer: true,
      fridayNightFunTimes: true,
      eventBoard: true,
      pollsAndVoting: true,
      analytics: 'full',
      customBranding: true,
      apiAccess: false,
      prioritySupport: true,
      whiteLabel: false,
    },
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    description: 'For large or multiple estates — white-label, API access, dedicated support.',
    color: '#0F172A',
    badge: 'Enterprise',
    price: { monthly: 0, annual: 0 }, // custom pricing handled offline
    sortOrder: 3,
    features: {
      maxResidents: -1,
      maxUnits: -1,
      maxVisitorsPerMonth: -1,
      visitorManagement: true,
      residentManagement: true,
      unitManagement: true,
      announcements: true,
      communityChat: true,
      nkechiAI: true,
      marketplace: true,
      paymentSystem: true,
      securityPortal: true,
      emergencyBroadcast: true,
      residentLounge: true,
      musicPlayer: true,
      fridayNightFunTimes: true,
      eventBoard: true,
      pollsAndVoting: true,
      analytics: 'full',
      customBranding: true,
      apiAccess: true,
      prioritySupport: true,
      whiteLabel: true,
    },
  },
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // Upsert plans by slug
  for (const p of PLANS) {
    await Plan.findOneAndUpdate({ slug: p.slug }, p, { upsert: true, new: true });
    console.log(`✅ Plan: ${p.name} (${p.slug})`);
  }

  // Assign Starter (trial) to every estate that has no subscription
  const starterPlan = await Plan.findOne({ slug: 'starter' });
  const estates = await Estate.find({});
  let assigned = 0;
  for (const e of estates) {
    const existing = await Subscription.findOne({ estateId: e._id });
    if (!existing && starterPlan) {
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 14);
      await Subscription.create({
        estateId: e._id,
        planId: starterPlan._id,
        cycle: 'monthly',
        status: 'trial',
        trialEndsAt: trialEnd,
      });
      assigned++;
    }
  }
  console.log(`✅ Assigned Starter (trial) plan to ${assigned} estates`);

  await mongoose.disconnect();
  console.log('Done.');
}

seed().catch((err) => { console.error(err); process.exit(1); });
