const router = require('express').Router();
const ctrl = require('../controllers/onboardingController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('super_admin'));

router.get('/summary', ctrl.summary);
router.get('/managers', ctrl.listManagers);
router.post('/estate', ctrl.onboardEstate);
router.post('/bulk', ctrl.bulkImport);
router.post('/portfolio', ctrl.addToPortfolio);
router.get('/invites', ctrl.listInvites);
router.post('/invites', ctrl.createInvites);
router.post('/invites/:id/resend', ctrl.resendInvite);
router.delete('/invites/:id', ctrl.revokeInvite);

module.exports = router;
