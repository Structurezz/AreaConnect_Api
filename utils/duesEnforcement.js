const Payment = require('../models/Payment');
const User = require('../models/User');
const Estate = require('../models/Estate');
const DuesEnforcementLog = require('../models/DuesEnforcementLog');

// Dues enforcement — pausing *convenience* services for residents with overdue
// bills, done in a way an estate can defend:
//   1. the estate must name what allows it — a constitution clause, an AGM
//      resolution, a service-charge/tenancy agreement, estate rules, or another
//      basis the manager describes (BASIS_TYPES)
//   2. the resident gets written notice and a grace period first
//   3. a manager confirms each restriction — nothing is applied automatically
//   4. essentials are never touched (see PROTECTED) and guards are never told why
//   5. restrictions lift by themselves the moment the overdue bills are cleared
//   6. every step is written to DuesEnforcementLog

const SERVICES = {
  visitor_passes: {
    label: 'Visitor passes',
    effect: 'New visitor passes need estate management approval before they work at the gate. Medical and emergency visitors are not affected.',
  },
  community: {
    label: 'Community lounge',
    effect: 'Posting, commenting and reacting in the community lounge is paused. You can still read it.',
  },
  events: {
    label: 'Estate events',
    effect: 'RSVPs to estate events are paused.',
  },
  marketplace: {
    label: 'Marketplace',
    effect: 'Creating new listings and buying on the marketplace is paused. Existing orders, deliveries and wallet withdrawals continue as normal.',
  },
};
const SERVICE_KEYS = Object.keys(SERVICES);

// Never restricted, whatever the settings say.
const PROTECTED = [
  'Entry to your own home',
  'Emergency / SOS alerts and calls to security',
  'Medical and emergency visitors',
  'Utilities such as water and power',
  'Your own marketplace earnings and withdrawals',
];

// Visitor purposes that always bypass the visitor-pass restriction
const EXEMPT_PURPOSES = /medical|emergency|ambulance|doctor|nurse|police|fire/i;

// Notices read "Under <basisText>, …", so the reference should complete that sentence.
const BASIS_TYPES = {
  constitution:   { label: 'Estate constitution',                 example: 'Section 12(3)' },
  agm_resolution: { label: "AGM / residents' meeting resolution", example: 'the resolution passed at the AGM of 14 March 2026' },
  agreement:      { label: 'Service-charge or tenancy agreement', example: 'clause 7 of your service-charge agreement' },
  estate_rules:   { label: 'Estate rules / bye-laws',             example: 'rule 4.2 of the estate rules' },
  other:          { label: 'Other (describe)',                    example: 'the dues policy sent to all residents on 1 Oct 2026' },
};

function basisText(cfg) {
  const ref = String(cfg.constitutionClause || '').trim();
  if (cfg.basisType && cfg.basisType !== 'constitution') return ref;
  return /constitution/i.test(ref) ? ref : `${ref} of the estate constitution`;
}

const DEFAULTS = { enabled: false, basisType: 'constitution', constitutionClause: '', noticeDays: 14, minOverdueDays: 30, minAmount: 0, services: SERVICE_KEYS };
const settingsOf = (estate) => ({ ...DEFAULTS, ...(estate?.settings?.duesEnforcement?.toObject?.() || estate?.settings?.duesEnforcement || {}) });

const NGN = (n) => `₦${Math.round(n || 0).toLocaleString('en-NG')}`;

// A resident's unpaid bills that are past due by at least `minDays`.
async function overdueBills(residentId, estateId, minDays = 0) {
  const cutoff = new Date(Date.now() - minDays * 864e5);
  const unpaid = await Payment.find({ estateId, residentId, status: { $in: ['pending', 'overdue'] } })
    .select('amount status scheduleId')
    .populate('scheduleId', 'title dueDate')
    .lean();
  const bills = unpaid.filter((p) => {
    const due = p.scheduleId?.dueDate ? new Date(p.scheduleId.dueDate) : null;
    // A bill flagged overdue with no due date still counts once minDays is 0
    return due ? due < cutoff : (p.status === 'overdue' && minDays === 0);
  });
  return {
    amount: bills.reduce((t, p) => t + p.amount, 0),
    bills: bills.map((p) => ({ _id: p._id, title: p.scheduleId?.title || 'Bill', amount: p.amount, dueDate: p.scheduleId?.dueDate || null })),
  };
}

