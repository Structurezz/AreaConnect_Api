const router = require('express').Router();
const ctrl = require('../controllers/safetyController');
const { authenticate, authorize, scopeToEstate, requireEstate } = require('../middleware/auth');

// No subscription gate here: safety features must always work.
router.use(authenticate, scopeToEstate, requireEstate);

router.get('/residents', authorize('resident'), ctrl.searchResidents);
router.get('/blocks', authorize('resident'), ctrl.listBlocks);
router.post('/blocks', authorize('resident'), ctrl.addBlock);
router.patch('/blocks/:id', authorize('resident'), ctrl.updateBlock);
router.delete('/blocks/:id', authorize('resident'), ctrl.removeBlock);
router.post('/followed', authorize('resident'), ctrl.reportFollowed);
router.post('/location/start', authorize('resident'), ctrl.startLocation);
router.post('/location/stop', authorize('resident'), ctrl.stopLocation);
router.get('/location/active', authorize('security', 'estate_manager', 'super_admin'), ctrl.activeLocations);

module.exports = router;
