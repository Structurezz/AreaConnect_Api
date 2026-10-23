// Builds Nkechi's per-estate briefing: what she "knows" about an estate when
// she joins its group chat — the estate itself, its constitution, what's
// trending on the Lounge feed, events, polls, announcements, marketplace,
// public court cases and dues schedules.
//
// Everything here is visible to every resident of the estate already. Never
// add private data (individual debts, phone numbers, DMs, security incident
// details, private court cases) — Nkechi talks in a group chat.
const Estate = require('../models/Estate');
const User = require('../models/User');
const Unit = require('../models/Unit');
const Post = require('../models/Post');
const Event = require('../models/Event');
const Poll = require('../models/Poll');
const Announcement = require('../models/Announcement');
const MarketplaceListing = require('../models/MarketplaceListing');
const Case = require('../models/Case');
const PaymentSchedule = require('../models/PaymentSchedule');

const CACHE_MS = 5 * 60_000;
const CONSTITUTION_CHARS = 60_000; // ~15k tokens — the whole document for nearly every estate
const cache = new Map(); // estateId → { at, text }

const DAY = 86_400_000;
const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const day = (d) => new Date(d).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
const ago = (d) => {
  const h = Math.round((Date.now() - new Date(d)) / 3_600_000);
  return h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};
const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const first = (name) => String(name || 'Someone').split(' ')[0];

