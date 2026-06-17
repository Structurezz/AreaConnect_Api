const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/guardController');
const { authenticate, authorize, scopeToEstate, requireActiveSubscription } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.use(authenticate, scopeToEstate, requireActiveSubscription);

router.get('/',    authorize('estate_manager', 'super_admin'), ctrl.getGuards);
router.get('/:id', authorize('estate_manager', 'super_admin'), ctrl.getGuard);

router.post('/invite', authorize('estate_manager', 'super_admin'), [
  body('email').isEmail().normalizeEmail(),
  body('name').notEmpty().trim(),
  body('phone').optional().trim(),
], validate, ctrl.inviteGuard);

router.patch('/:id/suspend',  authorize('estate_manager', 'super_admin'), ctrl.suspendGuard);
router.patch('/:id/activate', authorize('estate_manager', 'super_admin'), ctrl.activateGuard);
router.delete('/:id',         authorize('estate_manager', 'super_admin'), ctrl.removeGuard);

module.exports = router;
