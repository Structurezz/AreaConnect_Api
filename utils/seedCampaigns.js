require('dotenv').config();
const mongoose = require('mongoose');
const Campaign = require('../models/Campaign');

const WELCOME_NEW_MEMBERS = {
  name: 'Welcome New Members',
  slug: 'welcome-new-members',
  status: 'active',
  placements: ['modal', 'email'],
  audience: {
    segment: 'new_users',
    newUserWithinDays: 7,
    app: 'resident',
  },
  content: {
    badge: 'NEW HERE?',
    headline: 'Welcome to AreaConnect',
    subheadline: "Your estate, together — everything in one place.",
    body: [
      "You're now part of a smarter neighbourhood.",
      "Pay your dues in seconds, book visitor passes, chat with neighbours in the Lounge, and get alerted the moment something matters at your gate.",
      "Take a minute to complete your profile — you'll get more out of everything you do here.",
    ].join('\n\n'),
    imageUrl: '',
    ctaText: 'Complete My Profile',
    ctaUrl: '/profile',
    theme: {
      primaryColor: '#EC4899',
      accentColor: '#F472B6',
      textColor: '#FFFFFF',
      backgroundColor: '#0F172A',
    },
  },
  email: {
    subject: 'Welcome to AreaConnect — your estate, together',
    preheader: 'A quick tour of what you can do next.',
    sendOnUserSignup: true,
    htmlBody: `
      <h2 style="font-size:22px;font-weight:800;color:#0F172A;letter-spacing:-0.02em;margin-bottom:8px;">Welcome to AreaConnect 👋</h2>
      <p style="font-size:15px;color:#475569;line-height:1.65;margin-bottom:20px;">
        You've just joined a smarter way to live in your estate. Here's what you can do right now:
      </p>
      <div style="border-left:3px solid #EC4899;padding:4px 0 4px 16px;margin-bottom:14px;">
        <p style="font-size:14px;color:#0F172A;font-weight:700;margin-bottom:2px;">📱 Book a visitor in seconds</p>
        <p style="font-size:13px;color:#64748B;line-height:1.55;">Generate a one-time code and share it on WhatsApp — no more phoning the gate.</p>
      </div>
      <div style="border-left:3px solid #EC4899;padding:4px 0 4px 16px;margin-bottom:14px;">
        <p style="font-size:14px;color:#0F172A;font-weight:700;margin-bottom:2px;">💳 Pay dues without the paperwork</p>
        <p style="font-size:13px;color:#64748B;line-height:1.55;">Card, transfer, wallet — pick your poison. Receipts drop into your history automatically.</p>
      </div>
      <div style="border-left:3px solid #EC4899;padding:4px 0 4px 16px;margin-bottom:14px;">
        <p style="font-size:14px;color:#0F172A;font-weight:700;margin-bottom:2px;">💬 Meet your neighbours in the Lounge</p>
        <p style="font-size:13px;color:#64748B;line-height:1.55;">The estate's social feed — polls, marketplace, events, chatter. Say hi.</p>
      </div>
      <div style="border-left:3px solid #EC4899;padding:4px 0 4px 16px;margin-bottom:14px;">
        <p style="font-size:14px;color:#0F172A;font-weight:700;margin-bottom:2px;">🚨 Get alerts the moment they matter</p>
        <p style="font-size:13px;color:#64748B;line-height:1.55;">A siren rings when your estate posts an alert. Silence it once, we won't be dramatic.</p>
      </div>
      <p style="font-size:14px;color:#475569;line-height:1.65;margin-top:24px;">
        Do one thing today to make everything easier: <strong>finish your profile</strong>.
      </p>
    `,
  },
};

async function seedCampaigns() {
  const own = !mongoose.connection.readyState;
  if (own) await mongoose.connect(process.env.MONGODB_URI);

  const existing = await Campaign.findOne({ slug: WELCOME_NEW_MEMBERS.slug });
  if (existing) {
    console.log(`  ✓ campaign already exists: ${WELCOME_NEW_MEMBERS.slug}`);
  } else {
    await Campaign.create(WELCOME_NEW_MEMBERS);
    console.log(`  ✓ seeded campaign: ${WELCOME_NEW_MEMBERS.slug}`);
  }

  if (own) await mongoose.disconnect();
}

if (require.main === module) {
  seedCampaigns()
    .then(() => process.exit(0))
    .catch((err) => { console.error(err); process.exit(1); });
}

module.exports = seedCampaigns;
