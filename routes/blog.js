// Public blog API for the landing site, plus a super-admin trigger.
const express = require('express');
const Article = require('../models/Article');
const { authenticate, authorize } = require('../middleware/auth');
const { writeArticle } = require('../services/blogWriter');

const router = express.Router();
const LIST_FIELDS = 'slug title excerpt category readMinutes publishedAt author keywords';

// GET /api/blog?category=Security&page=1&limit=12  (limit=all for the build-time prerender)
router.get('/', async (req, res) => {
  try {
    const filter = { status: 'published', publishedAt: { $lte: new Date() } };
    if (req.query.category) filter.category = req.query.category;
    const all = req.query.limit === 'all';
    const limit = all ? 0 : Math.min(Number(req.query.limit) || 12, 50);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const [items, total] = await Promise.all([
      Article.find(filter, LIST_FIELDS).sort({ publishedAt: -1 }).skip(all ? 0 : (page - 1) * limit).limit(limit).lean(),
      Article.countDocuments(filter),
    ]);
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ items, total, page, pages: all ? 1 : Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: 'Could not load articles' });
  }
});

// GET /api/blog/:slug — full article plus three related ones
router.get('/:slug', async (req, res) => {
  try {
    const article = await Article.findOne({ slug: req.params.slug, status: 'published', publishedAt: { $lte: new Date() } }).lean();
    if (!article) return res.status(404).json({ error: 'Article not found' });
    const related = await Article.find(
      { _id: { $ne: article._id }, category: article.category, status: 'published', publishedAt: { $lte: new Date() } },
      LIST_FIELDS,
    ).sort({ publishedAt: -1 }).limit(3).lean();
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ article, related });
  } catch (err) {
    res.status(500).json({ error: 'Could not load article' });
  }
});

// POST /api/blog/generate — write one article now (super admin only)
router.post('/generate', authenticate, authorize('super_admin'), async (req, res) => {
  try {
    const a = await writeArticle(req.body?.topic ? [req.body.category || 'Guide', req.body.topic] : undefined);
    res.status(201).json({ ok: true, slug: a.slug, title: a.title });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
