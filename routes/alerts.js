const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/alertController');
const { authenticate, authorize, scopeToEstate, requireEstate, requireActiveSubscription } = require('../middleware/auth');
const validate = require('../middleware/validate');

// Super-admin platform-wide list — declared BEFORE the estate-scoped
// middleware chain below so admin requests skip the requireEstate check.
router.get('/platform-all', authenticate, authorize('super_admin'), ctrl.getAllAlertsAdmin);

router.use(authenticate, scopeToEstate, requireEstate, requireActiveSubscription);

router.post('/', [
  body('type').optional().isIn(['security', 'fire', 'medical', 'noise', 'other']),
  body('audience').optional().isIn(['all', 'staff', 'estate_manager', 'security']),
  body('note').optional().isString().isLength({ max: 1000 }),
  body('location').optional().isString().isLength({ max: 200 }),
], validate, ctrl.createAlert);

router.get('/', ctrl.getAlerts);

router.patch('/:id/acknowledge', authorize('security', 'estate_manager', 'super_admin'), ctrl.acknowledgeAlert);
router.patch('/:id/resolve', authorize('security', 'estate_manager', 'super_admin'), ctrl.resolveAlert);

router.post('/broadcast', authorize('security', 'estate_manager', 'super_admin'), [
  // Title is optional (defaults from the type) — the estate-manager mobile app
  // never sent one, so every broadcast from it was rejected with a 422.
  body('title').optional().isString().isLength({ max: 140 }),
  body('note').trim().notEmpty().withMessage('Message is required'),
  body('type').optional().isIn(['security', 'fire', 'medical', 'noise', 'other']),
  body('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
  body('audience').optional().isIn(['all', 'staff', 'estate_manager', 'security']),
], validate, ctrl.broadcastEmergency);

module.exports = router;
