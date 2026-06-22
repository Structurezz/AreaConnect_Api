const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/paymentController');
const { authenticate, authorize, scopeToEstate, requireEstate, requireActiveSubscription } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.use(authenticate, scopeToEstate, requireEstate, requireActiveSubscription);

// ── Stats (manager) ─────────────────────────────────────────────
router.get('/stats', authorize('estate_manager', 'super_admin'), ctrl.getPaymentStats);

// ── Payment history (manager) ────────────────────────────────────
router.get('/history', authorize('estate_manager', 'super_admin'), ctrl.getPaymentHistory);

// ── Wallet (manager) ─────────────────────────────────────────────
router.get('/wallet', authorize('estate_manager', 'super_admin'), ctrl.getWallet);

router.get('/wallet/banks', authorize('estate_manager', 'super_admin'), ctrl.getBanks);

router.post('/wallet/resolve', authorize('estate_manager', 'super_admin'), [
  body('bankCode').notEmpty().withMessage('Bank is required'),
  body('accountNumber').isLength({ min: 10, max: 10 }).withMessage('Account number must be 10 digits'),
], validate, ctrl.resolveAccount);

router.post('/wallet/bank', authorize('estate_manager', 'super_admin'), [
  body('bankCode').notEmpty().withMessage('Bank is required'),
  body('accountNumber').isLength({ min: 10, max: 10 }).withMessage('Account number must be 10 digits'),
], validate, ctrl.saveBankAccount);

router.post('/wallet/withdraw', authorize('estate_manager', 'super_admin'), [
  body('amount').isFloat({ min: 100 }).withMessage('Minimum withdrawal is ₦100'),
], validate, ctrl.withdrawFromWallet);

// ── Schedules (manager) ─────────────────────────────────────────
router.get('/schedules', authorize('estate_manager', 'super_admin'), ctrl.getSchedules);

router.post('/schedules', authorize('estate_manager', 'super_admin'), [
  body('title').trim().notEmpty(),
  body('amount').isFloat({ min: 1 }),
  body('dueDate').isISO8601(),
  body('type').optional().isIn(['security_dues', 'maintenance', 'levy', 'contribution', 'other']),
  body('frequency').optional().isIn(['one_time', 'monthly', 'quarterly', 'annual']),
], validate, ctrl.createSchedule);

router.get('/schedules/:scheduleId/payments', authorize('estate_manager', 'super_admin'), ctrl.getSchedulePayments);
router.delete('/schedules/:scheduleId', authorize('estate_manager', 'super_admin'), ctrl.deleteSchedule);

// ── Individual payment actions ──────────────────────────────────
router.get('/:paymentId/invoice', ctrl.getInvoice);

router.patch('/:paymentId/manual', authorize('estate_manager', 'super_admin'), [
  body('method').isIn(['cash', 'bank_transfer', 'manual']),
], validate, ctrl.recordManualPayment);

router.patch('/:paymentId/waive', authorize('estate_manager', 'super_admin'), ctrl.waivePayment);

// ── Resident ────────────────────────────────────────────────────
router.get('/mine', ctrl.getMyPayments);
router.post('/:paymentId/initialize', ctrl.initializePayment);
router.get('/verify/:reference', ctrl.verifyPayment);

module.exports = router;
