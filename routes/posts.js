const router  = require('express').Router();
const { authenticate, scopeToEstate, authorize, requireActiveSubscription } = require('../middleware/auth');
const upload   = require('../middleware/upload');
const ctrl     = require('../controllers/postController');

router.use(authenticate, scopeToEstate, requireActiveSubscription);

router.get('/',                                ctrl.getPosts);
router.post('/',  upload.array('images', 4),   ctrl.createPost);
router.delete('/:id',                          ctrl.deletePost);
router.post('/:id/like',                       ctrl.likePost);
router.post('/:id/comments',                   ctrl.addComment);
router.delete('/:id/comments/:commentId',      ctrl.deleteComment);

module.exports = router;
