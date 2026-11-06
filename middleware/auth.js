const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const { canAccess, requiredAreas } = require('../utils/teamAccess');
const household = require('../utils/householdAccess');
const authCache = require('../utils/authCache');
const siteTypes = require('../utils/siteTypes');
const siteWording = require('../utils/siteWording');
const { stayBlock } = require('../utils/stays');

// A resident account with no unit can't use the estate apps until a manager
// assigns one (login, refresh and every API call are refused).
const NO_UNIT_MESSAGE = "Your account isn't assigned to a unit in this estate yet. Ask your estate manager to add you to your unit, then sign in again.";
const isUnassignedResident = (user) => user?.role === 'resident' && !user.unitId;

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    // Single-purpose tokens (e.g. a call-decline link) are never a login
    if (decoded.purpose) return res.status(401).json({ success: false, message: 'Invalid token' });

    // Cached for a few seconds (utils/authCache) — this runs on every request.
    // Lean and without the photo / bank fields: nothing saves req.user.
    const user = await authCache.user(decoded.userId);
    // Hotel guests: before check-in / after check-out (checked-out guests are
    // inactive, so this comes first to give them the right message).
    if (user?.role === 'resident') {
      const block = stayBlock(user);
      if (block) return res.status(block.status).json({ success: false, code: block.code, message: block.message });
    }
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }

    req.user = user;
    // Non-estate sites: reword server messages ("unit" → "ward", …)
    if (user.estateId) {
      const type = await siteWording.siteTypeOf(user.estateId);
      const fix = siteWording.rewordResponses(type);
      if (fix) { const json = res.json.bind(res); res.json = (body) => json(fix(body)); }
    }
    // Invited team members only reach the areas they were given
    if (!canAccess(user, req)) {
      return res.status(403).json({
        success: false,
        code: 'TEAM_NO_ACCESS',
        areas: requiredAreas(req),
        message: "You don't have access to this part of the estate. Ask your estate manager for access.",
      });
    }
    // Family members are locked out while their household head is suspended
    if (user.role === 'resident' && user.householdRole === 'member') {
      const head = await authCache.user(user.householdHead);
      if (!head || !head.isActive) {
        return res.status(401).json({ success: false, code: 'HOUSEHOLD_INACTIVE', message: 'Your household account is paused. Ask the head of your household to contact the estate manager.' });
      }
    }
    // Family members only reach the features their household head gave them
    if (!household.canAccess(user, req)) {
      const permission = household.requiredPermission(req);
      return res.status(403).json({
        success: false,
        code: 'HOUSEHOLD_NO_ACCESS',
        permission,
        message: `Your household hasn't given you access to ${household.PERMISSIONS[permission]?.label.toLowerCase() || 'this feature'}. Ask the head of your household to turn it on.`,
      });
    }
    // Modules the site has switched off (utils/siteTypes) — member accounts only
    if (user.role === 'resident' && user.estateId) {
      const mod = siteTypes.requiredModule(req);
      if (mod) {
        const estate = await siteTypes.siteFor(user.estateId);
        // Calls stay open between a member and site staff (patient ↔ doctor,
        // student ↔ warden) even where neighbour-to-neighbour calling is off
        const staffCall = mod === 'neighbours' && req.baseUrl === '/api/calls' && estate?.site?.type && estate.site.type !== 'estate'
          && await require('../utils/staffCall').staffCallAllowed(user, req, estate.site.type);
        if (!staffCall && !siteTypes.modulesFor(estate)[mod]) {
          return res.status(403).json({ success: false, code: 'MODULE_OFF', module: mod, message: `${siteTypes.MODULES[mod].label} isn't available here.` });
        }
      }
    }
    // Residents only get into the estate once they're assigned to a unit
    if (isUnassignedResident(user)) {
      return res.status(403).json({ success: false, code: 'NO_UNIT', message: NO_UNIT_MESSAGE });
    }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(' or ')}`,
      });
    }
    next();
  };
};

// Inject estateId from authenticated user into all queries
const scopeToEstate = (req, res, next) => {
  if (req.user && req.user.estateId) {
    req.estateId = req.user.estateId;
  }
  next();
};

// Returns 403 when the authenticated user has no estate assigned
const requireEstate = (req, res, next) => {
  if (!req.estateId) {
    return res.status(403).json({
      success: false,
      message: 'Your account is not assigned to an estate yet. Contact a Super Admin.',
    });
  }
  next();
};

const BLOCKED_STATUSES = ['suspended', 'expired', 'cancelled'];

const requireActiveSubscription = async (req, res, next) => {
  try {
    if (!req.estateId) return next();
    const status = await authCache.subStatus(req.estateId);
    if (status && BLOCKED_STATUSES.includes(status)) {
      return res.status(402).json({
        success: false,
        subscriptionStatus: status,
        message: `Your subscription is ${status}. Renew your plan to regain access.`,
      });
    }
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { authenticate, authorize, scopeToEstate, requireEstate, requireActiveSubscription, isUnassignedResident, NO_UNIT_MESSAGE };
