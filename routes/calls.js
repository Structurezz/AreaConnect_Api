const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/callController');
const validate = require('../middleware/validate');
const { authenticate, scopeToEstate, requireEstate, requireActiveSubscription } = require('../middleware/auth');

router.use(authenticate, scopeToEstate, requireEstate, requireActiveSubscription);

router.get('/config', ctrl.getConfig);
router.get('/directory', ctrl.getDirectory);
router.get('/history', ctrl.getHistory);

router.post('/', [body('calleeId').isMongoId()], validate, ctrl.startCall);
router.post('/:id/answer',  ctrl.answerCall);
router.post('/:id/decline', ctrl.declineCall);
router.post('/:id/cancel',  ctrl.cancelCall);
router.post('/:id/end',     ctrl.endCall);

router.get('/credits', ctrl.getCredits);
router.post('/credits/topup', [body('packId').isString()], validate, ctrl.startTopup);
router.get('/credits/verify/:reference', ctrl.verifyTopup);

router.get('/buzz', ctrl.getBuzzes);
router.post('/buzz', [
  body('toUserId').isMongoId(),
  body('kind').optional().isIn(['checkin', 'greeting', 'thinking_of_you']),
  body('message').optional().isString().isLength({ max: 200 }),
], validate, ctrl.sendBuzz);

module.exports = router;
