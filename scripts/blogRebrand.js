// One-off: renames "AreaConnect" → "AreaConnector" (and areaconnect.pro →
// area-connector.com) in the visible text of existing articles. Slugs are left
// alone so links and search rankings keep working. Safe to re-run.
//   node scripts/blogRebrand.js          → dry run (counts only)
//   node scripts/blogRebrand.js --apply  → write changes
require('dotenv').config();
const mongoose = require('mongoose');
const Article = require('../models/Article');

const APPLY = process.argv.includes('--apply');
const fix = (s) => (typeof s === 'string'
  ? s.replace(/areaconnect\.pro/gi, 'area-connector.com').replace(/\bArea ?Connect\b/g, 'AreaConnector')
  : s);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const list = await Article.find({});
  let changed = 0;
  for (const a of list) {
    const before = JSON.stringify([a.title, a.excerpt, a.seoDescription, a.keywords, a.body, a.author, a.cover?.alt]);
    a.title = fix(a.title);
    a.excerpt = fix(a.excerpt);
    a.seoDescription = fix(a.seoDescription);
    a.keywords = (a.keywords || []).map(fix);
    a.author = fix(a.author);
    if (a.cover?.alt) a.cover.alt = fix(a.cover.alt);
    (a.body || []).forEach((b) => { b.text = fix(b.text); if (b.items) b.items = b.items.map(fix); });
    if (JSON.stringify([a.title, a.excerpt, a.seoDescription, a.keywords, a.body, a.author, a.cover?.alt]) === before) continue;
    changed++;
    console.log(`${APPLY ? '✓' : '·'} ${a.title}`);
    if (APPLY) await a.save();
  }
  console.log(`${APPLY ? 'updated' : 'would update'} ${changed}/${list.length} articles`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
