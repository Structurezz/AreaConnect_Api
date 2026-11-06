// Estate manager team access.
//
// The estate's owner (any estate_manager without teamRole 'member', i.e. every
// account that existed before teams) keeps full access. Invited team members
// get `teamRole: 'member'` plus a list of `permissions` (area keys below), and
// authenticate() checks every request they make against AREA_BY_ROUTE.

const AREAS = {
  residents:      'Residents & units',
  security:       'Security — visitors, guards, alerts',
  finance:        'Finance — payments, wallet, billing',
  communications: 'Communications — announcements, chat',
  community:      'Community — lounge, events, marketplace',
  settings:       'Settings & team',
};

const PRESETS = {
  admin:          { label: 'Admin',          permissions: Object.keys(AREAS) },
  finance:        { label: 'Finance',        permissions: ['finance', 'residents'] },
  security:       { label: 'Security lead',  permissions: ['security', 'residents'] },
  communications: { label: 'Communications', permissions: ['communications', 'community'] },
};

// Mounted router prefix → areas that grant it (any one is enough).
const AREA_BY_ROUTE = {
  '/api/residents':     ['residents'],
  '/api/units':         ['residents'],
  '/api/visitors':      ['security'],
  '/api/guards':        ['security'],
  '/api/alerts':        ['security'],
  '/api/safety':        ['security'],
  '/api/payments':      ['finance'],
  '/api/plans':         ['finance'],
  '/api/announcements': ['communications'],
  '/api/messages':      ['communications'],
  '/api/dj':            ['communications', 'community'],
  '/api/events':        ['community'],
  '/api/polls':         ['community'],
  '/api/lounge':        ['community'],
  '/api/podcast':       ['community'],
  '/api/posts':         ['community'],
  '/api/marketplace':   ['community'],
  '/api/court':         ['community'],
  '/api/team':          ['settings'],
  '/api/gatelog':       ['security'],
  '/api/requests':      ['residents', 'security'],
};

const isTeamMember = (user) => user?.role === 'estate_manager' && user.teamRole === 'member';

// Areas required for this request, or null when it's open to every member.
function requiredAreas(req) {
  // Express matches routes case-insensitively — compare in lower case so
  // /API/Team can't slip past these maps
  const base = (req.baseUrl || '').toLowerCase();
  const path = (req.path || '').toLowerCase();
  const read = req.method === 'GET';

  // Everyone on the team can see basic estate info, dashboard counts and the
  // plan (the app gates features on it); changing the estate is Settings.
  if (base === '/api/estates') return read ? null : ['settings'];
  // Site config: everyone reads it; changing it is Settings; the room board,
  // stays and shifts are member records; the staff check is a gate job.
  if (base === '/api/site') {
    if (path === '/' || path === '') return read ? null : ['settings'];
    if (path.startsWith('/staff-check')) return ['security', 'residents'];
    if (path.startsWith('/places')) return read ? null : ['settings', 'residents'];
    if (path.startsWith('/rollcall')) return null;
    if (path.startsWith('/staff')) return read ? null : ['residents'];
    return ['residents'];
  }
  if (base === '/api/plans' && read && path === '/my-subscription') return null;
  // Anyone on the team can tune in to live estate broadcasts and podcasts
  if (read && (base === '/api/dj' || base === '/api/podcast')) return null;
  // Reviewing residents' password-reset requests is a Settings job
  if (base === '/api/auth') return path.startsWith('/password-resets') ? ['settings'] : null;

  // A unit's residents' payment records are finance data
  if (base === '/api/units' && /^\/[^/]+\/payments$/.test(path)) return ['finance'];

  return AREA_BY_ROUTE[base] || null;
}

// true when the user may make this request
function canAccess(user, req) {
  if (!isTeamMember(user)) return true;
  const areas = requiredAreas(req);
  if (!areas) return true;
  const granted = user.permissions || [];
  return areas.some(a => granted.includes(a));
}

const cleanPermissions = (list) =>
  [...new Set((Array.isArray(list) ? list : []).filter(p => AREAS[p]))];

module.exports = { AREAS, PRESETS, isTeamMember, requiredAreas, canAccess, cleanPermissions };
