const router = require('express').Router();
const ctrl = require('../controllers/eventController');
const { authenticate, scopeToEstate, requireEstate, authorize, requireActiveSubscription } = require('../middleware/auth');
const { requireUnrestricted } = require('../utils/duesEnforcement');

router.use(authenticate, scopeToEstate, requireEstate, requireActiveSubscription);

router.get('/', ctrl.getEvents);
router.post('/', authorize('estate_manager', 'super_admin'), ctrl.createEvent);
router.put('/:id', authorize('estate_manager', 'super_admin'), ctrl.updateEvent);
router.delete('/:id', authorize('estate_manager', 'super_admin'), ctrl.deleteEvent);
router.patch('/:id/rsvp', requireUnrestricted('events'), ctrl.rsvp);

module.exports = router;
