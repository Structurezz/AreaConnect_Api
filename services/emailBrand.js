// Shared AreaConnect branding for every outgoing email: the "AC" app icon
// beside the wordmark. The icon travels as an inline (CID) attachment so it
// shows even when remote images are blocked; sendEmail() attaches it
// automatically whenever the html references it.
const fs = require('fs');
const path = require('path');

const LOGO_CID = 'ac-logo';
// Hosted copy for Resend's batch API, which can't carry attachments
const LOGO_URL = 'https://areaconnect.pro/logo-512.png';

let logo;
const logoAttachment = () => {
  if (!logo) {
    logo = {
      filename: 'logo.png',
      contentId: LOGO_CID,
      content: fs.readFileSync(path.join(__dirname, '../assets/email/logo.png')),
    };
  }
  return logo;
};

// Icon + wordmark. `dark` is for headers on dark/coloured backgrounds.
const brandMark = ({ dark = false, size = 22, hosted = false } = {}) => {
  const icon = Math.round(size * 1.55);
  return `<table cellpadding="0" cellspacing="0" role="presentation" style="display:inline-table;border-collapse:collapse;"><tr>`
    + `<td style="vertical-align:middle;padding-right:${Math.round(size * 0.45)}px;"><img src="${hosted ? LOGO_URL : `cid:${LOGO_CID}`}" width="${icon}" height="${icon}" alt="AreaConnect" style="display:block;border:0;border-radius:${Math.round(icon * 0.25)}px;"></td>`
    + `<td style="vertical-align:middle;font-size:${size}px;font-weight:800;letter-spacing:-0.03em;color:${dark ? '#FFFFFF' : '#111111'};white-space:nowrap;">Area<span style="color:${dark ? '#34D399' : '#10B981'};">Connect</span></td>`
    + `</tr></table>`;
};

const withLogo = (payload) => {
  if (!payload.html || !payload.html.includes(`cid:${LOGO_CID}`)) return payload;
  const attachments = payload.attachments || [];
  if (attachments.some(a => a.contentId === LOGO_CID)) return payload;
  return { ...payload, attachments: [...attachments, logoAttachment()] };
};

module.exports = { LOGO_CID, LOGO_URL, brandMark, withLogo, logoAttachment };
