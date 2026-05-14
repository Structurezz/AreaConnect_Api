const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/residentController');
const { authenticate, authorize, scopeToEstate } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.use(authenticate, scopeToEstate);

router.get('/', authorize('estate_manager', 'super_admin', 'security'), ctrl.getResidents);

router.post('/invite', authorize('estate_manager', 'super_admin'), [
  body('email').isEmail(),
  body('name').notEmpty(),
], validate, ctrl.inviteResident);

router.post('/', authorize('estate_manager', 'super_admin'), [
  body('name').notEmpty(),
  body('email').isEmail(),
], validate, ctrl.addResident);

router.patch('/:id/suspend', authorize('estate_manager', 'super_admin'), ctrl.suspendResident);
router.patch('/:id/activate', authorize('estate_manager', 'super_admin'), ctrl.activateResident);
router.patch('/:id/assign-unit', authorize('estate_manager', 'super_admin'), [
  body('unitId').notEmpty(),
], validate, ctrl.assignUnit);

module.exports = router;
