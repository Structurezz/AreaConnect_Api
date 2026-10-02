const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/podcastController');

// ── Public (unauthenticated) — guest token lookup ────────────────────────────
router.get ('/guest/:token',      ctrl.resolveGuest);
router.post('/guest/:token/join', ctrl.guestJoined);

// ── Authenticated endpoints below ────────────────────────────────────────────
router.use(authenticate);

// Listener side — any authenticated user
router.get('/live',                 ctrl.getLive);
router.get('/upcoming',             ctrl.getUpcoming);
router.get('/episodes',             ctrl.listEpisodes);
router.post('/episodes/:id/play',   ctrl.recordEpisodePlay);

// Admin side — super_admin only
router.get   ('/shows',                              authorize('super_admin'), ctrl.listShows);
router.get   ('/shows/:id',                          authorize('super_admin'), ctrl.getShow);
router.post  ('/shows',                              authorize('super_admin'), ctrl.createShow);
router.patch ('/shows/:id',                          authorize('super_admin'), ctrl.updateShow);
router.post  ('/shows/:id/go-live',                  authorize('super_admin'), ctrl.goLive);
router.post  ('/shows/:id/end',                      authorize('super_admin'), ctrl.endLive);
router.post  ('/shows/:id/invite',                   authorize('super_admin'), ctrl.inviteGuest);
router.post  ('/shows/:id/invites/:inviteId/revoke', authorize('super_admin'), ctrl.revokeInvite);

module.exports = router;
