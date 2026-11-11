// AI blog writer: drafts one article per day with Gemini and publishes it to
// the landing-site blog. Each day goes to the solution (estates, universities,
// schools, hotels, industrial sites, hospitals) with the fewest articles.
// Topics come from data/blogTopics.js; once a sector's bank is used up Gemini
// proposes new ones for that sector that don't repeat existing titles.
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Article = require('../models/Article');
const TOPICS = require('../data/blogTopics');
const blogImages = require('./blogImages');

const MODEL = process.env.BLOG_MODEL || 'gemini-2.5-flash';
const CATEGORIES = ['Guide', 'Security', 'Payments', 'Community', 'Management', 'Product'];
const WAT_OFFSET_MS = 60 * 60_000;

// What AreaConnector actually does — the only product facts articles may state.
const PRODUCT_FACTS = `
AreaConnector is a visitor, security and payments platform built in Lagos, Nigeria (founded August 2026) for estates, universities and polytechnics, primary and secondary schools, hotels, industrial sites and offices, and hospitals. A site picks its type and the apps use its words (residents/units, students/hostel rooms or classes, guests/rooms, employees/departments, patients/wards) and switch on the right features. Three apps:
- AreaConnector Admin (web, for managers and administrators): members and units (CSV bulk invite), site type and modules, Google Maps site map with halls, buildings and gates, staff roles (doctors, nurses, lecturers, hall wardens, teachers, front desk, housekeeping, supervisors, safety officers) with alert routing, guard and porter management, payment schedules (service charge, school or hostel fees, bills) with Paystack collection, wallet with bank withdrawals, announcements with read receipts, live alerts, visitor oversight and blacklist, rules/constitution upload, analytics, in-app calls, multi-site on Enterprise.
- AreaMates (iOS, Android, web, for residents, students, parents, guests, employees, patients and next of kin): visitor passes with QR code and 6-digit code shareable on WhatsApp with Google Maps directions to the right building, instant passes, pass types (visitor, delivery, contractor, supplier, authorised school pickup, patient visit), paying bills and fees with Paystack (card, transfer, USSD) with invoices and receipts, SOS button (security, fire, medical), personal safety tools ("I'm being followed" silent alarm, live location sharing with security, gate watch), requests to staff (housekeeping, room service, repairs, call a nurse, sick bay, hostel repair), emergency roll-call ("I'm safe" / "I need help"), household or family accounts with limited access, in-app calls, group chat and direct messages, marketplace with escrow, community lounge (feed, stories, events, polls), push notifications.
- AreaConnector Guard (for security, porters and front desks): verify visitors by QR or 6-digit code, one-tap check-in/check-out, blacklist "access denied", panic alerts with a siren, offline mode with sync, entry log, deliveries and vehicle log, staff shift check, contractor safety induction at the gate, hospital and hostel visiting hours with a per-patient visitor limit (override needs a logged reason).
Sector specifics:
- Estates: residents, units and blocks, service charge and levies, dues enforcement (notice, grace period, then a pause of convenience services that lifts on payment), households.
- Universities and polytechnics: students and staff, halls and hostel rooms, hostel visiting hours, matric-number ID checks, campus map with directions to halls, hostel fees, hall wardens and porters.
- Schools (primary and secondary): parents and guardians linked to students, authorised pickup passes showing the student and class, staff shift check, school fees, sick bay requests.
- Hotels: guest stays from check-in to check-out (access and visitor passes end automatically), live room board, extend or end a stay, housekeeping and room-service requests.
- Industrial sites and offices: employees and departments, contractor and supplier passes with safety induction, deliveries and vehicle log, shift check, incident and hazard reporting, emergency roll-call.
- Hospitals: patients and staff, wards, patient-visit passes, visiting hours and visitor limits, care teams (doctors and nurses), call-a-nurse requests, admission and discharge dates.
- Nkechi: built-in AI assistant in the chat.
- Pricing: Starter ₦20,000/month (up to 50 members), Growth ₦47,000 (up to 200), Premium ₦80,000 (up to 500), Enterprise custom. Annual billing saves 20%. 14-day free trial.
`;

// Who each article is for. The writer rotates through these so every
// solution gets articles, using that sector's own words.
const SECTORS = {
  estate:     { name: 'estates',                       audience: 'Nigerian estate managers, residents\' associations, property managers and residents', words: 'estate, residents, units, service charge' },
  university: { name: 'universities and polytechnics', audience: 'Nigerian university and polytechnic administrators, student affairs, hall wardens, porters, campus security and students', words: 'campus, students, halls and hostel rooms, hostel fees' },
  school:     { name: 'primary and secondary schools', audience: 'Nigerian school owners, administrators, teachers, gate security and parents', words: 'school, students, classes, parents and guardians, school fees' },
  hotel:      { name: 'hotels',                        audience: 'Nigerian hotel owners, general managers, front desk, security and housekeeping teams', words: 'property, guests, rooms, front desk' },
  industrial: { name: 'industrial sites and offices',  audience: 'Nigerian facility managers, HSE and safety officers, HR and site security at factories, plants, warehouses and offices', words: 'site, employees, departments, contractors' },
  hospital:   { name: 'hospitals',                     audience: 'Nigerian hospital administrators, nurses, security and patients\' families', words: 'hospital, patients and staff, wards, visiting hours' },
};
const SECTOR_KEYS = Object.keys(SECTORS);

