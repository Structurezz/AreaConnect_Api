const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/callController');
const validate = require('../middleware/validate');
const { authenticate, scopeToEstate, requireEstate, requireActiveSubscription } = require('../middleware/auth');

// AreaConnect admins aren't in an estate, so their routes come before the
// estate-scoped middleware below.
const { authorize } = require('../middleware/auth');
const admin = [authenticate, authorize('super_admin')];
router.get('/admin/directory', admin, ctrl.adminDirectory);
router.get('/admin/history', admin, ctrl.getHistory);
router.post('/admin', admin, [body('calleeId').isMongoId()], validate, ctrl.adminStartCall);
router.post('/admin/:id/cancel', admin, ctrl.cancelCall);
router.post('/admin/:id/end', admin, ctrl.endCall);

// Decline from a push notification — authorised by a per-call token, not a login.
router.post('/:id/push-decline', ctrl.pushDecline);

router.use(authenticate, scopeToEstate, requireEstate, requireActiveSubscription);

router.get('/config', ctrl.getConfig);
router.get('/directory', ctrl.getDirectory);
router.get('/history', ctrl.getHistory);
router.get('/ringing', ctrl.getRinging);

router.post('/', [body('calleeId').isMongoId()], validate, ctrl.startCall);
router.post('/:id/answer',  ctrl.answerCall);
router.post('/:id/decline', ctrl.declineCall);
router.post('/:id/cancel',  ctrl.cancelCall);
router.post('/:id/end',     ctrl.endCall);

router.get('/credits', ctrl.getCredits);
router.post('/credits/topup', [body('packId').isString()], validate, ctrl.startTopup);
router.get('/credits/verify/:reference', ctrl.verifyTopup);
router.get('/credits/receipt/:txId', ctrl.creditReceipt);

router.get('/buzz', ctrl.getBuzzes);
router.post('/buzz', [
  body('toUserId').isMongoId(),
  body('kind').optional().isIn(['checkin', 'greeting', 'thinking_of_you']),
  body('message').optional().isString().isLength({ max: 200 }),
], validate, ctrl.sendBuzz);

module.exports = router;