async function log(estateId, residentId, action, { byId = null, services = [], amountOwed = 0, note = '' } = {}) {
  return DuesEnforcementLog.create({ estateId, residentId, action, byId, services, amountOwed, note });
}

async function notifyResident(user, estate, kind, { subject, lines, items, pushTitle, pushBody }) {
  const { sendDuesEnforcementEmail } = require('../services/emailService');
  const { sendToUser } = require('../services/pushService');
  if (user.email) {
    sendDuesEnforcementEmail({ to: user.email, name: user.name, estateName: estate?.name || 'Your estate', kind, subject, lines, items })
      .catch((e) => console.error('[dues email]', e.message));
  }
  sendToUser(user._id, { title: pushTitle, body: pushBody, url: '/payments', tag: 'dues-enforcement' }).catch(() => {});
}

// Clears a resident's notice/restriction once nothing is overdue any more.
// Called lazily wherever a restriction is checked, and after payments settle,
// so a resident who pays is restored straight away.
async function syncRestriction(userOrId) {
  const user = userOrId?.duesRestriction ? userOrId : await User.findById(userOrId);
  const r = user?.duesRestriction;
  if (!user || !r || r.status === 'none') return user;

  const { amount } = await overdueBills(user._id, user.estateId, 0);
  if (amount > 0) return user;

  const wasActive = r.status === 'active';
  const services = r.services || [];
  await User.updateOne({ _id: user._id }, { $set: { duesRestriction: { status: 'none', services: [] } } });
  user.duesRestriction = { status: 'none', services: [] };
  await log(user.estateId, user._id, 'auto_lifted', { services, note: 'Overdue bills cleared' });

  if (wasActive) {
    const estate = await Estate.findById(user.estateId).select('name');
    notifyResident(user, estate, 'restored', {
      subject: 'Your services have been restored',
      lines: ['Thank you — your overdue estate bills are now cleared, so everything that was paused is working again.'],
      items: services.map((s) => SERVICES[s]?.label).filter(Boolean),
      pushTitle: 'Services restored',
      pushBody: 'Thanks for clearing your estate bills — everything is working again.',
    });
  }
  return user;
}

// true when `service` is currently paused for this user
async function isRestricted(user, service) {
  if (user?.role !== 'resident') return false;
  // Family members follow their household head (they have no bills of their own)
  if (user.householdRole === 'member' && user.householdHead) {
    const head = await User.findById(user.householdHead).select('role duesRestriction estateId');
    return head && String(head._id) !== String(user._id) ? isRestricted(head, service) : false;
  }
  const r = user.duesRestriction;
  if (r?.status !== 'active' || !(r.services || []).includes(service)) return false;
  const fresh = await syncRestriction(user);
  return fresh.duesRestriction?.status === 'active';
}

const restrictedResponse = (res, service) => res.status(403).json({
  success: false,
  code: 'DUES_RESTRICTED',
  service,
  message: `${SERVICES[service]?.label || 'This feature'} is paused because of overdue estate bills. Clear them on the Payments page to restore it straight away.`,
});

// Route middleware: block a resident from `service` while it's restricted.
const requireUnrestricted = (service) => async (req, res, next) => {
  try {
    if (await isRestricted(req.user, service)) return restrictedResponse(res, service);
    next();
  } catch (err) {
    console.error('[dues restriction]', err.message);
    next(); // never lock someone out because the check itself failed
  }
};

module.exports = {
  SERVICES, SERVICE_KEYS, PROTECTED, EXEMPT_PURPOSES, NGN, BASIS_TYPES, basisText,
  settingsOf, overdueBills, log, notifyResident, syncRestriction, isRestricted, requireUnrestricted,
};
