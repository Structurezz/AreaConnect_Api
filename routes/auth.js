const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/authController');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');

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
router.post('/switch-estate', authenticate, ctrl.switchEstate);

module.exports = router;
