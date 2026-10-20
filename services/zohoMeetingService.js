// Zoho Meeting for landing-page demo bookings, hosted by the Zoho account behind
// ZOHO_REFRESH_TOKEN (michael@areaconnect.pro). Generate the token with
// scripts/getZohoRefreshToken.js.
const axios = require('axios');

const isConfigured = () =>
  !!(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET && process.env.ZOHO_REFRESH_TOKEN);

// Zoho runs separate data centres (.com, .eu, .in, .com.au …). The accounts
// domain the token was issued on decides which Meeting domain to call.
const accountsUrl = () => process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com';
const meetingUrl = () => process.env.ZOHO_MEETING_URL || accountsUrl().replace('accounts.', 'meeting.');

let cached = { token: null, exp: 0 };
async function getAccessToken() {
  if (cached.token && Date.now() < cached.exp - 60_000) return cached.token;
  const { data } = await axios.post(`${accountsUrl()}/oauth/v2/token`, null, {
    params: {
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      client_id:     process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      grant_type:    'refresh_token',
    },
  });
  if (!data.access_token) throw new Error(`Zoho token refresh failed: ${data.error || 'unknown'}`);
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return cached.token;
}

const auth = async () => ({ Authorization: `Zoho-oauthtoken ${await getAccessToken()}` });

let me = null;
async function getUser() {
  if (me) return me;
  const { data } = await axios.get(`${meetingUrl()}/api/v2/user.json`, { headers: await auth() });
  const u = data.userDetails || data;
  me = { zsoid: u.zsoid, zuid: u.zuid, email: u.primaryEmail || u.email };
  if (!me.zsoid) throw new Error('Zoho Meeting: could not read organisation id (zsoid)');
  return me;
}

// Zoho expects "Oct 21, 2026 09:30 AM" in the given timezone.
function zohoTime(date, timeZone = 'Africa/Lagos') {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  }).formatToParts(date).map(x => [x.type, x.value]));
  return `${p.month} ${p.day}, ${p.year} ${p.hour}:${p.minute} ${p.dayPeriod.toUpperCase()}`;
}

/** Creates a Zoho meeting and invites the guest. Returns { key, joinLink, startLink }. */
async function createMeeting({ start, minutes, topic, agenda, guestEmail }) {
  const { zsoid, zuid } = await getUser();
  const { data } = await axios.post(`${meetingUrl()}/api/v2/${zsoid}/sessions.json`, {
    session: {
      topic,
      agenda,
      presenter: zuid,
      startTime: zohoTime(start),
      duration: minutes * 60_000,
      timezone: 'Africa/Lagos',
      participants: guestEmail ? [{ email: guestEmail }] : [],
    },
  }, { headers: { ...(await auth()), 'Content-Type': 'application/json;charset=UTF-8' } });
  const s = data.session || data;
  return { key: s.meetingKey, joinLink: s.joinLink, startLink: s.startLink };
}

module.exports = { isConfigured, createMeeting, getUser, zohoTime };
