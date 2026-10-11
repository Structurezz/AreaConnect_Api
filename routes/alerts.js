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
], validate, ctrl.createAlert);

router.get('/', ctrl.getAlerts);

router.patch('/:id/acknowledge', authorize('security', 'estate_manager', 'super_admin'), ctrl.acknowledgeAlert);
router.patch('/:id/resolve', authorize('security', 'estate_manager', 'super_admin'), ctrl.resolveAlert);

router.post('/broadcast', authorize('security', 'estate_manager', 'super_admin'), [
  body('title').notEmpty().withMessage('Title is required'),
  body('note').notEmpty().withMessage('Message is required'),
  body('type').optional().isIn(['security', 'fire', 'medical', 'noise', 'other']),
  body('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
  body('audience').optional().isIn(['all', 'staff', 'estate_manager', 'security']),
], validate, ctrl.broadcastEmergency);

module.exports = router;
