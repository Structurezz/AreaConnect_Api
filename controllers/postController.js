const Post = require('../models/Post');
const { emitNotification } = require('../services/socketService');

const POPULATE_AUTHOR   = { path: 'author',           select: 'name role avatar' };
const POPULATE_COMMENTS = { path: 'comments.author',  select: 'name role avatar' };

// GET /api/posts?page=1&limit=20
exports.getPosts = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      Post.find({ estateId: req.estateId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate(POPULATE_AUTHOR)
        .populate(POPULATE_COMMENTS),
      Post.countDocuments({ estateId: req.estateId }),
    ]);

    return res.json({ success: true, data: posts, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/posts  (multipart/form-data: content, images[])
exports.createPost = async (req, res) => {
  try {
    const { content } = req.body;
    const images = (req.files || []).map(f => `/uploads/${f.filename}`);

    if (!content?.trim() && images.length === 0) {
      return res.status(400).json({ success: false, message: 'Post must have text or an image' });
    }

    const post = await Post.create({
      estateId: req.estateId,
      author:   req.user._id,
      content:  content?.trim() || '',
      images,
    });

    await post.populate([POPULATE_AUTHOR, POPULATE_COMMENTS]);

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

    await post.deleteOne();
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/posts/:id/like
exports.likePost = async (req, res) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

    const uid = req.user._id.toString();
    const idx = post.likes.findIndex(l => l.toString() === uid);
    if (idx > -1) {
      post.likes.splice(idx, 1);
    } else {
      post.likes.push(req.user._id);
    }
    await post.save();

    return res.json({ success: true, likes: post.likes.length, liked: idx === -1 });
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
    return res.json({ success: true, total: post.comments.length });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
