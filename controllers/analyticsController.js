const crypto = require('crypto');
const axios = require('axios');
const SiteVisit = require('../models/SiteVisit');

const DAY_MS = 86_400_000;
const SALT = process.env.ANALYTICS_IP_SALT || 'areaconnect-visitor-salt-v1';
const hashIp = (ip) => crypto.createHmac('sha256', SALT).update(String(ip || '')).digest('hex').slice(0, 24);

// ── Best-effort device/browser parser (zero deps) ─────────────────────────
function parseUA(ua = '') {
  const lc = ua.toLowerCase();
  const isMobile = /mobi|android|iphone|ipad|ipod/i.test(ua);
  const isTablet = /tablet|ipad/i.test(ua);
  const device = isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop';
  let browser = 'Other';
  if (lc.includes('edg/')) browser = 'Edge';
  else if (lc.includes('chrome/')) browser = 'Chrome';
  else if (lc.includes('firefox/')) browser = 'Firefox';
  else if (lc.includes('safari/')) browser = 'Safari';
  else if (lc.includes('opr/') || lc.includes('opera/')) browser = 'Opera';
  else if (lc.includes('samsungbrowser/')) browser = 'Samsung';
  let os = 'Other';
  if (lc.includes('windows')) os = 'Windows';
  else if (lc.includes('android')) os = 'Android';
  else if (lc.includes('iphone') || lc.includes('ipad') || lc.includes('ipod')) os = 'iOS';
  else if (lc.includes('mac os') || lc.includes('macintosh')) os = 'macOS';
  else if (lc.includes('linux')) os = 'Linux';
  return { device, browser, os, isMobile };
}

// Crawlers, link previewers, SEO tools and headless browsers. They make up
// most raw traffic and nearly all of it geolocates to US datacenters
// (Ashburn, Sterling…), which skewed the country report.
const BOT_PATTERN = 'bot|crawl|spider|slurp|facebookexternalhit|meta-|headless|lighthouse|pagespeed|preview|python|curl|wget|axios|node-fetch|go-http|java/|okhttp|phantom|puppeteer|playwright|selenium|semrush|ahrefs|mj12|dataprovider|petal|yandex|baidu|applebot|uptime|monitor|scanner|scrapy|httpclient';
const BOT_RE = new RegExp(BOT_PATTERN, 'i');
// 2000x2000 / 0x0 screens come from headless scanners posing as Chrome
const isBotVisit = (ua, screen) => !ua || BOT_RE.test(ua) || screen === '2000x2000' || screen === '0x0';

// Older rows were saved before bot tagging — tag them once per process.
let backfill = null;
const ensureBackfill = () => {
  if (!backfill) {
    backfill = SiteVisit.updateMany(
      { isBot: { $exists: false } },
      [{
        $set: {
          isBot: {
            $or: [
              { $eq: ['$userAgent', ''] },
              { $regexMatch: { input: '$userAgent', regex: BOT_PATTERN, options: 'i' } },
              { $in: ['$screen', ['2000x2000', '0x0']] },
            ],
          },
        },
      }],
    ).catch((err) => { backfill = null; console.error('[analytics backfill]', err.message); });
  }
  return backfill;
};

// Reports hide bots unless ?bots=1
const humanFilter = (req) => (req.query.bots === '1' ? {} : { isBot: { $ne: true } });

