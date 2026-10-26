const router = require('express').Router();
const ctrl = require('../controllers/adminSecurityController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('super_admin'));

router.get('/overview', ctrl.overview);
router.patch('/alerts/:id/acknowledge', ctrl.acknowledge);
router.patch('/alerts/:id/resolve', ctrl.resolve);
router.post('/notice', ctrl.notice);

module.exports = router;
