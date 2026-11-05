const router = require('express').Router();
const { authenticate, authorize, scopeToEstate, requireEstate, requireActiveSubscription } = require('../middleware/auth');
const ctrl = require('../controllers/requestController');

router.use(authenticate, scopeToEstate, requireEstate, requireActiveSubscription, authorize('resident', 'estate_manager', 'super_admin'));

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.patch('/:id', ctrl.update);
router.post('/:id/messages', ctrl.addMessage);

module.exports = router;
