require('dotenv').config();
const mongoose = require('mongoose');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const Estate = require('../models/Estate');

const PLANS = [
  {
    name: 'Free',
    slug: 'free',
    description: 'Get started — perfect for small estates just getting organised.',
    color: '#6B7280',
    badge: '',
    price: { monthly: 0, annual: 0 },
    sortOrder: 0,
    isDefault: true,
    features: {
      maxResidents: 20,
      maxUnits: 10,
      maxVisitorsPerMonth: 50,
      visitorManagement: true,
      residentManagement: true,
      unitManagement: true,
      announcements: false,
      communityChat: false,
      nkechiAI: false,
      marketplace: false,
      paymentSystem: false,
      securityPortal: false,
      emergencyBroadcast: false,
      residentLounge: false,
      musicPlayer: false,
      fridayNightFunTimes: false,
      eventBoard: false,
      pollsAndVoting: false,
      analytics: 'none',
      customBranding: false,
      apiAccess: false,
      prioritySupport: false,
      whiteLabel: false,
    },
  },
  {
    name: 'Standard',
    slug: 'standard',
    description: 'For growing estates that need communication and safety tools.',
    color: '#3B82F6',
    badge: 'Popular',
    price: { monthly: 15000, annual: 144000 },
    sortOrder: 1,
    features: {
      maxResidents: 100,
      maxUnits: 50,
      maxVisitorsPerMonth: -1,
      visitorManagement: true,
      residentManagement: true,
      unitManagement: true,
      announcements: true,
      communityChat: false,
      nkechiAI: false,
      marketplace: true,
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
    name: 'Professional',
    slug: 'professional',
    description: 'Full-featured estate management with AI, payments, and entertainment.',
    color: '#10B981',
    badge: 'Best Value',
    price: { monthly: 35000, annual: 336000 },
    sortOrder: 2,
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
      customBranding: false,
      apiAccess: false,
      prioritySupport: false,
      whiteLabel: false,
    },
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    description: 'For large or multiple estates — white-label, API access, dedicated support.',
    color: '#F59E0B',
    badge: 'Enterprise',
    price: { monthly: 75000, annual: 720000 },
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
    console.log(`✅ Plan: ${p.name}`);
  }

  // Assign Free plan to every estate that has no subscription
  const freePlan = await Plan.findOne({ slug: 'free' });
  const estates = await Estate.find({});
  let assigned = 0;
  for (const e of estates) {
    const existing = await Subscription.findOne({ estateId: e._id });
    if (!existing) {
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 14);
      await Subscription.create({
        estateId: e._id,
        planId: freePlan._id,
        cycle: 'monthly',
        status: 'trial',
        trialEndsAt: trialEnd,
      });
      assigned++;
    }
  }
  console.log(`✅ Assigned Free (trial) plan to ${assigned} estates`);

  await mongoose.disconnect();
  console.log('Done.');
}

seed().catch((err) => { console.error(err); process.exit(1); });
