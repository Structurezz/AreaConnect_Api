const router = require('express').Router();
const { authenticate, authorize, scopeToEstate, requireActiveSubscription } = require('../middleware/auth');
const ctrl = require('../controllers/loungeController');

// ── Admin: default-track CRUD (super_admin only, no estate scope) ────────────
// Mounted BEFORE scopeToEstate so these admin endpoints don't need an
// estateId on the acting user.
router.get   ('/defaults',           authenticate, authorize('super_admin'), ctrl.listDefaults);
router.post  ('/defaults',           authenticate, authorize('super_admin'), ctrl.createDefault);
router.patch ('/defaults/:id',       authenticate, authorize('super_admin'), ctrl.updateDefault);
router.delete('/defaults/:id',       authenticate, authorize('super_admin'), ctrl.deleteDefault);
router.post  ('/defaults/reseed',    authenticate, authorize('super_admin'), ctrl.reseedDefaults);

// ── Per-estate session routes ────────────────────────────────────────────────
router.use(authenticate, scopeToEstate, requireActiveSubscription);

router.get('/',                              ctrl.getSession);
router.patch('/mood',                        ctrl.updateMood);
router.post('/suggest',                      ctrl.suggestVideo);
router.post('/suggest/:suggestionId/vote',   ctrl.voteVideo);
router.delete('/suggest/:suggestionId',      ctrl.removeSuggestion);
router.post('/reset-defaults',               ctrl.resetDefaults);

module.exports = router;
