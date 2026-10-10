const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/authController');
const validate = require('../middleware/validate');
const { authenticate, authorize, scopeToEstate, requireEstate } = require('../middleware/auth');

router.post('/register', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').optional().isIn(['super_admin', 'estate_manager', 'resident', 'security']),
], validate, ctrl.register);

router.post('/login', [
  body('email').isEmail(),
  body('password').notEmpty(),
], validate, ctrl.login);

router.post('/refresh', ctrl.refresh);
router.post('/logout', ctrl.logout);
router.get('/me', authenticate, ctrl.getMe);
router.patch('/me', authenticate, [
  body('name').optional().isString().trim().isLength({ min: 1, max: 100 }),
  body('phone').optional().isString().isLength({ max: 40 }),
  body('isDiscoverable').optional().isBoolean(),
  body('profilePhoto').optional().isString().isLength({ max: 300000 }),
], validate, ctrl.updateProfile);
router.post('/switch-estate', authenticate, ctrl.switchEstate);

// ── Password management ──────────────────────────────────────────────────
router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword').optional().isString(),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
  ],
  validate,
  ctrl.changePassword,
);

// Public: residents / security ask their estate manager to reset their password
router.post(
  '/forgot-password/request',
  [ body('email').isEmail().withMessage('Valid email required') ],
  validate,
  ctrl.requestPasswordReset,
);

// Estate manager: see + act on pending requests
router.get(
  '/password-resets',
  authenticate, scopeToEstate, requireEstate, authorize('estate_manager', 'super_admin'),
  ctrl.listPasswordResets,
);
router.post(
  '/password-resets/:id/approve',
  authenticate, scopeToEstate, requireEstate, authorize('estate_manager', 'super_admin'),
  ctrl.approvePasswordReset,
);
router.post(
  '/password-resets/:id/deny',
  authenticate, scopeToEstate, requireEstate, authorize('estate_manager', 'super_admin'),
  ctrl.denyPasswordReset,
);

module.exports = router;
