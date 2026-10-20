// Seed the blog with AI-written articles from the topic bank.
//   node scripts/seedBlog.js            → writes up to 100 new articles
//   node scripts/seedBlog.js 20         → writes up to 20
// Safe to re-run: topics that already have an article are skipped.
require('dotenv').config();
const mongoose = require('mongoose');
const Article = require('../models/Article');
const { writeArticle, TOPICS, topicKey } = require('../services/blogWriter');

const TARGET = Number(process.argv[2]) || 100;
const CONCURRENCY = 4;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const done = new Set((await Article.find({}, 'topicKey').lean()).map((a) => a.topicKey));
  const queue = TOPICS.filter(([, t]) => !done.has(topicKey(t))).slice(0, TARGET);
  console.log(`[seed] ${done.size} existing, writing ${queue.length}`);

  const start = Date.now();
  let ok = 0, failed = 0, i = 0;
  // Stagger publishedAt a minute apart so the bank's order is the reading order.
  const base = Date.now();
  async function worker() {
    while (i < queue.length) {
      const idx = i++;
      const topic = queue[idx];
      try {
        const a = await writeArticle(topic, { publishedAt: new Date(base - idx * 60_000) });
        ok++;
        console.log(`[seed] ${ok + failed}/${queue.length} ✓ ${a.category.padEnd(10)} ${a.title}`);
      } catch (err) {
        failed++;
        console.log(`[seed] ${ok + failed}/${queue.length} ✗ ${topic[1]} — ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`[seed] done: ${ok} written, ${failed} failed in ${((Date.now() - start) / 60000).toFixed(1)} min`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
