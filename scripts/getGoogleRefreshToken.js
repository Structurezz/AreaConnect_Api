// One-off: get a Google OAuth refresh token so the API can create
// Calendar events with Meet links on the demo host's calendar.
//
// 1. Google Cloud Console → enable "Google Calendar API"
// 2. Credentials → OAuth client ID → type "Desktop app"
// 3. GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/getGoogleRefreshToken.js
// 4. Open the printed URL, sign in as michael@areaconnect.pro, approve
// 5. Put the printed GOOGLE_REFRESH_TOKEN into the server env (Railway)
require('dotenv').config();
const http = require('http');
const axios = require('axios');

const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = process.env;
if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.');
  process.exit(1);
}

const PORT = 53682;
const redirectUri = `http://127.0.0.1:${PORT}`;
const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy',
  access_type: 'offline',
  prompt: 'consent',
});

http.createServer(async (req, res) => {
  const code = new URL(req.url, redirectUri).searchParams.get('code');
  if (!code) return res.end('No code');
  try {
    const { data } = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code',
    }));
    res.end('Done — you can close this tab.');
    console.log(`\nGOOGLE_REFRESH_TOKEN=${data.refresh_token}\n`);
  } catch (err) {
    res.end('Token exchange failed — see terminal.');
    console.error(err.response?.data || err.message);
  }
  process.exit(0);
}).listen(PORT, () => console.log(`Open this URL and sign in as the demo host:\n\n${authUrl}\n`));
