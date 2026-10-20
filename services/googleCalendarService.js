// Google Calendar + Meet for landing-page demo bookings.
// Uses an OAuth refresh token for the host's account (michael@areaconnect.pro).
// Generate one with: node scripts/getGoogleRefreshToken.js
const axios = require('axios');
const crypto = require('crypto');

const CAL_API = 'https://www.googleapis.com/calendar/v3';

const isConfigured = () =>
  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);

const calendarId = () => process.env.GOOGLE_CALENDAR_ID || 'primary';

let cached = { token: null, exp: 0 };
async function getAccessToken() {
  if (cached.token && Date.now() < cached.exp - 60_000) return cached.token;
  const { data } = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type:    'refresh_token',
  }));
  cached = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

// Returns [{ start: Date, end: Date }] busy blocks on the host calendar.
async function getBusy(timeMin, timeMax) {
  const token = await getAccessToken();
  const { data } = await axios.post(`${CAL_API}/freeBusy`, {
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    items: [{ id: calendarId() }],
  }, { headers: { Authorization: `Bearer ${token}` } });
  const busy = data.calendars?.[calendarId()]?.busy || [];
  return busy.map(b => ({ start: new Date(b.start), end: new Date(b.end) }));
}

// Creates the event with a Google Meet link and emails the invite to the guest.
async function createMeetEvent({ start, end, summary, description, attendees }) {
  const token = await getAccessToken();
  const { data } = await axios.post(
    `${CAL_API}/calendars/${encodeURIComponent(calendarId())}/events`,
    {
      summary,
      description,
      start: { dateTime: start.toISOString(), timeZone: 'Africa/Lagos' },
      end:   { dateTime: end.toISOString(),   timeZone: 'Africa/Lagos' },
      attendees,
      conferenceData: {
        createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } },
      },
      reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 60 }, { method: 'popup', minutes: 10 }] },
    },
    {
      headers: { Authorization: `Bearer ${token}` },
      params: { conferenceDataVersion: 1, sendUpdates: 'all' },
    },
  );
  const meetLink = data.hangoutLink
    || data.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri
    || null;
  return { id: data.id, htmlLink: data.htmlLink, meetLink };
}

module.exports = { isConfigured, getBusy, createMeetEvent };
