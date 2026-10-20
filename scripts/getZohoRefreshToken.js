// One-off: exchange a Zoho "Self Client" grant code for a refresh token.
//
// 1. https://api-console.zoho.com → Add Client → Self Client
// 2. Put ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET in .env
// 3. Generate Code tab, scope: ZohoMeeting.meeting.ALL,ZohoMeeting.manageOrg.READ
// 4. node scripts/getZohoRefreshToken.js <code>
//
// Tries each Zoho data centre until one accepts the code, then prints the
// variables to add to .env / Railway.
require('dotenv').config();
const axios = require('axios');

const code = process.argv[2];
if (!code) { console.error('Usage: node scripts/getZohoRefreshToken.js <grant code>'); process.exit(1); }

const DCS = ['https://accounts.zoho.com', 'https://accounts.zoho.eu', 'https://accounts.zoho.in', 'https://accounts.zoho.com.au', 'https://accounts.zoho.jp', 'https://accounts.zohocloud.ca', 'https://accounts.zoho.sa', 'https://accounts.zoho.uk'];

(async () => {
  for (const dc of DCS) {
    const { data } = await axios.post(`${dc}/oauth/v2/token`, null, {
      params: { grant_type: 'authorization_code', client_id: process.env.ZOHO_CLIENT_ID, client_secret: process.env.ZOHO_CLIENT_SECRET, code },
      validateStatus: () => true,
    });
    if (data.refresh_token) {
      console.log(`ZOHO_ACCOUNTS_URL=${dc}`);
      console.log(`ZOHO_REFRESH_TOKEN=${data.refresh_token}`);
      return;
    }
    if (data.error && data.error !== 'invalid_client' && data.error !== 'invalid_code') {
      console.error(`${dc}: ${data.error}`);
    }
  }
  console.error('No data centre accepted the code — it may have expired (codes last a few minutes). Generate a new one and retry.');
  process.exit(1);
})();
