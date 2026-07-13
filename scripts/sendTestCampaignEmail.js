require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { sendCampaignEmail } = require('../services/emailService');

const to      = process.argv[2] || 'donmissile@gmail.com';
const name    = process.argv[3] || 'Michael Orizu';
const variant = process.argv[4] || 'residents'; // residents | managers

const THEMES = {
  residents: { primaryColor: '#6366F1', accentColor: '#818CF8', backgroundColor: '#0F172A', textColor: '#FFFFFF' },
  managers:  { primaryColor: '#10B981', accentColor: '#34D399', backgroundColor: '#FFFFFF', textColor: '#0F172A' },
};
const theme = THEMES[variant] || THEMES.residents;

const COPY = {
  residents: {
    subject:   'Welcome to AreaConnect — your estate, together',
    preheader: 'Book a visitor, pay dues, and meet your neighbours in one place.',
    ctaText:   'Explore My Dashboard',
    ctaUrl:    'https://areamates.areaconnect.pro',
    intro:     "You just joined a smarter way to live in your estate. In under a minute you can move dues from your bank, book a visitor pass, and jump into the Lounge with your neighbours. Here's what's already waiting for you:",
    cards: [
      ['📱 Book a visitor in seconds', "Generate a one-time code and share it on WhatsApp — no more phoning the gate."],
      ['💳 Pay dues without the paperwork', "Card, transfer, or wallet — receipts drop into your history automatically."],
      ['💬 Meet your neighbours in the Lounge', "The estate's social feed — polls, marketplace, events, chatter. Say hi."],
    ],
    highlight: '<strong>Do one thing today</strong> to make everything easier: complete your profile. It takes 30 seconds.',
    signoff:   'Welcome aboard,<br/>The AreaConnect team',
  },
  managers: {
    subject:   'Your estate is now on AreaConnect — here is what to set up first',
    preheader: 'Invite residents, publish dues, and get your gate wired up in an afternoon.',
    ctaText:   'Open Manager Console',
    ctaUrl:    'https://areaconnect.pro',
    intro:     "Your estate is live on AreaConnect. In an afternoon you can invite every resident, publish this month's dues, and give your gate the tools to stop 'my visitor is coming' calls. Start with these:",
    cards: [
      ['👥 Invite residents in bulk', "Paste a WhatsApp list or upload a CSV — everyone signs up in one tap and lands in the right unit."],
      ['💳 Publish dues in minutes', "Set service charges, generate invoices, and let residents pay by card, transfer or wallet. Auto-reconciled."],
      ['🚪 Give your gate a superpower', "Guards see visitors before they arrive, log entries with one tap, and raise alerts you actually hear."],
    ],
    highlight: '<strong>Save your first hour today</strong>: create the resident invite link and drop it in your estate WhatsApp group.',
    signoff:   'To a quieter estate,<br/>The AreaConnect team',
  },
};

const c = COPY[variant] || COPY.residents;
const cardHtml = c.cards.map(([t, s]) => `
<div style="border-left:3px solid ${theme.primaryColor};background:#F8FAFC;padding:14px 16px;border-radius:8px;margin-bottom:12px;">
  <p style="font-size:14px;font-weight:700;color:#0F172A;margin:0 0 3px;">${t}</p>
  <p style="font-size:13px;color:#64748B;line-height:1.55;margin:0;">${s}</p>
</div>`).join('');

const htmlBody = `
<p style="font-size:14px;color:#475569;margin:0 0 20px;">Hi {{name}},</p>

<h1 style="font-size:26px;font-weight:800;letter-spacing:-0.02em;color:#0F172A;margin:0 0 10px;line-height:1.15;">${c.subject.split(' — ')[0]}.</h1>

<p style="font-size:15px;color:#475569;line-height:1.65;margin:0 0 22px;">${c.intro}</p>

${cardHtml}

<div style="height:1px;background:#F1F5F9;margin:22px 0;"></div>

<div style="background:${theme.primaryColor}0F;border:1px solid ${theme.primaryColor}33;padding:16px 18px;border-radius:12px;margin:0 0 6px;">
  <p style="font-size:13px;color:#0F172A;margin:0;line-height:1.55;">${c.highlight}</p>
</div>

<p style="font-size:14px;color:#475569;line-height:1.65;margin:22px 0 0;">${c.signoff}</p>
`;

(async () => {
  console.log(`Sending ${variant} styled test to ${to}…`);
  try {
    const r = await sendCampaignEmail({
      to,
      name,
      subject: c.subject,
      preheader: c.preheader,
      htmlBody,
      ctaText: c.ctaText,
      ctaUrl: c.ctaUrl,
      theme,
      brand: { name: 'AreaConnect', logoUrl: process.env.BRAND_LOGO_URL || '' },
    });
    console.log('Result:', r);
    console.log('If Resend accepted it, check the inbox in a moment.');
  } catch (err) {
    console.error('Send failed:', err.message);
    process.exit(1);
  }
})();
