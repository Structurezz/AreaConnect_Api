// Site types — AreaConnect runs estates, schools, universities, hotels, industrial sites /
// offices and hospitals on the same platform. The type picks the words the
// apps use (TERMS), which modules start switched on (DEFAULT_MODULES, which
// the manager can override per site) and the pass categories residents can
// create (PASS_CATEGORIES). Clients fetch the resolved config from
// GET /api/site; keep the client copies of TERMS in step with this file.

const TYPES = ['estate', 'school', 'university', 'hotel', 'industrial', 'hospital'];

const TERMS = {
  estate: {
    site: 'Estate', sites: 'Estates',
    member: 'Resident', members: 'Residents',
    unit: 'Unit', units: 'Units',
    family: 'Family member', familyPlural: 'Family members', household: 'Household',
    manager: 'Estate manager', dues: 'Estate bills',
    idLabel: 'ID number', classLabel: 'Group', idCheck: 'Staff check',
  },
  school: {
    site: 'Campus', sites: 'Campuses',
    member: 'Student', members: 'Students & staff',
    unit: 'Class', units: 'Classes',
    family: 'Parent / guardian', familyPlural: 'Parents & guardians', household: 'Family',
    manager: 'Administrator', dues: 'School fees',
    idLabel: 'Admission / staff no.', classLabel: 'Class', idCheck: 'Staff check',
  },
  // Universities, polytechnics and colleges: adult students use the apps
  // themselves; units are hostel rooms (block = hall / hostel).
  university: {
    site: 'Campus', sites: 'Campuses',
    member: 'Student', members: 'Students & staff',
    unit: 'Room', units: 'Hostel rooms',
    family: 'Parent / guardian', familyPlural: 'Parents & guardians', household: 'Family',
    manager: 'Administrator', dues: 'Hostel & fees',
    idLabel: 'Matric / staff no.', classLabel: 'Department & level', idCheck: 'ID check',
    block: 'Hall',
  },
  hotel: {
    site: 'Property', sites: 'Properties',
    member: 'Guest', members: 'Guests',
    unit: 'Room', units: 'Rooms',
    family: 'Companion', familyPlural: 'Companions', household: 'Party',
    manager: 'Front desk', dues: 'Bills',
    idLabel: 'Staff ID', classLabel: 'Team', idCheck: 'Staff check',
  },
  industrial: {
    site: 'Site', sites: 'Sites',
    member: 'Employee', members: 'Employees',
    unit: 'Department', units: 'Departments',
    family: 'Dependant', familyPlural: 'Dependants', household: 'Team',
    manager: 'Facility manager', dues: 'Charges',
    idLabel: 'Staff ID', classLabel: 'Team', idCheck: 'Staff check',
  },
  hospital: {
    site: 'Hospital', sites: 'Hospitals',
    member: 'Patient / staff', members: 'Patients & staff',
    unit: 'Ward', units: 'Wards',
    family: 'Next of kin', familyPlural: 'Next of kin', household: 'Next of kin',
    manager: 'Administrator', dues: 'Bills',
    idLabel: 'Staff / patient no.', classLabel: 'Department', idCheck: 'Staff check',
  },
};

// Modules that can be switched off for a site. Visitor passes, the gate,
// announcements, alerts and chat are always on.
const MODULES = {
  payments:    { label: 'Payments & dues',   description: 'Bills, dues and online payment' },
  marketplace: { label: 'Marketplace',       description: 'Members buy and sell to each other' },
  community:   { label: 'Community lounge',  description: 'Lounge, posts, polls, podcasts, DJ and the courtroom' },
  events:      { label: 'Events',            description: 'Event board and RSVPs' },
  neighbours:  { label: 'Directory & calls', description: 'Members call and buzz each other' },
  household:   { label: 'Family / household', description: 'Members add family with limited access' },
  gatelog:     { label: 'Deliveries & vehicles', description: 'Guards log deliveries and vehicles in and out' },
  shifts:      { label: 'Staff shifts',      description: 'Shift hours that guards can check at the gate' },
  stays:       { label: 'Guest stays',       description: 'Check-in / check-out dates; access ends at check-out' },
  visiting:    { label: 'Visiting hours',    description: 'Guards are warned when visitors arrive outside visiting hours' },
};

const ALL_ON = { payments: true, marketplace: true, community: true, events: true, neighbours: true, household: true };
const DEFAULT_MODULES = {
  estate:     { ...ALL_ON, gatelog: false, shifts: false, stays: false, visiting: false },
  school:     { ...ALL_ON, marketplace: false, neighbours: false, gatelog: true, shifts: true, stays: false, visiting: false },
  university: { ...ALL_ON, household: false, gatelog: true, shifts: true, stays: false, visiting: true },
  hotel:      { ...ALL_ON, payments: false, marketplace: false, community: false, neighbours: false, gatelog: true, shifts: true, stays: true, visiting: false },
  industrial: { ...ALL_ON, payments: false, marketplace: false, household: false, gatelog: true, shifts: true, stays: false, visiting: false },
  hospital:   { ...ALL_ON, payments: false, marketplace: false, community: false, events: false, neighbours: false, gatelog: true, shifts: true, stays: false, visiting: true },
};