// Resolve IP → country/city asynchronously. ip-api.com free tier allows 45
// requests/minute from one IP. Failures are logged and swallowed so the
// absence of geo data never breaks the pageview.
async function resolveGeo(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1') return null;
  try {
    const { data } = await axios.get(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,isp,proxy,hosting`,
      { timeout: 2500 },
    );
    if (data?.status !== 'success') return null;
    return {
      country:     data.country     || '',
      countryCode: data.countryCode || '',
      region:      data.regionName  || '',
      city:        data.city        || '',
      isp:         data.isp         || '',
      proxy:       !!data.proxy,
      hosting:     !!data.hosting,
    };
  } catch {
    return null;
  }
}

const clientIp = (req) => {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || '';
};

// ── POST /api/analytics/visit — public beacon from landing ──────────────
exports.logVisit = async (req, res) => {
  try {
    const b = req.body || {};
    const ip = clientIp(req);
    const uaString = req.headers['user-agent'] || '';
    const { device, browser, os, isMobile } = parseUA(uaString);
    const screen = String(b.screen || '').slice(0, 20);
    const isBot = isBotVisit(uaString, screen);

    const doc = {
      path:      String(b.path || '/').slice(0, 500),
      referrer:  String(b.referrer || '').slice(0, 500),
      utm: {
        source:   String(b.utm?.source   || '').slice(0, 100),
        medium:   String(b.utm?.medium   || '').slice(0, 100),
        campaign: String(b.utm?.campaign || '').slice(0, 100),
        term:     String(b.utm?.term     || '').slice(0, 100),
        content:  String(b.utm?.content  || '').slice(0, 100),
      },
      userAgent: uaString.slice(0, 500),
      language:  String(b.language || '').slice(0, 20),
      timezone:  String(b.timezone || '').slice(0, 80),
      screen,
      isBot,
      isMobile,
      device,
      browser,
      os,
      sessionId: String(b.sessionId || '').slice(0, 60),
      ipHash:    hashIp(ip),
      visitedAt: new Date(),
    };

    const visit = await SiteVisit.create(doc);

    // Async geo enrichment — don't make the client wait
    // Bots are skipped to save ip-api's 45/min quota for real visitors.
    if (!isBot) resolveGeo(ip).then((geo) => {
      if (geo) {
        return SiteVisit.updateOne({ _id: visit._id }, { $set: geo }).catch(() => {});
      }
    });

    return res.status(204).end();
  } catch (err) {
    console.error('[logVisit]', err.message);
    // Beacon failures must never surface to the user
    return res.status(204).end();
  }
};

// ── GET /api/analytics/visitors/stats — super admin ──────────────────────
exports.getStats = async (req, res) => {
  try {
    await ensureBackfill();
    const H = humanFilter(req);
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(now.getTime() - 7 * DAY_MS);
    const startOfMonth = new Date(now.getTime() - 30 * DAY_MS);

    const [
      totalVisits,
      visitsToday,
      visitsWeek,
      visitsMonth,
      uniqueToday,
      uniqueWeek,
      uniqueMonth,
      uniqueTotal,
      topPages,
      topReferrers,
      topCountries,
      bySource,
      byDevice,
      byBrowser,
      byDay,
      botVisitsMonth,
    ] = await Promise.all([
      SiteVisit.countDocuments(H),
      SiteVisit.countDocuments({ ...H, visitedAt: { $gte: startOfDay } }),
      SiteVisit.countDocuments({ ...H, visitedAt: { $gte: startOfWeek } }),
      SiteVisit.countDocuments({ ...H, visitedAt: { $gte: startOfMonth } }),

      SiteVisit.distinct('ipHash', { ...H, visitedAt: { $gte: startOfDay } }).then(a => a.length),
      SiteVisit.distinct('ipHash', { ...H, visitedAt: { $gte: startOfWeek } }).then(a => a.length),
      SiteVisit.distinct('ipHash', { ...H, visitedAt: { $gte: startOfMonth } }).then(a => a.length),
      SiteVisit.distinct('ipHash', H).then(a => a.length),

      SiteVisit.aggregate([
        { $match: { ...H, visitedAt: { $gte: startOfMonth } } },
        { $group: { _id: '$path', count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 10 },
        { $project: { _id: 0, path: '$_id', count: 1 } },
      ]),

      SiteVisit.aggregate([
        { $match: { ...H, visitedAt: { $gte: startOfMonth }, referrer: { $ne: '' } } },
        {
          $addFields: {
            host: {
              $let: {
                vars: { stripped: { $replaceAll: { input: { $replaceAll: { input: '$referrer', find: 'https://', replacement: '' } }, find: 'http://', replacement: '' } } },
                in:   { $arrayElemAt: [{ $split: ['$$stripped', '/'] }, 0] },
              },
            },
          },
        },
        { $group: { _id: '$host', count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 10 },
        { $project: { _id: 0, host: '$_id', count: 1 } },
      ]),

      SiteVisit.aggregate([
        { $match: { ...H, visitedAt: { $gte: startOfMonth }, country: { $ne: '' } } },
        { $group: { _id: '$country', countryCode: { $first: '$countryCode' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 10 },
        { $project: { _id: 0, country: '$_id', countryCode: 1, count: 1 } },
      ]),

      SiteVisit.aggregate([
        { $match: { ...H, visitedAt: { $gte: startOfMonth }, 'utm.source': { $ne: '' } } },
        { $group: { _id: { source: '$utm.source', medium: '$utm.medium' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 10 },
        { $project: { _id: 0, source: '$_id.source', medium: '$_id.medium', count: 1 } },
      ]),

      SiteVisit.aggregate([
        { $match: { ...H, visitedAt: { $gte: startOfMonth } } },
        { $group: { _id: '$device', count: { $sum: 1 } } },
        { $project: { _id: 0, device: '$_id', count: 1 } },
      ]),

      SiteVisit.aggregate([
        { $match: { ...H, visitedAt: { $gte: startOfMonth } } },
        { $group: { _id: '$browser', count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 6 },
        { $project: { _id: 0, browser: '$_id', count: 1 } },
      ]),

      // Last 14 days of counts for a sparkline
      SiteVisit.aggregate([
        { $match: { ...H, visitedAt: { $gte: new Date(now.getTime() - 14 * DAY_MS) } } },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$visitedAt', timezone: 'Africa/Lagos' },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, day: '$_id', count: 1 } },
      ]),

      SiteVisit.countDocuments({ isBot: true, visitedAt: { $gte: startOfMonth } }),
    ]);

    return res.json({
      success: true,
      data: {
        totals: { all: totalVisits, today: visitsToday, week: visitsWeek, month: visitsMonth },
        unique: { all: uniqueTotal, today: uniqueToday, week: uniqueWeek, month: uniqueMonth },
        topPages, topReferrers, topCountries, bySource, byDevice, byBrowser, byDay,
        bots: { month: botVisitsMonth },
      },
    });
  } catch (err) {
    console.error('[getStats]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── GET /api/analytics/visitors/recent — super admin ─────────────────────
exports.getRecent = async (req, res) => {
  try {
    await ensureBackfill();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const visits = await SiteVisit.find(humanFilter(req))
      .sort({ visitedAt: -1 })
      .limit(limit)
      .select('path referrer utm country countryCode city region isp proxy hosting isBot device browser os language timezone screen userAgent visitedAt ipHash sessionId');
    return res.json({ success: true, data: visits });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── GET /api/analytics/visitors/people — super admin ─────────────────────
// One row per visitor (hashed IP) with their journey through the site.
exports.getPeople = async (req, res) => {
  try {
    await ensureBackfill();
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const limit = Math.min(Number(req.query.limit) || 100, 300);
    const since = new Date(Date.now() - days * DAY_MS);

    const people = await SiteVisit.aggregate([
      { $match: { ...humanFilter(req), visitedAt: { $gte: since } } },
      { $sort: { visitedAt: 1 } },
      {
        $group: {
          _id: '$ipHash',
          visits:    { $sum: 1 },
          sessions:  { $addToSet: '$sessionId' },
          firstSeen: { $first: '$visitedAt' },
          lastSeen:  { $last: '$visitedAt' },
          firstReferrer: { $first: '$referrer' },
          utmSource:   { $max: '$utm.source' },
          utmCampaign: { $max: '$utm.campaign' },
          country:     { $last: '$country' },
          countryCode: { $last: '$countryCode' },
          region:      { $last: '$region' },
          city:        { $last: '$city' },
          isp:         { $last: '$isp' },
          proxy:       { $max: '$proxy' },
          hosting:     { $max: '$hosting' },
          isBot:       { $max: '$isBot' },
          timezone:    { $last: '$timezone' },
          language:    { $last: '$language' },
          device:      { $last: '$device' },
          browser:     { $last: '$browser' },
          os:          { $last: '$os' },
          screen:      { $last: '$screen' },
          pages:       { $push: { path: '$path', at: '$visitedAt', sessionId: '$sessionId' } },
        },
      },
      { $sort: { lastSeen: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0, id: '$_id', visits: 1, firstSeen: 1, lastSeen: 1, firstReferrer: 1,
          utmSource: 1, utmCampaign: 1, country: 1, countryCode: 1, region: 1, city: 1,
          isp: 1, proxy: 1, hosting: 1, isBot: 1, timezone: 1, language: 1,
          device: 1, browser: 1, os: 1, screen: 1,
          sessions: { $size: '$sessions' },
          pages: { $slice: ['$pages', -50] },
        },
      },
    ]);

    return res.json({ success: true, data: people });
  } catch (err) {
    console.error('[getPeople]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
