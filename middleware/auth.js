const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const { canAccess, requiredAreas } = require('../utils/teamAccess');

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
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.userId).select('-passwordHash -refreshToken');
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }

    req.user = user;
    // Invited team members only reach the areas they were given
    if (!canAccess(user, req)) {
      return res.status(403).json({
        success: false,
        code: 'TEAM_NO_ACCESS',
        areas: requiredAreas(req),
        message: "You don't have access to this part of the estate. Ask your estate manager for access.",
      });
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
    const sub = await Subscription.findOne({ estateId: req.estateId }).select('status');
    if (sub && BLOCKED_STATUSES.includes(sub.status)) {
      return res.status(402).json({
        success: false,
        subscriptionStatus: sub.status,
        message: `Your subscription is ${sub.status}. Renew your plan to regain access.`,
      });
    }
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { authenticate, authorize, scopeToEstate, requireEstate, requireActiveSubscription, isUnassignedResident, NO_UNIT_MESSAGE };
