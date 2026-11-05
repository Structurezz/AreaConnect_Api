const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/residentController');
const household = require('../controllers/householdController');
const { authenticate, authorize, scopeToEstate, requireActiveSubscription } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.use(authenticate, scopeToEstate, requireActiveSubscription);

router.get('/', authorize('estate_manager', 'super_admin', 'security'), ctrl.getResidents);
// Family members residents asked to add (estate.settings.householdApproval)
router.get('/family-requests',               authorize('estate_manager', 'super_admin'), household.listRequests);
router.post('/family-requests/:id/approve',  authorize('estate_manager', 'super_admin'), household.approveRequest);
router.post('/family-requests/:id/reject',   authorize('estate_manager', 'super_admin'), household.rejectRequest);

router.get('/:id', authorize('estate_manager', 'super_admin'), ctrl.getResident);
// Manager adds a family member to a resident's household / resends their invite
router.post('/:id/family',                   authorize('estate_manager', 'super_admin'), household.managerAdd);
router.post('/:id/family/resend-invite',     authorize('estate_manager', 'super_admin'), household.managerResend);

// Single invite — creates account + sends credentials via Resend
router.post('/invite', authorize('estate_manager', 'super_admin'), [
  body('email').isEmail().normalizeEmail(),
  body('name').notEmpty().trim(),
  body('unitId').isMongoId().withMessage('Choose the unit this resident lives in'),
], validate, ctrl.inviteResident);

// Bulk invite — body: { residents: [{name, email, phone?, unitNumber}] } (unit required)
router.post('/bulk-invite', authorize('estate_manager', 'super_admin'), [
  body('residents').isArray({ min: 1 }),
  body('residents.*.email').isEmail(),
  body('residents.*.name').notEmpty(),
  body('residents.*.unitNumber').optional().isString(),
], validate, ctrl.bulkInviteResidents);

// Direct add (no email)
router.post('/', authorize('estate_manager', 'super_admin'), [
  body('name').notEmpty(),
  // Email is checked in the controller: members without an app login have none
], validate, ctrl.addResident);

router.patch('/:id/suspend',     authorize('estate_manager', 'super_admin'), ctrl.suspendResident);
router.patch('/:id/activate',    authorize('estate_manager', 'super_admin'), ctrl.activateResident);
router.patch('/:id/assign-unit', authorize('estate_manager', 'super_admin'), [
  body('unitId').optional({ nullable: true }).isMongoId().withMessage('Invalid unit ID'),
], validate, ctrl.assignUnit);

module.exports = router;
