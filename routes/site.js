const router = require('express').Router();
const { authenticate, authorize, scopeToEstate, requireEstate, requireActiveSubscription } = require('../middleware/auth');
const ctrl = require('../controllers/siteController');
const places = require('../controllers/placeController');

router.use(authenticate, scopeToEstate, requireEstate);

router.get('/', ctrl.getSite);
router.patch('/', authorize('estate_manager', 'super_admin'), ctrl.updateSite);
router.get('/rooms', requireActiveSubscription, authorize('estate_manager', 'super_admin'), ctrl.roomBoard);
router.patch('/members/:id', requireActiveSubscription, authorize('estate_manager', 'super_admin'), ctrl.updateMember);
router.post('/stays/:id/checkout', requireActiveSubscription, authorize('estate_manager', 'super_admin'), ctrl.checkOut);
router.get('/staff-check', requireActiveSubscription, authorize('security', 'estate_manager', 'super_admin'), ctrl.staffCheck);

// Places on Google Maps (halls, buildings, gates…)
const mgr = authorize('estate_manager', 'super_admin');
router.get('/places', places.list);
router.post('/places', mgr, places.create);
router.patch('/places/:id', mgr, places.update);
router.delete('/places/:id', mgr, places.remove);
router.patch('/places/:id/units', mgr, places.linkUnits);

module.exports = router;
