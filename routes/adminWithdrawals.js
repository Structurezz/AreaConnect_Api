const router = require('express').Router();
const ctrl = require('../controllers/withdrawalAdminController');
const { authenticate, authorize } = require('../middleware/auth');

// Super-admin only — surfaces/processes manager withdrawal requests.
router.use(authenticate, authorize('super_admin'));

router.get('/',                    ctrl.listWithdrawals);
router.get('/balance',             ctrl.getBalance);
router.post('/:id/mark-paid',      ctrl.markWithdrawalPaid);
router.post('/:id/process',        ctrl.processWithdrawalViaPaystack);
router.post('/:id/reject',         ctrl.rejectWithdrawal);
router.post('/:id/finalize-otp',   ctrl.finalizeWithdrawalOtp);
router.post('/:id/resend-otp',     ctrl.resendWithdrawalOtp);
router.post('/:id/sync',           ctrl.syncWithdrawal);

module.exports = router;
