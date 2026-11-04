// How many people can live in one unit, set by the estate's plan
// (Plan.features.maxOccupantsPerUnit; -1 = unlimited). A live comp plan wins
// over the billed plan, same as feature access.
//
// Unit.maxOccupants is no longer the limit: it was fixed at 7 for every unit
// and nothing could change it. Responses that send units to the apps fill
// `maxOccupants` with this capacity so existing screens show the right figure.
const Subscription = require('../models/Subscription');

const BY_SLUG = { starter: 7, growth: 50, premium: 1000, enterprise: -1 };
const FALLBACK = 7;
const UNLIMITED = 10000; // what "unlimited" means in practice for one unit

// Plans without an explicit maxOccupantsPerUnit: match the tier by slug/name
// ("premium-annual", "Premium Plus"…), then by monthly price.
function tierCap(plan) {
  const key = `${plan.slug || ''} ${plan.name || ''}`.toLowerCase();
  for (const tier of ['enterprise', 'premium', 'growth', 'starter']) {
    if (key.includes(tier)) return BY_SLUG[tier];
  }
  const monthly = Number(plan.price?.monthly) || 0;
  if (monthly >= 80000) return BY_SLUG.premium;
  if (monthly >= 47000) return BY_SLUG.growth;
  return FALLBACK;
}

const capOfPlan = (plan) => {
  if (!plan) return FALLBACK;
  const v = plan.features?.maxOccupantsPerUnit;
  const n = typeof v === 'number' ? v : tierCap(plan);
  if (n === -1) return UNLIMITED;
  return n > 0 ? n : FALLBACK;
};

async function unitCapacity(estateId) {
  if (!estateId) return FALLBACK;
  const sub = await Subscription.findOne({ estateId })
    .select('planId comp')
    .populate('planId', 'slug name price.monthly features.maxOccupantsPerUnit')
    .populate('comp.planId', 'slug name price.monthly features.maxOccupantsPerUnit')
    .lean();
  if (!sub) return FALLBACK;
  const compLive = sub.comp?.isActive && sub.comp?.planId && (!sub.comp.expiresAt || new Date(sub.comp.expiresAt) > new Date());
  return capOfPlan(compLive ? sub.comp.planId : sub.planId);
}

// Units as plain objects with maxOccupants = the plan's capacity
const withCapacity = (units, cap) => units.map((u) => ({ ...(typeof u.toObject === 'function' ? u.toObject() : u), maxOccupants: cap }));

module.exports = { unitCapacity, withCapacity, capOfPlan, BY_SLUG, UNLIMITED };
