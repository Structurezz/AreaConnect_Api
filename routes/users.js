const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/userController');
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.use(authenticate, authorize('super_admin'));

router.get('/', ctrl.getUsers);
router.patch('/:id', ctrl.updateUser);

router.post('/', [
  body('name').trim().notEmpty(),
  body('email').isEmail(),
  body('password').isLength({ min: 6 }),
  body('role').isIn(['super_admin', 'estate_manager', 'resident', 'security']),
], validate, ctrl.createUser);

module.exports = router;
