const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/paymentController');
const dues = require('../controllers/duesEnforcementController');
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

// Payout account and withdrawals: the estate owner only — never an invited
// team member, even one with finance access (they could pay out to themselves)
const ownerOnly = (req, res, next) => (req.user.role === 'estate_manager' && req.user.teamRole === 'member'
  ? res.status(403).json({ success: false, code: 'OWNER_ONLY', message: 'Only the estate owner can change the payout account or withdraw.' })
  : next());

router.post('/wallet/bank', authorize('estate_manager', 'super_admin'), ownerOnly, [
  body('bankCode').notEmpty().withMessage('Bank is required'),
  body('accountNumber').isLength({ min: 10, max: 10 }).withMessage('Account number must be 10 digits'),
], validate, ctrl.saveBankAccount);

router.post('/wallet/withdraw', authorize('estate_manager', 'super_admin'), ownerOnly, [
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

// ── Dues enforcement (manager) — see utils/duesEnforcement ───────
const mgr = authorize('estate_manager', 'super_admin');
router.get('/enforcement/settings', mgr, dues.getSettings);
router.put('/enforcement/settings', mgr, dues.updateSettings);
router.get('/enforcement', mgr, dues.getOverview);
router.get('/enforcement/residents/:id', mgr, dues.getResident);
router.post('/enforcement/residents/:id/notice', mgr, dues.sendNotice);
router.post('/enforcement/residents/:id/apply', mgr, dues.applyRestriction);
router.post('/enforcement/residents/:id/lift', mgr, dues.liftRestriction);

// ── Dues enforcement (resident) ─────────────────────────────────
router.get('/restriction/mine', authorize('resident'), dues.getMine);
router.post('/restriction/mine/dispute', authorize('resident'), dues.disputeMine);

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

// ── Manager: force-sync a stuck Paystack reference ──────────────
router.post('/reconcile/:reference',
  authorize('estate_manager', 'super_admin'),
  ctrl.reconcilePayment,
);

// ── Manager: Paystack ledger (direct gateway view) ──────────────
// Lets the manager see every Paystack capture, including ones that
// have no matching Payment row in our DB — then attach to a resident +
// schedule to pull the money through.
// AreaConnect admins only: the gateway ledger spans every estate, and
// attaching a reference creates paid money in an estate's wallet.
router.get('/paystack/recent',
  authorize('super_admin'),
  ctrl.getPaystackLedger,
);
router.post('/paystack/attach',
  authorize('super_admin'),
  ctrl.attachPaystackTransaction,
);

module.exports = router;
