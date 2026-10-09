const router = require('express').Router();
const ctrl = require('../controllers/withdrawalAdminController');
const { authenticate, authorize } = require('../middleware/auth');

// Super-admin only — surfaces/processes manager withdrawal requests.
router.use(authenticate, authorize('super_admin'));

router.get('/',                    ctrl.listWithdrawals);
router.post('/:id/mark-paid',      ctrl.markWithdrawalPaid);
router.post('/:id/process',        ctrl.processWithdrawalViaPaystack);
router.post('/:id/reject',         ctrl.rejectWithdrawal);

module.exports = router;
