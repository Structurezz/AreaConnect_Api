// Adds a GridFS cover photo (Pixabay or Pexels) to every published article
// that doesn't have one yet. Safe to re-run.
//   PIXABAY_API_KEY=… node scripts/blogCovers.js       → all missing
//   node scripts/blogCovers.js 10                       → at most 10
require('dotenv').config();
const mongoose = require('mongoose');
const Article = require('../models/Article');
const { attachCover } = require('../services/blogWriter');
const blogImages = require('../services/blogImages');

const LIMIT = Number(process.argv[2]) || 0;

(async () => {
  if (!blogImages.isConfigured()) { console.error('Set PIXABAY_API_KEY (or PEXELS_API_KEY) first.'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI);
  const q = Article.find({ status: 'published', $or: [{ 'cover.url': { $exists: false } }, { 'cover.url': '' }] }).sort({ publishedAt: -1 });
  if (LIMIT) q.limit(LIMIT);
  const list = await q;
  console.log(`[covers] ${list.length} articles need a photo`);
  let ok = 0;
  for (const [i, a] of list.entries()) {
    await attachCover(a); // sequential so the "no repeats" check sees earlier picks
    if (a.cover?.url) { ok++; console.log(`✓ ${i + 1}/${list.length} [${a.sector || 'estate'}] ${a.title} — "${a.cover.query}" by ${a.cover.photographer}`); }
    else console.log(`✗ ${i + 1}/${list.length} ${a.title}`);
  }
  console.log(`[covers] done: ${ok}/${list.length}`);
  await mongoose.disconnect();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
