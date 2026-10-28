const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/podcastController');
const admin = require('../controllers/podcastAdminController');

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
router.post  ('/shows/:id/invites/:inviteId/resend', authorize('super_admin'), admin.resendInvite);
router.post  ('/shows/:id/remind',                   authorize('super_admin'), admin.remind);
router.post  ('/shows/:id/duplicate',                authorize('super_admin'), admin.duplicate);
router.delete('/shows/:id',                          authorize('super_admin'), admin.removeShow);

// Admin hub
router.post  ('/admin/upload',        authorize('super_admin'), require('../middleware/uploadPodcastMedia'));
router.get   ('/admin/stats',         authorize('super_admin'), admin.stats);
router.get   ('/admin/people',        authorize('super_admin'), admin.people);
router.get   ('/admin/estates',       authorize('super_admin'), admin.estates);
router.get   ('/admin/guests',        authorize('super_admin'), admin.guests);
router.get   ('/admin/episodes',      authorize('super_admin'), admin.listEpisodes);
router.post  ('/admin/episodes',      authorize('super_admin'), admin.createEpisode);
router.patch ('/admin/episodes/:id',  authorize('super_admin'), admin.updateEpisode);
router.delete('/admin/episodes/:id',  authorize('super_admin'), admin.deleteEpisode);

module.exports = router;
