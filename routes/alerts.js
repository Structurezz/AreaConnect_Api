const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/alertController');
const { authenticate, authorize, scopeToEstate, requireEstate } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.use(authenticate, scopeToEstate, requireEstate);

router.post('/', [
  body('type').optional().isIn(['security', 'fire', 'medical', 'noise', 'other']),
], validate, ctrl.createAlert);

router.get('/', ctrl.getAlerts);

router.patch('/:id/acknowledge', authorize('security', 'estate_manager', 'super_admin'), ctrl.acknowledgeAlert);
router.patch('/:id/resolve', authorize('security', 'estate_manager', 'super_admin'), ctrl.resolveAlert);

router.post('/broadcast', authorize('estate_manager', 'super_admin'), [
  body('title').notEmpty().withMessage('Title is required'),
  body('note').notEmpty().withMessage('Message is required'),
  body('type').optional().isIn(['security', 'fire', 'medical', 'noise', 'other']),
  body('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
], validate, ctrl.broadcastEmergency);

module.exports = router;
