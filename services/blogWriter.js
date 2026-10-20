// AI blog writer: drafts one article per day with Gemini and publishes it to
// the landing-site blog. Topics come from data/blogTopics.js; once that bank is
// used up Gemini proposes new ones that don't repeat existing titles.
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Article = require('../models/Article');
const TOPICS = require('../data/blogTopics');

const MODEL = process.env.BLOG_MODEL || 'gemini-2.5-flash';
const CATEGORIES = ['Guide', 'Security', 'Payments', 'Community', 'Management', 'Product'];
const WAT_OFFSET_MS = 60 * 60_000;

// What AreaConnect actually does — the only product facts articles may state.
const PRODUCT_FACTS = `
AreaConnect is an estate management platform built in Lagos, Nigeria (founded August 2026), with three apps:
- AreaConnect Admin (web, for estate managers): residents and units (CSV bulk invite), guard management, payment schedules and levies, Paystack collection, estate wallet with bank withdrawals, announcements with read receipts, live alerts, visitor oversight and blacklist, estate constitution upload, analytics, in-app calls, multi-estate on Enterprise.
- AreaMates (iOS, Android, web, for residents): visitor passes with QR code and 6-digit code shareable on WhatsApp, instant passes, approving early arrivals, cancelling passes, paying dues with Paystack (card, transfer, USSD) with invoices and receipts, SOS panic button (security, fire, medical), personal safety tools ("I'm being followed" silent alarm to staff, live location sharing with security for up to 1 hour, silent safety blocks, gate watch), in-app voice calls to the gate, neighbours and manager, "buzz a neighbour", estate group chat and direct messages, marketplace with escrow checkout and seller wallets, community lounge (feed, 24-hour stories, events and RSVP, polls, community DJ queue, radio), push notifications.
- AreaConnect Guard (Android/iOS, for security): verify visitors by typing their 6-digit code, one-tap check-in/check-out, blacklist "access denied", panic alerts with a siren, acknowledge/resolve alerts, offline mode with sync, entry log, incident escalation.
- Nkechi: built-in AI assistant in the estate chat.
- Pricing: Starter ₦20,000/month (up to 50 residents), Growth ₦47,000 (up to 200), Premium ₦80,000 (up to 500), Enterprise custom. Annual billing saves 20%. 14-day free trial.
`;

const RULES = `
Rules:
- Audience: Nigerian estate managers, residents' associations, property managers and residents. Use Nigerian context (Lagos, Abuja, naira, Paystack, PHCN/generators, okada/dispatch riders) naturally.
- Be genuinely useful and practical: concrete steps, checklists, templates, examples.
- NEVER invent statistics, survey results, percentages, studies, quotes, named people, named estates, case studies or customer stories. If you use an example, make it clearly hypothetical ("Imagine an estate with 120 units...").
- Do NOT claim how many estates or users AreaConnect has, and don't make claims about AreaConnect beyond the product facts given.
- Mention AreaConnect only where it genuinely fits (usually 1–3 times, plus a short closing paragraph). The article must stand on its own as helpful advice.
- No legal or financial guarantees; suggest consulting a professional where appropriate.
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

async function draft(category, topic) {
  const prompt = `You are the editor of the AreaConnect blog.\n${PRODUCT_FACTS}\n${RULES}\nWrite an article in the "${category}" category on this topic:\n"${topic}"\n${SCHEMA_HINT}`;
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

// Ask Gemini for new topic ideas once the bank is exhausted.
async function freshTopics(n = 10) {
  const existing = (await Article.find({}, 'title').sort({ publishedAt: -1 }).limit(300).lean()).map((a) => a.title);
  const prompt = `${PRODUCT_FACTS}\nSuggest ${n} new, specific, genuinely useful blog article topics for Nigerian estate managers and residents, related to what AreaConnect offers. Spread them across these categories: ${CATEGORIES.join(', ')}. Do not repeat or closely paraphrase any of these existing titles:\n${existing.map((t) => `- ${t}`).join('\n')}\nReturn ONLY JSON: [{"category": string, "topic": string}]`;
  const res = await model().generateContent(prompt);
  const list = JSON.parse(res.response.text().trim().replace(/^```json\s*|```$/g, ''));
  return list.filter((t) => CATEGORIES.includes(t.category) && t.topic).map((t) => [t.category, t.topic]);
}

async function nextTopic() {
  const used = new Set((await Article.find({}, 'topicKey').lean()).map((a) => a.topicKey));
  const fromBank = TOPICS.find(([, t]) => !used.has(topicKey(t)));
  if (fromBank) return fromBank;
  const ideas = await freshTopics();
  return ideas.find(([, t]) => !used.has(topicKey(t))) || null;
}

/** Writes and publishes one article. `topic` is optional ([category, title]). */
async function writeArticle(topic, { publishedAt = new Date() } = {}) {
  const [category, title] = topic || (await nextTopic()) || [];
  if (!title) throw new Error('No topic available');
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const a = await draft(category, title);
      return await Article.create({ ...a, slug: await uniqueSlug(a.title), topicKey: topicKey(title), publishedAt });
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

module.exports = { writeArticle, startBlogWriter, TOPICS, topicKey };
