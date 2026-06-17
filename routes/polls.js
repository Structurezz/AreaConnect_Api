const router = require('express').Router();
const ctrl = require('../controllers/pollController');
const { authenticate, scopeToEstate, requireEstate, authorize, requireActiveSubscription } = require('../middleware/auth');

router.use(authenticate, scopeToEstate, requireEstate, requireActiveSubscription);

router.get('/', ctrl.getPolls);
router.post('/', authorize('estate_manager', 'super_admin'), ctrl.createPoll);
router.post('/:id/vote', ctrl.vote);
router.patch('/:id/close', authorize('estate_manager', 'super_admin'), ctrl.closePoll);

module.exports = router;
