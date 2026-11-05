const router = require('express').Router();
const { authenticate, authorize, scopeToEstate, requireEstate, requireActiveSubscription } = require('../middleware/auth');
const ctrl = require('../controllers/gateLogController');

router.use(authenticate, scopeToEstate, requireEstate, requireActiveSubscription, authorize('security', 'estate_manager', 'super_admin'));

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.patch('/:id/out', ctrl.markOut);

module.exports = router;
