const router = require('express').Router();
const { authenticate, scopeToEstate, requireActiveSubscription } = require('../middleware/auth');
const ctrl = require('../controllers/loungeController');

router.use(authenticate, scopeToEstate, requireActiveSubscription);

router.get('/',                              ctrl.getSession);
router.patch('/mood',                        ctrl.updateMood);
router.post('/suggest',                      ctrl.suggestVideo);
router.post('/suggest/:suggestionId/vote',   ctrl.voteVideo);
router.delete('/suggest/:suggestionId',      ctrl.removeSuggestion);
router.post('/reset-defaults',               ctrl.resetDefaults);

module.exports = router;
