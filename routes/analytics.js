const router = require('express').Router();
const ctrl = require('../controllers/analyticsController');
const { authenticate, authorize } = require('../middleware/auth');

// Public beacon — fired from the landing on every pageview. No auth; CORS
// policy on the main app already allows the landing origin.
router.post('/visit', ctrl.logVisit);

// Super-admin reports
router.get('/visitors/stats',  authenticate, authorize('super_admin'), ctrl.getStats);
router.get('/visitors/recent', authenticate, authorize('super_admin'), ctrl.getRecent);
router.get('/visitors/people', authenticate, authorize('super_admin'), ctrl.getPeople);

module.exports = router;
