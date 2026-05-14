const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/visitorController');
const { authenticate, authorize, scopeToEstate } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.use(authenticate, scopeToEstate);

// Public code verification (security uses this, still needs auth)
router.get('/verify/:code', authorize('security', 'estate_manager', 'super_admin'), ctrl.verifyVisitorCode);

router.get('/', authorize('resident', 'estate_manager', 'security', 'super_admin'), ctrl.getVisitors);
router.get('/:id', authorize('resident', 'estate_manager', 'security', 'super_admin'), ctrl.getVisitorById);

router.post('/', authorize('resident', 'estate_manager'), [
  body('visitorName').notEmpty().withMessage('Visitor name required'),
  body('purpose').notEmpty().withMessage('Purpose required'),
  body('expectedDate').isISO8601().withMessage('Valid date required'),
], validate, ctrl.preRegisterVisitor);

router.patch('/:id/checkin', authorize('security', 'estate_manager'), ctrl.checkIn);
router.patch('/:id/checkout', authorize('security', 'estate_manager'), ctrl.checkOut);
router.patch('/:id/blacklist', authorize('estate_manager', 'super_admin'), ctrl.blacklistVisitor);

module.exports = router;
