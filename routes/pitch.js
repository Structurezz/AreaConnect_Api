const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/pitchController');

const admin = [authenticate, authorize('super_admin')];

router.get('/prospects',          ...admin, ctrl.getProspects);
router.get('/prospects/stats',    ...admin, ctrl.getProspectStats);
router.patch('/prospects/:id',    ...admin, ctrl.updateProspect);
router.delete('/prospects/:id',   ...admin, ctrl.deleteProspect);
router.post('/prospects/seed',    ...admin, ctrl.seedProspects);
router.post('/prospects/email',   ...admin, ctrl.sendPitchEmails);

module.exports = router;
