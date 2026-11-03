const router  = require('express').Router();
const { authenticate, scopeToEstate, authorize, requireActiveSubscription } = require('../middleware/auth');
const upload   = require('../middleware/upload');
const ctrl     = require('../controllers/postController');
const { requireUnrestricted } = require('../utils/duesEnforcement');

router.use(authenticate, scopeToEstate, requireActiveSubscription);

router.get('/',                                ctrl.getPosts);
router.get('/stories',                         ctrl.getStories);
const community = requireUnrestricted('community');

router.post('/',  community, upload.array('images', 4),   ctrl.createPost);
router.delete('/:id',                          ctrl.deletePost);
router.post('/:id/like',            community, ctrl.likePost);
router.post('/:id/comments',        community, ctrl.addComment);
router.delete('/:id/comments/:commentId',      ctrl.deleteComment);

module.exports = router;