// Pass categories a host can pick, per type. 'guest' is the classic pass.
const CATEGORY_INFO = {
  guest:         { label: 'Visitor' },
  pickup:        { label: 'Authorised pickup', fields: ['studentName', 'studentClass'] },
  contractor:    { label: 'Contractor',        fields: ['company', 'job', 'vehiclePlate'], induction: true },
  supplier:      { label: 'Supplier',          fields: ['company', 'goods', 'vehiclePlate'], induction: true },
  delivery:      { label: 'Delivery',          fields: ['company', 'goods', 'vehiclePlate'] },
  patient_visit: { label: 'Patient visit',     fields: ['patientName', 'ward'] },
};
const PASS_CATEGORIES = {
  estate:     ['guest', 'delivery', 'contractor'],
  school:     ['guest', 'pickup', 'contractor', 'supplier'],
  university: ['guest', 'delivery', 'contractor', 'supplier'],
  hotel:      ['guest', 'delivery'],
  industrial: ['guest', 'contractor', 'supplier', 'delivery'],
  hospital:   ['guest', 'patient_visit', 'contractor', 'supplier', 'delivery'],
};

// Household relationships per type (utils/householdAccess falls back to estate).
const RELATIONSHIPS = {
  school:     ['Parent', 'Guardian', 'Sibling', 'Driver', 'Nanny', 'Relative', 'Other'],
  university: ['Parent', 'Guardian', 'Sibling', 'Sponsor', 'Relative', 'Other'],
  hotel:      ['Spouse', 'Child', 'Friend', 'Colleague', 'Relative', 'Other'],
  industrial: ['Spouse', 'Child', 'Relative', 'Other'],
  hospital:   ['Spouse', 'Parent', 'Child', 'Sibling', 'Relative', 'Caregiver', 'Other'],
};

const normType = (t) => (TYPES.includes(t) ? t : 'estate');

function modulesFor(estate) {
  const type = normType(estate?.site?.type);
  const overrides = estate?.site?.modules || {};
  const out = { ...DEFAULT_MODULES[type] };
  for (const k of Object.keys(MODULES)) {
    if (typeof overrides[k] === 'boolean') out[k] = overrides[k];
  }
  return out;
}

// Full config sent to the apps.
function siteConfig(estate) {
  const type = normType(estate?.site?.type);
  const s = estate?.site || {};
  return {
    type,
    terms: TERMS[type],
    modules: modulesFor(estate),
    passCategories: PASS_CATEGORIES[type].map(k => ({ key: k, ...CATEGORY_INFO[k] })),
    relationships: RELATIONSHIPS[type] || null,
    inductionText: s.inductionText || '',
    visitingHours: {
      start: s.visitingHours?.start || '10:00',
      end: s.visitingHours?.end || '20:00',
      maxPerPatient: s.visitingHours?.maxPerPatient || 0,
    },
  };
}

// ── Module enforcement ─────────────────────────────────────────────────────
// Mounted router prefix → module. Only resident (member) accounts are
// blocked; managers keep access so they can still look at and switch modules.
const MODULE_BY_ROUTE = {
  '/api/payments':    'payments',
  '/api/marketplace': 'marketplace',
  '/api/lounge':      'community',
  '/api/posts':       'community',
  '/api/polls':       'community',
  '/api/dj':          'community',
  '/api/podcast':     'community',
  '/api/court':       'community',
  '/api/events':      'events',
  '/api/household':   'household',
  '/api/gatelog':     'gatelog',
};

function requiredModule(req) {
  const base = req.baseUrl || '';
  const path = req.path || '';
  if (base === '/api/calls') {
    // Receiving and answering calls (e.g. from the estate office) stays on.
    if (req.method !== 'POST') return path === '/directory' ? 'neighbours' : null;
    return /^\/[^/]+\/(answer|decline|end|cancel|push-decline)$/.test(path) || path.startsWith('/admin') ? null : 'neighbours';
  }
  return MODULE_BY_ROUTE[base] || null;
}

// Small per-estate cache so every request doesn't hit Mongo for the config.
const cache = new Map(); // estateId → { at, estate }
const TTL = 60 * 1000;
async function siteFor(estateId) {
  if (!estateId) return null;
  const key = String(estateId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.estate;
  const Estate = require('../models/Estate');
  const estate = await Estate.findById(estateId).select('site').lean();
  cache.set(key, { at: Date.now(), estate });
  return estate;
}
const invalidate = (estateId) => cache.delete(String(estateId));

module.exports = {
  TYPES, TERMS, MODULES, DEFAULT_MODULES, CATEGORY_INFO, PASS_CATEGORIES, RELATIONSHIPS,
  normType, modulesFor, siteConfig, requiredModule, siteFor, invalidate,
};
