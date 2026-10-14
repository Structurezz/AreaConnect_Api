const Post = require('../models/Post');
const { emitNotification, getIO } = require('../services/socketService');

// Live Lounge: every change is pushed to the whole estate so feeds update in
// real time (new posts, likes, comments, deletions).
const live = (estateId, event, payload) => getIO()?.to(`estate:${estateId}`).emit(event, payload);
const { deleteGridFSFiles } = require('../utils/gridfs');

const POPULATE_AUTHOR   = { path: 'author',           select: 'name role profilePhoto' };
const POPULATE_COMMENTS = { path: 'comments.author',  select: 'name role profilePhoto' };

// GET /api/posts?page=1&limit=20
exports.getPosts = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      Post.find({ estateId: req.estateId, kind: { $ne: 'story' } })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate(POPULATE_AUTHOR)
        .populate(POPULATE_COMMENTS),
      Post.countDocuments({ estateId: req.estateId, kind: { $ne: 'story' } }),
    ]);

    return res.json({ success: true, data: posts, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/posts/stories — active stories (last 24h), oldest first per author
exports.getStories = async (req, res) => {
  try {
    const stories = await Post.find({ estateId: req.estateId, kind: 'story', createdAt: { $gte: new Date(Date.now() - 24 * 3600_000) } })
      .sort({ createdAt: 1 })
      .populate(POPULATE_AUTHOR)
      .populate(POPULATE_COMMENTS);
    return res.json({ success: true, data: stories });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/posts  (multipart/form-data: content, images[], kind?='post'|'story')
exports.createPost = async (req, res) => {
  try {
    const { content } = req.body;
    const kind = req.body.kind === 'story' ? 'story' : 'post';
    const images = (req.files || []).map(f => f.url);

    if (!content?.trim() && images.length === 0) {
      return res.status(400).json({ success: false, message: 'Post must have text or an image' });
    }

    const post = await Post.create({
      estateId: req.estateId,
      author:   req.user._id,
      content:  content?.trim() || '',
      images,
      kind,
    });

    await post.populate([POPULATE_AUTHOR, POPULATE_COMMENTS]);

    if (kind === 'story') {
      // Stories live only in the stories row — no timeline push, no toast.
      live(req.estateId, 'lounge:story_new', post.toObject());
      return res.status(201).json({ success: true, data: post });
    }

    live(req.estateId, 'lounge:post_new', post.toObject());

    emitNotification(req.estateId, {
      id:    post._id.toString(),
      type:  'new_post',
      title: 'New Post',
      body:  `${req.user.name} shared something in the Lounge`,
      meta:  { postId: post._id },
    });

    return res.status(201).json({ success: true, data: post });
  } catch (err) {
    console.error('[createPost]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// DELETE /api/posts/:id
exports.deletePost = async (req, res) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

    const isAuthor  = post.author.toString() === req.user._id.toString();
    const isManager = req.user.role === 'estate_manager' || req.user.role === 'super_admin';
    if (!isAuthor && !isManager) {
      return res.status(403).json({ success: false, message: 'Not authorised' });
    }

    const imageUrls = post.images || [];
    await post.deleteOne();
    // Best-effort cleanup of the underlying GridFS blobs so storage doesn't
    // creep up over time. Failure to delete a file doesn't affect the response.
    deleteGridFSFiles(imageUrls).catch(() => {});
    live(req.estateId, 'lounge:post_deleted', { postId: String(post._id) });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/posts/:id/like — toggle. Atomic ($addToSet/$pull) so two people
// liking at the same moment can't overwrite each other.
exports.likePost = async (req, res) => {
  try {
    const uid = req.user._id;
    const filter = { _id: req.params.id, estateId: req.estateId };
    let post = await Post.findOneAndUpdate({ ...filter, likes: { $ne: uid } }, { $addToSet: { likes: uid } }, { new: true }).select('likes author');
    let liked = true;
    if (!post) {
      post = await Post.findOneAndUpdate({ ...filter, likes: uid }, { $pull: { likes: uid } }, { new: true }).select('likes author');
      liked = false;
    }
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

    live(req.estateId, 'lounge:post_like', { postId: String(post._id), likes: post.likes.length, userId: String(uid), liked });
    // Tell the author (not for their own likes).
    if (liked && String(post.author) !== String(uid)) {
      emitNotification(req.estateId, {
        id: `like-${post._id}-${uid}`, type: 'post_like',
        title: `${req.user.name.split(' ')[0]} liked your post`, body: 'Tap to see it in the Lounge',
        meta: { postId: String(post._id) },
      }, post.author);
    }
    return res.json({ success: true, likes: post.likes.length, liked });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/posts/:id/comments
exports.addComment = async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ success: false, message: 'Comment cannot be empty' });

    const post = await Post.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

    post.comments.push({ author: req.user._id, text: text.trim() });
    await post.save();
    await post.populate(POPULATE_COMMENTS);

    const comment = post.comments[post.comments.length - 1];
    live(req.estateId, 'lounge:post_comment', { postId: String(post._id), comment: comment.toObject(), total: post.comments.length });
    if (String(post.author) !== String(req.user._id)) {
      emitNotification(req.estateId, {
        id: `comment-${comment._id}`, type: 'post_comment',
        title: `${req.user.name.split(' ')[0]} commented on your post`, body: text.trim().slice(0, 80),
        meta: { postId: String(post._id) },
      }, post.author);
    }
    return res.status(201).json({ success: true, data: comment, total: post.comments.length });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// DELETE /api/posts/:id/comments/:commentId
exports.deleteComment = async (req, res) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

    const comment   = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });

    const isAuthor  = comment.author.toString() === req.user._id.toString();
    const isManager = req.user.role === 'estate_manager' || req.user.role === 'super_admin';
    if (!isAuthor && !isManager) {
      return res.status(403).json({ success: false, message: 'Not authorised' });
    }

    comment.deleteOne();
    await post.save();
    live(req.estateId, 'lounge:comment_deleted', { postId: String(post._id), commentId: req.params.commentId, total: post.comments.length });
    return res.json({ success: true, total: post.comments.length });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
