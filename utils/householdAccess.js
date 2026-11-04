// Household access for residents.
//
// The resident a manager onboards is the household head and keeps every
// resident feature. Family members they add (householdRole 'member') get the
// basics — dashboard, announcements, security alerts, personal safety and
// their own profile — plus whichever PERMISSIONS the head switches on.
// authenticate() checks every request a member makes against requiredPermission.

const PERMISSIONS = {
  visitors:    { label: 'Invite visitors',   description: 'Create gate passes and manage visitors for the home' },
  payments:    { label: 'Estate bills',      description: 'See and pay the household’s estate bills' },
  chat:        { label: 'Community chat',    description: 'Read and post in the estate group chat and DMs' },
  community:   { label: 'Lounge & events',   description: 'Lounge, podcasts, events, polls and the courtroom' },
  marketplace: { label: 'Marketplace',       description: 'Buy and sell with neighbours' },
  neighbours:  { label: 'Call neighbours',   description: 'Call or buzz neighbours from the directory' },
};

const RELATIONSHIPS = ['Spouse', 'Child', 'Parent', 'Sibling', 'Relative', 'Domestic staff', 'Other'];

const PRESETS = {
  adult:  { label: 'Adult',          permissions: Object.keys(PERMISSIONS) },
  teen:   { label: 'Teen',           permissions: ['chat', 'community', 'neighbours'] },
  child:  { label: 'Child',          permissions: ['community'] },
  staff:  { label: 'Domestic staff', permissions: ['visitors'] },
  basic:  { label: 'Basics only',    permissions: [] },
};

// Mounted router prefix → permission needed (every method).
const PERMISSION_BY_ROUTE = {
  '/api/visitors':    'visitors',
  '/api/payments':    'payments',
  '/api/messages':    'chat',
  '/api/lounge':      'community',
  '/api/events':      'community',
  '/api/polls':       'community',
  '/api/posts':       'community',
  '/api/dj':          'community',
  '/api/podcast':     'community',
  '/api/court':       'community',
  '/api/marketplace': 'marketplace',
};

const isHouseholdMember = (user) => user?.role === 'resident' && user.householdRole === 'member';

// Permission this request needs, or null when it's open to every member.
function requiredPermission(req) {
  const base = req.baseUrl || '';
  const path = req.path || '';
  // Calls: members can always receive and answer calls; placing calls,
  // buzzing and buying credits need 'neighbours'.
  if (base === '/api/calls') {
    if (req.method !== 'POST') return path === '/directory' ? 'neighbours' : null;
    return /^\/[^/]+\/(answer|decline|end)$/.test(path) ? null : 'neighbours';
  }
  return PERMISSION_BY_ROUTE[base] || null;
}

function canAccess(user, req) {
  if (!isHouseholdMember(user)) return true;
  const perm = requiredPermission(req);
  return !perm || (user.householdPermissions || []).includes(perm);
}

const cleanPermissions = (list) =>
  [...new Set((Array.isArray(list) ? list : []).filter(p => PERMISSIONS[p]))];

module.exports = { PERMISSIONS, RELATIONSHIPS, PRESETS, isHouseholdMember, requiredPermission, canAccess, cleanPermissions };
