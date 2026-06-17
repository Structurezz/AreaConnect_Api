const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/announcementController');
const { authenticate, authorize, scopeToEstate, requireEstate, requireActiveSubscription } = require('../middleware/auth');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');

router.use(authenticate, scopeToEstate, requireEstate, requireActiveSubscription);

router.get('/', ctrl.getAnnouncements);

router.post('/', authorize('estate_manager', 'super_admin'), upload.single('image'), [
  body('title').notEmpty(),
  body('body').notEmpty(),
], validate, ctrl.createAnnouncement);

router.patch('/:id', authorize('estate_manager', 'super_admin'), ctrl.updateAnnouncement);
router.delete('/:id', authorize('estate_manager', 'super_admin'), ctrl.deleteAnnouncement);
router.post('/:id/read', ctrl.markRead);

module.exports = router;