const RULES = (sector) => `
Rules:
- Audience: ${SECTORS[sector].audience}. Use their words (${SECTORS[sector].words}). Use Nigerian context (Lagos, Abuja, Port Harcourt, naira, Paystack, PHCN/generators, okada/dispatch riders) naturally.
- Write for ${SECTORS[sector].name}; only mention features that apply to them.
- Be genuinely useful and practical: concrete steps, checklists, templates, examples.
- NEVER invent statistics, survey results, percentages, studies, quotes, named people, named organisations, case studies or customer stories. If you use an example, make it clearly hypothetical ("Imagine a hospital with 120 beds...").
- Do NOT claim how many sites or users AreaConnector has, and don't make claims about AreaConnector beyond the product facts given.
- Mention AreaConnector only where it genuinely fits (usually 1–3 times, plus a short closing paragraph). The article must stand on its own as helpful advice.
- No legal, medical or financial guarantees; suggest consulting a professional where appropriate.
- British/Nigerian English spelling. Warm, clear, confident tone. No hype, no emojis.
- 900–1,300 words in the body.
`;

const SCHEMA_HINT = `
Return ONLY a JSON object with this exact shape:
{
  "title": string (max 75 chars, no clickbait),
  "excerpt": string (1–2 sentences, max 200 chars),
  "seoDescription": string (150–160 chars),
  "keywords": string[] (4–8 lowercase search phrases),
  "readMinutes": number,
  "body": [ { "type": "p" | "h2" | "h3" | "quote" | "tip", "text": string } | { "type": "ul" | "ol", "items": string[] } ]
}
Body guidance: lists are flat — every list item is a complete point, never a sub-heading like "For residents:" (use an "h3" for that instead). Titles use sentence case. Open with 1–2 "p" paragraphs, then 4–7 "h2" sections each with paragraphs and at least two lists in the article, one "tip" callout, and a final "h2" conclusion. Use **double asterisks** for bold inside text. No markdown headings inside text, no HTML.
`;

let client;
function model() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  client = client || new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return client.getGenerativeModel({
    model: MODEL,
    generationConfig: { responseMimeType: 'application/json', temperature: 0.8 },
  });
}