async function buildBriefing(estateId) {
  const now = new Date();
  const weekAgo = new Date(now - 7 * DAY);

  const [estate, residents, guards, units, posts, events, polls, announcements, listings, cases, dues] = await Promise.all([
    Estate.findById(estateId).select('name address estateCode managerId location constitution createdAt').populate('managerId', 'name').lean(),
    User.countDocuments({ estateId, role: 'resident', isActive: true }),
    User.countDocuments({ estateId, role: 'security', isActive: true }),
    Unit.countDocuments({ estateId }),
    Post.find({ estateId, kind: { $ne: 'story' }, createdAt: { $gte: new Date(now - 14 * DAY) } })
      .sort({ createdAt: -1 }).limit(60).populate('author', 'name').lean(),
    Event.find({ estateId, isActive: { $ne: false }, date: { $gte: new Date(now - DAY) } }).sort({ date: 1 }).limit(6).lean(),
    Poll.find({ estateId, isActive: { $ne: false }, $or: [{ endsAt: null }, { endsAt: { $gte: now } }] }).sort({ createdAt: -1 }).limit(5).lean(),
    Announcement.find({ estateId }).sort({ isPinned: -1, createdAt: -1 }).limit(6).lean(),
    MarketplaceListing.find({ estateId, status: 'active' }).sort({ createdAt: -1 }).limit(8).lean(),
    Case.find({ estateId, isPublic: true }).sort({ filedAt: -1 }).limit(5)
      .select('caseNumber title type status plaintiff.name defendant.name defendant.isEstate verdict.decision verdict.fine filedAt').lean(),
    PaymentSchedule.find({ estateId, isActive: { $ne: false } }).sort({ createdAt: -1 }).limit(6).lean(),
  ]);
  if (!estate) return '';

  const lines = [];
  lines.push(`ESTATE: ${estate.name}${estate.address ? ` — ${estate.address}` : ''}`);
  lines.push(`Estate manager: ${estate.managerId?.name || 'not set'} · ${residents} active residents · ${units} units · ${guards} security staff · on AreaConnect since ${day(estate.createdAt)}`);

  // Lounge feed — what's hot this week (engagement-ranked), then what's newest
  const score = (p) => (p.likes?.length || 0) + 2 * (p.comments?.length || 0);
  const thisWeek = posts.filter(p => new Date(p.createdAt) >= weekAgo);
  const trending = [...thisWeek].sort((a, b) => score(b) - score(a)).filter(p => score(p) > 0).slice(0, 6);
  const fresh = posts.filter(p => !trending.includes(p)).slice(0, 6);
  const postLine = (p) => {
    const topComment = p.comments?.length ? ` | latest comment: "${clip(p.comments[p.comments.length - 1].text, 80)}"` : '';
    return `- ${first(p.author?.name)} (${ago(p.createdAt)}): "${clip(p.content || (p.images?.length ? '[shared a photo]' : ''), 160)}" — ${p.likes?.length || 0} likes, ${p.comments?.length || 0} comments${topComment}`;
  };
  lines.push('');
  lines.push(`LOUNGE FEED — ${thisWeek.length} posts in the last 7 days`);
  if (trending.length) { lines.push('Trending this week:'); trending.forEach(p => lines.push(postLine(p))); }
  if (fresh.length) { lines.push('Newest posts:'); fresh.forEach(p => lines.push(postLine(p))); }
  if (!posts.length) lines.push('- Quiet — nobody has posted in the last two weeks.');

  if (events.length) {
    lines.push('', 'UPCOMING EVENTS');
    events.forEach(e => lines.push(`- ${e.title} — ${day(e.date)}${e.time ? ` ${e.time}` : ''}${e.location ? ` at ${e.location}` : ''}${e.isFridayFunTimes ? ' (Friday Night FunTimes)' : ''} · ${e.rsvps?.length || 0} going${e.description ? ` · ${clip(e.description, 100)}` : ''}`));
  }

  if (polls.length) {
    lines.push('', 'LIVE POLLS');
    polls.forEach(p => {
      const total = p.options.reduce((n, o) => n + (o.votes?.length || 0), 0);
      const opts = p.options.map(o => `${o.text} ${total ? Math.round(100 * (o.votes?.length || 0) / total) : 0}%`).join(', ');
      lines.push(`- "${p.question}" — ${total} votes: ${opts}${p.endsAt ? ` (closes ${day(p.endsAt)})` : ''}`);
    });
  }

  if (announcements.length) {
    lines.push('', 'RECENT ANNOUNCEMENTS FROM MANAGEMENT');
    announcements.forEach(a => lines.push(`- ${a.isPinned ? '[pinned] ' : ''}${a.title} (${ago(a.createdAt)}): ${clip(a.body, 180)}`));
  }

  if (dues.length) {
    lines.push('', 'ESTATE DUES & LEVIES');
    dues.forEach(d => lines.push(`- ${d.title}: ${naira(d.amount)}${d.frequency ? ` ${String(d.frequency).replace(/_/g, ' ')}` : ''}${d.dueDate ? `, due ${day(d.dueDate)}` : ''}`));
  }

  if (listings.length) {
    lines.push('', 'MARKETPLACE — newest listings');
    listings.forEach(l => lines.push(`- ${clip(l.title, 60)} — ${naira(l.price)}${l.isNegotiable ? ' (negotiable)' : ''}${l.condition ? `, ${l.condition}` : ''}`));
  }

  if (cases.length) {
    lines.push('', 'ESTATE COURTROOM — public cases');
    cases.forEach(c => {
      const vs = `${first(c.plaintiff?.name)} vs ${c.defendant?.isEstate ? 'the estate' : first(c.defendant?.name)}`;
      const outcome = c.verdict?.decision ? ` · verdict: ${c.verdict.decision.replace('_', ' ')}${c.verdict.fine ? `, fine ${naira(c.verdict.fine)}` : ''}` : '';
      lines.push(`- ${c.caseNumber || ''} ${clip(c.title, 70)} (${vs}) — ${String(c.status).replace(/_/g, ' ')}${outcome}`);
    });
  }

  const constitution = estate.constitution?.extractedText?.trim();
  lines.push('');
  if (constitution) {
    lines.push(`ESTATE CONSTITUTION (${estate.constitution.fileName || 'uploaded by management'}):`);
    lines.push(constitution.length > CONSTITUTION_CHARS ? `${constitution.slice(0, CONSTITUTION_CHARS)}\n[…constitution continues]` : constitution);
  } else {
    lines.push('ESTATE CONSTITUTION: not uploaded yet — management can add it under Settings.');
  }

  return lines.join('\n');
}

// Cached per estate so a busy chat doesn't rebuild it on every message
async function getEstateBriefing(estateId) {
  const key = String(estateId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.text;
  try {
    const text = await buildBriefing(estateId);
    cache.set(key, { at: Date.now(), text });
    return text;
  } catch (err) {
    console.error('[Nkechi] briefing failed:', err.message);
    return hit?.text || '';
  }
}

module.exports = { getEstateBriefing, buildBriefing };
