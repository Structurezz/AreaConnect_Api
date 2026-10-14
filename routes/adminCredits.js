const router = require('express').Router();
const ctrl = require('../controllers/creditAdminController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('super_admin'));
router.get('/users', ctrl.searchUsers);
router.get('/estates', ctrl.listEstates);
router.get('/grants', ctrl.listGrants);
router.post('/grant', ctrl.grant);

module.exports = router;
