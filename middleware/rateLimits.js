// Rate limits for abuse-prone endpoints (password guessing, code brute force,
// email / SMS cost abuse). Keyed by IP (app trusts Railway's proxy) and, for
// sign-in, by the email being tried.
const rateLimit = require('express-rate-limit');

const base = {
  // Off in automated tests (they sign in hundreds of times) unless asked for
  skip: () => process.env.NODE_ENV === 'test' && !process.env.RATE_LIMITS_IN_TEST,
  standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many attempts — please wait a few minutes and try again.' } };
const byIpAndEmail = (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase().slice(0, 120)}`;

module.exports = {
  // 10 sign-in attempts per 15 min per IP+email, 50 per IP overall
  loginPerEmail: rateLimit({ ...base, windowMs: 15 * 60 * 1000, max: 10, keyGenerator: byIpAndEmail }),
  loginPerIp:    rateLimit({ ...base, windowMs: 15 * 60 * 1000, max: 50 }),
  register:      rateLimit({ ...base, windowMs: 60 * 60 * 1000, max: 20 }),
  passwordReset: rateLimit({ ...base, windowMs: 60 * 60 * 1000, max: 10 }),
  contact:       rateLimit({ ...base, windowMs: 60 * 60 * 1000, max: 10 }),
  // Gate code checks: a guard scans a lot, but not hundreds a minute
  verifyCode:    rateLimit({ ...base, windowMs: 60 * 1000, max: 60, keyGenerator: (req) => String(req.user?._id || req.ip) }),
  // Alerts / safety reports email and push staff — cap per user
  alerts:        rateLimit({ ...base, windowMs: 10 * 60 * 1000, max: 10, keyGenerator: (req) => String(req.user?._id || req.ip) }),
};
