const router = require('express').Router();
const { authenticate, authorize, scopeToEstate, requireEstate, requireActiveSubscription } = require('../middleware/auth');
const ctrl = require('../controllers/householdController');

// Residents only. Members can read their household; managing it is head-only
// (checked in the controller).
router.use(authenticate, authorize('resident'), scopeToEstate, requireEstate, requireActiveSubscription);

router.get('/options',            ctrl.getOptions);
router.get('/',                   ctrl.list);
router.post('/',                  ctrl.invite);
router.patch('/:id',              ctrl.update);
router.post('/:id/resend-invite', ctrl.resendInvite);
router.delete('/:id',             ctrl.remove);

module.exports = router;
