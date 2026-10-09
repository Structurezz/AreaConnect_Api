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

// Resolve IP → country/city asynchronously. ip-api.com free tier allows 45
// requests/minute from one IP. Failures are logged and swallowed so the
// absence of geo data never breaks the pageview.
async function resolveGeo(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1') return null;
  try {
    const { data } = await axios.get(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city`,
      { timeout: 2500 },
    );
    if (data?.status !== 'success') return null;
    return {
      country:     data.country     || '',
      countryCode: data.countryCode || '',
      region:      data.regionName  || '',
      city:        data.city        || '',
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
      screen:    String(b.screen   || '').slice(0, 20),
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
    resolveGeo(ip).then((geo) => {
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
    ] = await Promise.all([
      SiteVisit.countDocuments(),
      SiteVisit.countDocuments({ visitedAt: { $gte: startOfDay } }),
      SiteVisit.countDocuments({ visitedAt: { $gte: startOfWeek } }),
      SiteVisit.countDocuments({ visitedAt: { $gte: startOfMonth } }),

      SiteVisit.distinct('ipHash', { visitedAt: { $gte: startOfDay } }).then(a => a.length),
      SiteVisit.distinct('ipHash', { visitedAt: { $gte: startOfWeek } }).then(a => a.length),
      SiteVisit.distinct('ipHash', { visitedAt: { $gte: startOfMonth } }).then(a => a.length),
      SiteVisit.distinct('ipHash').then(a => a.length),

      SiteVisit.aggregate([
        { $match: { visitedAt: { $gte: startOfMonth } } },
        { $group: { _id: '$path', count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 10 },
        { $project: { _id: 0, path: '$_id', count: 1 } },
      ]),

      SiteVisit.aggregate([
        { $match: { visitedAt: { $gte: startOfMonth }, referrer: { $ne: '' } } },
        {
          $addFields: {
            host: {
              $let: {
                vars: { stripped: { $replaceAll: { input: '$referrer', find: 'https://', replacement: '' } } },
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
        { $match: { visitedAt: { $gte: startOfMonth }, country: { $ne: '' } } },
        { $group: { _id: '$country', countryCode: { $first: '$countryCode' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 10 },
        { $project: { _id: 0, country: '$_id', countryCode: 1, count: 1 } },
      ]),

      SiteVisit.aggregate([
        { $match: { visitedAt: { $gte: startOfMonth }, 'utm.source': { $ne: '' } } },
        { $group: { _id: { source: '$utm.source', medium: '$utm.medium' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 10 },
        { $project: { _id: 0, source: '$_id.source', medium: '$_id.medium', count: 1 } },
      ]),

      SiteVisit.aggregate([
        { $match: { visitedAt: { $gte: startOfMonth } } },
        { $group: { _id: '$device', count: { $sum: 1 } } },
        { $project: { _id: 0, device: '$_id', count: 1 } },
      ]),

      SiteVisit.aggregate([
        { $match: { visitedAt: { $gte: startOfMonth } } },
        { $group: { _id: '$browser', count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 6 },
        { $project: { _id: 0, browser: '$_id', count: 1 } },
      ]),

      // Last 14 days of counts for a sparkline
      SiteVisit.aggregate([
        { $match: { visitedAt: { $gte: new Date(now.getTime() - 14 * DAY_MS) } } },
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
    ]);

    return res.json({
      success: true,
      data: {
        totals: { all: totalVisits, today: visitsToday, week: visitsWeek, month: visitsMonth },
        unique: { all: uniqueTotal, today: uniqueToday, week: uniqueWeek, month: uniqueMonth },
        topPages, topReferrers, topCountries, bySource, byDevice, byBrowser, byDay,
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
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const visits = await SiteVisit.find()
      .sort({ visitedAt: -1 })
      .limit(limit)
      .select('path referrer utm country countryCode city region device browser os language timezone visitedAt ipHash sessionId');
    return res.json({ success: true, data: visits });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
