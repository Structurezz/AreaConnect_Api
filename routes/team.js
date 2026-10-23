const router = require('express').Router();
const { authenticate, authorize, scopeToEstate, requireEstate } = require('../middleware/auth');
const ctrl = require('../controllers/teamController');

// authenticate() limits invited members to those with the Settings area
router.use(authenticate, authorize('estate_manager'), scopeToEstate, requireEstate);

router.get('/options',            ctrl.getOptions);
router.get('/',                   ctrl.list);
router.post('/',                  ctrl.invite);
router.patch('/:id',              ctrl.update);
router.post('/:id/resend-invite', ctrl.resendInvite);
router.delete('/:id',             ctrl.remove);

module.exports = router;
