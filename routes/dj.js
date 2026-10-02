const router = require('express').Router();
const { authenticate, authorize, scopeToEstate, requireActiveSubscription } = require('../middleware/auth');
const ctrl = require('../controllers/djController');

router.use(authenticate, scopeToEstate, requireActiveSubscription);

// Read endpoints — any authenticated estate member
router.get('/active',       ctrl.getActive);
router.get('/mixtapes',     ctrl.listMixtapes);
router.post('/mixtapes/:id/play', ctrl.recordPlay);

// Host endpoints — any authenticated estate member can start a live room.
// Only the host (checked in controller) can modify or end their own session.
// Announcements are gated to managers in the controller.
router.post('/start',             ctrl.start);
router.patch('/:id/track',        ctrl.updateTrack);
router.post('/:id/end',           ctrl.end);
router.post('/mixtapes',          ctrl.saveMixtape);
router.delete('/mixtapes/:id',    ctrl.deleteMixtape);

module.exports = router;