const slugify = (s) => s.toLowerCase()
  .replace(/[’'"]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80);

const topicKey = (title) => slugify(title);

// Cut at a word boundary so meta descriptions never end mid-word.
const trimWords = (s, max) => (s.length <= max ? s : `${s.slice(0, max).replace(/\s+\S*$/, '')}…`);

function clean(article, category) {
  const blocks = (Array.isArray(article.body) ? article.body : [])
    .map((b) => {
      if (!b || !b.type) return null;
      if (b.type === 'ul' || b.type === 'ol') {
        const items = (b.items || []).map(String).map((s) => s.trim())
          .filter((s) => s && !/^\*{0,2}[^*]{1,40}:\*{0,2}$/.test(s));
        return items.length ? { type: b.type, items } : null;
      }
      if (!['p', 'h2', 'h3', 'quote', 'tip'].includes(b.type)) return null;
      const text = String(b.text || '').trim();
      return text ? { type: b.type, text } : null;
    })
    .filter(Boolean);
  if (blocks.length < 6) throw new Error('Article body too short');
  const words = blocks.reduce((n, b) => n + (b.text || (b.items || []).join(' ')).split(/\s+/).length, 0);
  return {
    title: String(article.title || '').trim().slice(0, 120),
    excerpt: String(article.excerpt || '').trim().slice(0, 300),
    seoDescription: trimWords(String(article.seoDescription || article.excerpt || '').trim(), 160),
    keywords: (article.keywords || []).map(String).slice(0, 10),
    readMinutes: Math.max(3, Math.round(words / 220)),
    category,
    body: blocks,
  };
}

async function draft(category, topic, sector = 'estate') {
  const prompt = `You are the editor of the AreaConnector blog.\n${PRODUCT_FACTS}\n${RULES(sector)}\nWrite an article in the "${category}" category on this topic:\n"${topic}"\n${SCHEMA_HINT}`;
  const res = await model().generateContent(prompt);
  const text = res.response.text().trim().replace(/^```json\s*|```$/g, '');
  return clean(JSON.parse(text), category);
}

async function uniqueSlug(title) {
  const base = slugify(title) || `article-${Date.now()}`;
  let slug = base;
  for (let i = 2; await Article.exists({ slug }); i++) slug = `${base}-${i}`;
  return slug;
}

// Ask Gemini for new topic ideas for one sector once its bank is used up.
async function freshTopics(sector, n = 10) {
  const existing = (await Article.find({}, 'title').sort({ publishedAt: -1 }).limit(300).lean()).map((a) => a.title);
  const S = SECTORS[sector];
  const prompt = `${PRODUCT_FACTS}\nSuggest ${n} new, specific, genuinely useful blog article topics for ${S.audience}, about running ${S.name} in Nigeria and related to what AreaConnector offers them. Use their words (${S.words}). Spread them across these categories: ${CATEGORIES.join(', ')}. Do not repeat or closely paraphrase any of these existing titles:\n${existing.map((t) => `- ${t}`).join('\n')}\nReturn ONLY JSON: [{"category": string, "topic": string}]`;
  const res = await model().generateContent(prompt);
  const list = JSON.parse(res.response.text().trim().replace(/^```json\s*|```$/g, ''));
  return list.filter((t) => CATEGORIES.includes(t.category) && t.topic).map((t) => [t.category, t.topic, sector]);
}

// The sector covered least recently goes next, so the blog rotates evenly
// through every solution (estates included) one day at a time.
async function nextSector() {
  const latest = Object.fromEntries((await Article.aggregate([
    { $group: { _id: { $ifNull: ['$sector', 'estate'] }, last: { $max: '$publishedAt' } } },
  ])).map((x) => [x._id, new Date(x.last).getTime()]));
  return SECTOR_KEYS.reduce((best, k) => ((latest[k] || 0) < (latest[best] || 0) ? k : best), SECTOR_KEYS[0]);
}

async function nextTopic() {
  const used = new Set((await Article.find({}, 'topicKey').lean()).map((a) => a.topicKey));
  const sector = await nextSector();
  const fromBank = TOPICS.find(([, t, sec = 'estate']) => sec === sector && !used.has(topicKey(t)));
  if (fromBank) return [fromBank[0], fromBank[1], sector];
  const ideas = await freshTopics(sector);
  return ideas.find(([, t]) => !used.has(topicKey(t))) || null;
}

// Finds a fitting stock photo, stores it in GridFS and saves it on the article.
// Never fails the article: without a photo the site shows its fallback cover.
async function attachCover(article) {
  if (!blogImages.isConfigured() || article.cover?.url) return article;
  try {
    const usedIds = new Set((await Article.find({ 'cover.pexelsId': { $ne: '' } }, 'cover.pexelsId').lean()).map((x) => x.cover.pexelsId));
    const cover = await blogImages.coverFor({ title: article.title, excerpt: article.excerpt, sector: article.sector, usedIds, slug: article.slug });
    if (cover) { article.cover = cover; await article.save(); }
  } catch (err) {
    console.warn(`[blog] cover photo failed for "${article.title}": ${err.message}`);
  }
  return article;
}

/** Writes and publishes one article. `topic` is optional ([category, title]). */
async function writeArticle(topic, { publishedAt = new Date() } = {}) {
  const [category, title, sector = 'estate'] = topic || (await nextTopic()) || [];
  if (!title) throw new Error('No topic available');
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const a = await draft(category, title, sector);
      const created = await Article.create({ ...a, slug: await uniqueSlug(a.title), topicKey: topicKey(title), sector, publishedAt });
      await attachCover(created);
      return created;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 4000 * attempt));
    }
  }
  throw lastErr;
}

// ── Daily scheduler ────────────────────────────────────────────────────────
// Checks hourly; publishes one article if none has been published today (WAT)
// and it's past 7am WAT. Idempotent across restarts.
let timer = null;
let running = false;

const watDayStart = (d = new Date()) => {
  const wat = new Date(d.getTime() + WAT_OFFSET_MS);
  return new Date(Date.UTC(wat.getUTCFullYear(), wat.getUTCMonth(), wat.getUTCDate()) - WAT_OFFSET_MS);
};

async function tick() {
  if (running || process.env.BLOG_AUTOPUBLISH === 'off') return;
  const now = new Date();
  const watHour = new Date(now.getTime() + WAT_OFFSET_MS).getUTCHours();
  if (watHour < 7) return;
  if (await Article.exists({ source: 'gemini', publishedAt: { $gte: watDayStart(now) } })) return;
  running = true;
  try {
    const a = await writeArticle();
    console.log(`[blog] published "${a.title}"`);
  } catch (err) {
    console.error('[blog] daily article failed:', err.message);
  } finally {
    running = false;
  }
}

function startBlogWriter({ intervalMs = 60 * 60_000 } = {}) {
  if (timer || !process.env.GEMINI_API_KEY) return;
  setTimeout(() => tick().catch(() => {}), 60_000);
  timer = setInterval(() => tick().catch(() => {}), intervalMs);
  console.log('[blog] daily AI writer started');
}

module.exports = { writeArticle, attachCover, startBlogWriter, TOPICS, topicKey, SECTORS };
