const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/unitController');
const { authenticate, authorize, scopeToEstate } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.use(authenticate, scopeToEstate);

router.get('/', ctrl.getUnits);

router.post('/', authorize('estate_manager', 'super_admin'), [
  body('unitNumber').notEmpty(),
], validate, ctrl.createUnit);

router.patch('/:id', authorize('estate_manager', 'super_admin'), ctrl.updateUnit);
router.delete('/:id', authorize('estate_manager', 'super_admin'), ctrl.deleteUnit);

module.exports = router;
