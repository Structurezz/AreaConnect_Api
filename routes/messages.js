const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/messageController');
const { authenticate, scopeToEstate, requireEstate, requireActiveSubscription } = require('../middleware/auth');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');

router.use(authenticate, scopeToEstate, requireEstate, requireActiveSubscription);

router.get('/group', ctrl.getGroupMessages);
router.get('/conversations', ctrl.getConversations);
router.get('/unread', ctrl.getUnreadCounts);
router.get('/users', ctrl.getEstateUsers);
router.get('/dm/:userId', ctrl.getDMMessages);

router.post('/', upload.single('image'), [
  body('content').optional(),
  body('isGroupMessage').optional().isBoolean(),
], validate, ctrl.sendMessage);

module.exports = router;
