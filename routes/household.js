const router = require('express').Router();
const { authenticate, authorize, scopeToEstate, requireEstate, requireActiveSubscription } = require('../middleware/auth');
const ctrl = require('../controllers/householdController');

// Residents, plus estate managers who live in the estate and head their own
// household. Members can read their household; managing it is head-only
// (checked in the controller).
router.use(authenticate, authorize('resident', 'estate_manager'), scopeToEstate, requireEstate, requireActiveSubscription);

router.get('/options',            ctrl.getOptions);
router.get('/',                   ctrl.list);
router.patch('/home',              ctrl.setHome);
router.post('/',                  ctrl.invite);
router.patch('/:id',              ctrl.update);
router.post('/:id/resend-invite', ctrl.resendInvite);
router.delete('/:id',             ctrl.remove);

module.exports = router;
