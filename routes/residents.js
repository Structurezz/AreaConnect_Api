const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/residentController');
const { authenticate, authorize, scopeToEstate } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.use(authenticate, scopeToEstate);

router.get('/', authorize('estate_manager', 'super_admin', 'security'), ctrl.getResidents);

// Single invite — creates account + sends credentials via Resend
router.post('/invite', authorize('estate_manager', 'super_admin'), [
  body('email').isEmail().normalizeEmail(),
  body('name').notEmpty().trim(),
  body('unitId').optional().isMongoId(),
], validate, ctrl.inviteResident);

// Bulk invite — body: { residents: [{name, email, phone?, unitNumber?}] }
router.post('/bulk-invite', authorize('estate_manager', 'super_admin'), [
  body('residents').isArray({ min: 1 }),
  body('residents.*.email').isEmail(),
  body('residents.*.name').notEmpty(),
  body('residents.*.unitNumber').optional().isString(),
], validate, ctrl.bulkInviteResidents);

// Direct add (no email)
router.post('/', authorize('estate_manager', 'super_admin'), [
  body('name').notEmpty(),
  body('email').isEmail(),
], validate, ctrl.addResident);

router.patch('/:id/suspend',     authorize('estate_manager', 'super_admin'), ctrl.suspendResident);
router.patch('/:id/activate',    authorize('estate_manager', 'super_admin'), ctrl.activateResident);
router.patch('/:id/assign-unit', authorize('estate_manager', 'super_admin'), [
  body('unitId').notEmpty(),
], validate, ctrl.assignUnit);

module.exports = router;
