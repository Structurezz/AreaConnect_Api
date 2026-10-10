/**
 * Generates the AreaConnect pitch deck as a PDF (landscape A4, one slide per
 * page) and emails it via Resend.
 *
 * Usage:
 *   node scripts/sendPitchDeckPDF.js donmissile@gmail.com
 *   node scripts/sendPitchDeckPDF.js            # defaults to donmissile@gmail.com
 *
 * Also writes /tmp/AreaConnect-Pitch-Deck-2026.pdf for local sanity check.
 */

require('dotenv').config();
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { Resend }  = require('resend');

const to = process.argv[2] || 'donmissile@gmail.com';
if (!process.env.RESEND_API_KEY) {
  console.error('✖ RESEND_API_KEY missing from .env');
  process.exit(1);
}

// ── Color palette (all arrays, Type-1-font safe) ─────────────────────────
const C = {
  bg:        [248, 250, 252],
  white:     [255, 255, 255],
  dark:      [15, 23, 42],
  slate:     [71, 85, 105],
  mute:      [148, 163, 184],
  faint:     [226, 232, 240],
  green:     [16, 185, 129],
  greenDeep: [6, 95, 70],
  red:       [220, 38, 38],
  redBg:     [254, 242, 242],
  redBorder: [254, 202, 202],
  indigo:    [99, 102, 241],
  indigoBg:  [238, 242, 255],
  purple:    [139, 92, 246],
  purpleBg:  [245, 243, 255],
  amber:     [217, 119, 6],
  amberBg:   [255, 251, 235],
  amberBorder:[253, 230, 138],
  navy:      [30, 58, 95],
};

// ── Slide data (NO emoji, NO ₦/★ — Helvetica is Type-1 and only supports WinAnsi) ─
const NGN = (s) => s.replace(/₦/g, 'NGN ');

const SLIDES = [
  { type: 'cover',
    title: 'AreaConnect',
    subtitle: 'Smart Estate Management Platform',
    body: 'The all-in-one platform transforming how Nigerian estates manage residents, security, payments, and community — from a single dashboard.',
    tags: ['React','Node.js','MongoDB','Paystack','Socket.io'],
  },
  { type: 'problem',
    title: 'The Problem',
    subtitle: 'Estate management in Nigeria is broken',
    points: [
      'Resident records kept in spreadsheets or paper files — no searchability, no backup',
      'Security desks rely on logbooks for visitor management — no accountability, easy forgery',
      'Levy collection is manual, error-prone, and nearly impossible to track across hundreds of units',
      'Announcements sent via WhatsApp groups — messages get lost, no record of who received what',
      'Facility managers have no real-time visibility into estate operations or complaints',
    ],
    stat: { v: '73%', label: 'of Nigerian estate managers still use paper or WhatsApp for day-to-day operations' },
  },
  { type: 'solution',
    title: 'The Solution',
    subtitle: 'One platform, five apps, every stakeholder covered',
    rows: [
      ['Estate Manager',  'Full management dashboard — residents, payments, announcements, analytics'],
      ['AreaMates',        'Resident app — community feed, levy payments, visitor bookings, announcements'],
      ['Guard Station',    'Security guard app — visitor check-in/out, QR scanning, incident logging'],
      ['Super Admin',      'Platform dashboard — estate onboarding, subscription management, analytics'],
      ['REST API',          'Full API access for enterprise integrations and white-label deployments'],
    ],
  },
  { type: 'features',
    title: 'Core Features',
    subtitle: 'Everything an estate needs — nothing it does not',
    grid: [
      ['Resident Management',    'Digital directory, unit assignment, lease tracking, occupancy stats'],
      ['Security & Access',      'Pre-registered visitors, QR codes, guard dashboard, security logs'],
      ['Levy & Payment',         'Payment schedules, automated invoices, receipts sent by email'],
      ['Announcements & Alerts', 'Broadcast messages, emergency alerts, threaded announcements'],
      ['Community Lounge',       'Social feed, polls, direct messages, community board'],
      ['Marketplace',            'Resident-to-resident listings, classifieds within the estate'],
      ['Analytics Dashboard',    'Occupancy, payment trends, visitor patterns, subscription health'],
      ['Real-time Notifications','Socket.io push notifications across all apps, instantly'],
    ],
  },
  { type: 'tech',
    title: 'Technology',
    subtitle: 'Built for scale, security, and speed',
    stack: [
      ['FRONTEND',  'React 18 + Vite + TailwindCSS',  'Three separate SPAs — manager, resident, guard'],
      ['BACKEND',   'Node.js + Express + MongoDB',    'RESTful API with JWT auth, estate-scoped middleware'],
      ['REAL-TIME', 'Socket.io',                      'Bi-directional events — visitors, payments, alerts'],
      ['PAYMENTS',  'Paystack Integration',           'Card, bank transfer, wallet, automated receipts'],
      ['EMAIL',     'Resend + HTML Templates',        'Visitor passes, invoices, pitch emails, reminders'],
      ['HOSTING',   'Railway + Cloudflare',           'Auto-deploy from GitHub, CDN edge, custom domains'],
    ],
    badges: ['MongoDB','Express','React','Node.js','Socket.io','Paystack','Resend','Railway','JWT','TailwindCSS'],
  },
  { type: 'market',
    title: 'Market Opportunity',
    subtitle: 'Nigeria\'s real estate sector is massive and underserved',
    stats: [
      ['22M+',       'Housing units in Nigeria',         'Source: NBS 2024'],
      ['5,000+',     'Gated estates & residential parks','Major cities alone'],
      ['NGN 45T',    'Real estate sector GDP',           '7% of GDP (2024)'],
      ['NGN 15B',    'Addressable SaaS market',          'Estate management software'],
    ],
    insight: 'Less than 2% of Nigerian estate managers use dedicated software. The remaining 98% are our market.',
  },
  { type: 'pricing',
    title: 'Pricing Plans',
    subtitle: 'Flexible pricing for estates of every size',
    plans: [
      { name: 'Starter',    price: 'NGN 20,000',  cycle: '/mo', residents: '50',  highlight: false,
        features: ['Resident & unit management','Visitor management','Announcements & alerts','Security portal','Custom branding'] },
      { name: 'Growth',     price: 'NGN 47,000',  cycle: '/mo', residents: '150', highlight: true,
        features: ['All Starter features','Payment system & invoices','Community chat & events','Polls & voting','Nkechi AI','Priority support'] },
      { name: 'Premium',    price: 'NGN 80,000',  cycle: '/mo', residents: '300', highlight: false,
        features: ['All Growth features','Marketplace','Resident lounge','Music player','White-label','API access'] },
      { name: 'Enterprise', price: 'NGN 100,000', cycle: '/mo', residents: '500', highlight: false,
        features: ['All Premium features','Up to 500 residents','1,000 visitors/month','Full API access','Priority support'] },
    ],
  },
  { type: 'traction',
    title: 'Traction',
    subtitle: 'Real growth, real impact',
    metrics: [
      ['500+',     'Active Estates'],
      ['50,000+',  'Residents Managed'],
      ['NGN 2.1B', 'Levies Processed'],
      ['180,000+', 'Visitors Processed'],
      ['99.9%',    'Platform Uptime'],
      ['4.8 / 5',  'Avg. Satisfaction'],
    ],
    testimonials: [
      ['AreaConnect reduced our security incidents by 60% in the first month.', 'Estate Manager, Lekki Phase 1'],
      ['Collecting levies used to take weeks. Now it is automated and residents get receipts instantly.', 'Manager, Omole Phase 2, Lagos'],
      ['The visitor QR code system is a game changer. Our guards love it.', 'Facility Manager, Asokoro, Abuja'],
    ],
  },
  { type: 'revenue',
    title: 'Revenue Model',
    subtitle: 'Multiple, compounding revenue streams',
    streams: [
      ['SaaS Subscriptions', 'Monthly & annual plans per estate', 70],
      ['Payment Processing', '1.5% fee on levies processed via Paystack', 18],
      ['Enterprise Licenses','Custom white-label for property companies', 8],
      ['API Access Fees',    'Third-party integrations and developer API', 4],
    ],
    projections: [
      ['2025', 'NGN 4.5M',  '200 estates'],
      ['2026', 'NGN 18M',   '800 estates'],
      ['2027', 'NGN 55M',   '2,500 estates'],
    ],
  },
  { type: 'wins',
    title: 'Why AreaConnect Wins',
    subtitle: 'Unfair advantages we have built',
    advantages: [
      ['Nigeria-first Design',    'Built for Nigerian infrastructure realities — mobile-first, works on 3G, Paystack-native'],
      ['Full-stack Platform',      'Not just a CRM — a complete operating system for estates across 5 interconnected apps'],
      ['Network Effects',          'Every resident on AreaMates increases value for the estate manager and other residents'],
      ['Automated Communication',  'Invoices, receipts, visitor passes, subscription reminders delivered automatically'],
      ['Enterprise-grade Security','JWT auth, estate-scoped data isolation, MongoDB injection protection, CORS lockdown'],
      ['Rapid Iteration',          'Weekly releases, direct feedback loops with estate managers, feature-driven roadmap'],
    ],
  },
  { type: 'cta',
    title: 'Let us transform your estate',
    subtitle: 'Join hundreds of Nigerian estates running on AreaConnect',
    ctas: [
      ['Get Started',       'https://area-connector.areaconnect.pro/register'],
      ['Schedule a Demo',   'mailto:hello@areaconnect.pro'],
    ],
    contact: { email: 'hello@areaconnect.pro', web: 'areaconnect.pro' },
  },
];

// Small drawn checkmark used for pricing bullets (no unicode ✓).
function drawTick(doc, x, y, color = C.green) {
  doc.save();
  doc.strokeColor(color).lineWidth(1.5).lineCap('round').lineJoin('round');
  doc.moveTo(x, y + 4).lineTo(x + 3, y + 7).lineTo(x + 9, y).stroke();
  doc.restore();
}

function fillRect(doc, x, y, w, h, color) {
  doc.save().rect(x, y, w, h).fill(color).restore();
}
function strokeRect(doc, x, y, w, h, color, lineWidth = 1) {
  doc.save().strokeColor(color).lineWidth(lineWidth).rect(x, y, w, h).stroke().restore();
}

function drawHeader(doc, title, subtitle, accent, W) {
  // Accent bar
  fillRect(doc, 40, 42, 5, 36, accent);
  doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(28).text(title, 56, 40);
  doc.fillColor(C.slate).font('Helvetica').fontSize(13).text(subtitle, 56, 80);
}

function drawFooter(doc, index, total, W, H) {
  doc.fillColor(C.mute).font('Helvetica').fontSize(9)
     .text('AreaConnect  ·  Pitch Deck 2026', 40, H - 24);
  doc.text(`${index + 1} / ${total}`, 0, H - 24, { width: W - 40, align: 'right' });
}

// ── Slide painters ───────────────────────────────────────────────────────
function drawCover(doc, s, W, H) {
  // Dark navy background
  fillRect(doc, 0, 0, W, H, C.dark);
  // Green diagonal accent (left panel)
  fillRect(doc, 0, 0, W * 0.42, H, C.greenDeep);
  // Soft highlight stripe
  fillRect(doc, 0, 0, W, 6, C.green);

  // Right side content
  const px = W * 0.5;
  doc.fillColor([167, 243, 208]).font('Helvetica-Bold').fontSize(10)
     .text('PITCH DECK 2026', px, 80, { characterSpacing: 2 });

  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(56)
     .text('AreaConnect', px, 110);

  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(18)
     .text(s.subtitle, px, 190);

  doc.fillColor([203, 213, 225]).font('Helvetica').fontSize(13)
     .text(s.body, px, 230, { width: W - px - 60, lineGap: 4 });

  // Tags row
  const tagY = H - 90;
  let tx = px;
  s.tags.forEach(t => {
    doc.font('Helvetica-Bold').fontSize(10);
    const tw = doc.widthOfString(t) + 18;
    doc.save().fillColor([30, 41, 59]).roundedRect(tx, tagY, tw, 20, 10).fill().restore();
    doc.fillColor([203, 213, 225]).text(t, tx + 9, tagY + 6);
    tx += tw + 8;
    if (tx > W - 40) return;
  });

  // Left panel: big brand mark
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(96)
     .text('AC', 60, H / 2 - 60);
  doc.fillColor([167, 243, 208]).font('Helvetica').fontSize(11)
     .text('All-in-one estate OS', 60, H / 2 + 48, { characterSpacing: 1 });
}

function drawProblem(doc, s, W, H) {
  fillRect(doc, 0, 0, W, H, C.bg);
  drawHeader(doc, s.title, s.subtitle, C.red, W);

  let y = 120;
  s.points.forEach(text => {
    fillRect(doc, 40, y, W - 80, 42, C.redBg);
    strokeRect(doc, 40, y, W - 80, 42, C.redBorder);
    // Bullet dot
    doc.save().fillColor(C.red).circle(58, y + 21, 4).fill().restore();
    doc.fillColor([55, 65, 81]).font('Helvetica').fontSize(12)
       .text(text, 76, y + 13, { width: W - 140, lineGap: 2 });
    y += 50;
  });

  // Stat callout
  const sy = y + 10;
  fillRect(doc, 40, sy, W - 80, 68, C.red);
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(36)
     .text(s.stat.v, 60, sy + 14);
  doc.font('Helvetica').fontSize(12)
     .text(s.stat.label, 60, sy + 42, { width: W - 140 });
}

function drawSolution(doc, s, W, H) {
  fillRect(doc, 0, 0, W, H, C.bg);
  drawHeader(doc, s.title, s.subtitle, C.green, W);

  let y = 120;
  s.rows.forEach(([name, desc], i) => {
    fillRect(doc, 40, y, W - 80, 54, C.white);
    strokeRect(doc, 40, y, W - 80, 54, C.faint);
    fillRect(doc, 40, y, 4, 54, C.green);

    // Number badge
    doc.save().fillColor(C.green).roundedRect(56, y + 15, 24, 24, 6).fill().restore();
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(13)
       .text(String(i + 1), 56, y + 20, { width: 24, align: 'center' });

    doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(14).text(name, 92, y + 12);
    doc.fillColor(C.slate).font('Helvetica').fontSize(11).text(desc, 92, y + 30, { width: W - 160 });
    y += 62;
  });
}

function drawFeatures(doc, s, W, H) {
  fillRect(doc, 0, 0, W, H, C.bg);
  drawHeader(doc, s.title, s.subtitle, C.indigo, W);
  const cols = 2, gap = 12;
  const colW = (W - 80 - gap) / cols;
  const rowH = 72;
  const startY = 120;
  s.grid.forEach(([label, desc], i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = 40 + col * (colW + gap);
    const y = startY + row * (rowH + gap);
    fillRect(doc, x, y, colW, rowH, C.white);
    strokeRect(doc, x, y, colW, rowH, C.faint);
    fillRect(doc, x, y, 4, rowH, C.indigo);
    doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(13).text(label, x + 16, y + 12, { width: colW - 24 });
    doc.fillColor(C.slate).font('Helvetica').fontSize(10.5).text(desc, x + 16, y + 32, { width: colW - 24, lineGap: 2 });
  });
}

function drawTech(doc, s, W, H) {
  fillRect(doc, 0, 0, W, H, C.bg);
  drawHeader(doc, s.title, s.subtitle, C.purple, W);
  let y = 118;
  s.stack.forEach(([layer, tech, desc]) => {
    fillRect(doc, 40, y, W - 80, 50, C.white);
    strokeRect(doc, 40, y, W - 80, 50, C.faint);
    doc.fillColor(C.mute).font('Helvetica-Bold').fontSize(9).text(layer, 54, y + 10);
    doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(13).text(tech, 54, y + 24);
    doc.fillColor(C.slate).font('Helvetica').fontSize(10).text(desc, 260, y + 24, { width: W - 320 });
    y += 56;
  });

  // Badges strip
  const by = y + 10;
  doc.fillColor(C.mute).font('Helvetica-Bold').fontSize(9).text('STACK', 40, by, { characterSpacing: 2 });
  let bx = 100;
  s.badges.forEach(b => {
    doc.font('Helvetica-Bold').fontSize(9);
    const bw = doc.widthOfString(b) + 16;
    if (bx + bw > W - 40) return;
    doc.save().fillColor(C.indigoBg).roundedRect(bx, by - 2, bw, 20, 10).fill().restore();
    doc.fillColor(C.indigo).text(b, bx + 8, by + 4);
    bx += bw + 6;
  });
}

function drawMarket(doc, s, W, H) {
  fillRect(doc, 0, 0, W, H, C.bg);
  drawHeader(doc, s.title, s.subtitle, C.amber, W);
  const cols = 2, gap = 14;
  const colW = (W - 80 - gap) / cols;
  const rowH = 86;
  const startY = 118;
  s.stats.forEach(([v, label, sub], i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = 40 + col * (colW + gap);
    const y = startY + row * (rowH + gap);
    fillRect(doc, x, y, colW, rowH, C.amberBg);
    strokeRect(doc, x, y, colW, rowH, C.amberBorder);
    doc.fillColor(C.amber).font('Helvetica-Bold').fontSize(28).text(v, x + 16, y + 14);
    doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(12).text(label, x + 16, y + 48, { width: colW - 32 });
    doc.fillColor(C.mute).font('Helvetica').fontSize(10).text(sub, x + 16, y + 66, { width: colW - 32 });
  });

  const insY = startY + 2 * (rowH + gap) + 10;
  fillRect(doc, 40, insY, W - 80, 60, C.dark);
  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(10).text('KEY INSIGHT', 56, insY + 12, { characterSpacing: 2 });
  doc.fillColor(C.white).font('Helvetica').fontSize(12).text(s.insight, 56, insY + 30, { width: W - 112, lineGap: 3 });
}

function drawPricing(doc, s, W, H) {
  fillRect(doc, 0, 0, W, H, C.bg);
  drawHeader(doc, s.title, s.subtitle, C.green, W);
  const gap = 12;
  const cardW = (W - 80 - gap * 3) / 4;
  const cardH = H - 150;
  s.plans.forEach((p, i) => {
    const x = 40 + i * (cardW + gap);
    const y = 126;
    fillRect(doc, x, y, cardW, cardH, p.highlight ? [240, 253, 244] : C.white);
    strokeRect(doc, x, y, cardW, cardH, p.highlight ? C.green : C.faint, p.highlight ? 2 : 1);

    if (p.highlight) {
      fillRect(doc, x + cardW / 2 - 46, y - 10, 92, 20, C.green);
      doc.fillColor(C.white).font('Helvetica-Bold').fontSize(8)
         .text('MOST POPULAR', x, y - 6, { width: cardW, align: 'center', characterSpacing: 1 });
    }

    doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(14).text(p.name, x + 14, y + 16);
    doc.fillColor(p.highlight ? C.green : C.dark).font('Helvetica-Bold').fontSize(20).text(p.price, x + 14, y + 36);
    doc.fillColor(C.mute).font('Helvetica').fontSize(10).text(p.cycle, x + 14, y + 60);
    doc.fillColor(C.slate).font('Helvetica').fontSize(10).text(`Up to ${p.residents} residents`, x + 14, y + 78);

    // Divider
    doc.save().strokeColor(C.faint).moveTo(x + 14, y + 98).lineTo(x + cardW - 14, y + 98).stroke().restore();

    let fy = y + 108;
    p.features.forEach(f => {
      drawTick(doc, x + 14, fy, p.highlight ? C.green : C.indigo);
      doc.fillColor(C.dark).font('Helvetica').fontSize(10).text(f, x + 28, fy - 1, { width: cardW - 38, lineGap: 1 });
      fy += Math.max(16, doc.heightOfString(f, { width: cardW - 38, fontSize: 10 }) + 4);
    });
  });
}

function drawTraction(doc, s, W, H) {
  fillRect(doc, 0, 0, W, H, C.bg);
  drawHeader(doc, s.title, s.subtitle, C.green, W);
  const cols = 3, gap = 12;
  const colW = (W - 80 - gap * 2) / cols;
  const rowH = 66;
  const startY = 118;
  s.metrics.forEach(([v, l], i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = 40 + col * (colW + gap);
    const y = startY + row * (rowH + gap);
    fillRect(doc, x, y, colW, rowH, C.white);
    strokeRect(doc, x, y, colW, rowH, C.faint);
    doc.fillColor(C.green).font('Helvetica-Bold').fontSize(22).text(v, x + 14, y + 10);
    doc.fillColor(C.slate).font('Helvetica').fontSize(11).text(l, x + 14, y + 40, { width: colW - 28 });
  });

  let ty = startY + 2 * (rowH + gap) + 10;
  s.testimonials.forEach(([quote, author]) => {
    fillRect(doc, 40, ty, W - 80, 42, [240, 253, 244]);
    fillRect(doc, 40, ty, 4, 42, C.green);
    doc.fillColor(C.dark).font('Helvetica-Oblique').fontSize(11)
       .text(`"${quote}"`, 54, ty + 6, { width: W - 112, lineGap: 2 });
    doc.fillColor(C.mute).font('Helvetica-Bold').fontSize(9)
       .text(`— ${author}`, 54, ty + 28);
    ty += 48;
  });
}

function drawRevenue(doc, s, W, H) {
  fillRect(doc, 0, 0, W, H, C.bg);
  drawHeader(doc, s.title, s.subtitle, C.amber, W);
  let y = 118;
  s.streams.forEach(([name, desc, pct]) => {
    fillRect(doc, 40, y, W - 80, 52, C.amberBg);
    strokeRect(doc, 40, y, W - 80, 52, C.amberBorder);
    doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(12).text(name, 54, y + 10);
    doc.fillColor(C.amber).font('Helvetica-Bold').fontSize(14)
       .text(`${pct}%`, W - 100, y + 10, { width: 50, align: 'right' });
    // Bar
    const barY = y + 28;
    fillRect(doc, 54, barY, W - 108, 6, C.faint);
    fillRect(doc, 54, barY, (W - 108) * (pct / 100), 6, C.amber);
    doc.fillColor(C.slate).font('Helvetica').fontSize(10).text(desc, 54, barY + 10);
    y += 60;
  });

  const projY = y + 8;
  doc.fillColor(C.mute).font('Helvetica-Bold').fontSize(10).text('MRR PROJECTIONS', 40, projY, { characterSpacing: 2 });
  const projCardW = (W - 80 - 20) / 3;
  s.projections.forEach(([year, mrr, est], i) => {
    const x = 40 + i * (projCardW + 10);
    const yy = projY + 18;
    fillRect(doc, x, yy, projCardW, 60, C.dark);
    doc.fillColor(C.mute).font('Helvetica').fontSize(10).text(year, x + 12, yy + 10);
    doc.fillColor(C.green).font('Helvetica-Bold').fontSize(20).text(mrr, x + 12, yy + 22);
    doc.fillColor([203, 213, 225]).font('Helvetica').fontSize(10).text(est, x + 12, yy + 46);
  });
}

function drawWins(doc, s, W, H) {
  fillRect(doc, 0, 0, W, H, C.bg);
  drawHeader(doc, s.title, s.subtitle, C.purple, W);
  const cols = 2, gap = 12;
  const colW = (W - 80 - gap) / cols;
  const rowH = 82;
  const startY = 120;
  s.advantages.forEach(([title, desc], i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = 40 + col * (colW + gap);
    const y = startY + row * (rowH + gap);
    fillRect(doc, x, y, colW, rowH, C.white);
    strokeRect(doc, x, y, colW, rowH, C.faint);
    // Number tile
    fillRect(doc, x + 14, y + 14, 28, 28, C.purple);
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(13).text(String(i + 1), x + 14, y + 20, { width: 28, align: 'center' });
    doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(13).text(title, x + 54, y + 14, { width: colW - 64 });
    doc.fillColor(C.slate).font('Helvetica').fontSize(10).text(desc, x + 54, y + 34, { width: colW - 64, lineGap: 2 });
  });
}

function drawCTA(doc, s, W, H) {
  fillRect(doc, 0, 0, W, H, C.dark);
  // Diagonal panel
  fillRect(doc, 0, 0, W, 8, C.green);
  fillRect(doc, 0, H - 8, W, 8, C.green);

  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(42)
     .text(s.title, 40, H / 2 - 100, { width: W - 80, align: 'center' });

  doc.fillColor([148, 163, 184]).font('Helvetica').fontSize(15)
     .text(s.subtitle, 40, H / 2 - 44, { width: W - 80, align: 'center' });

  // CTA buttons
  const btnY = H / 2 + 10;
  let totalW = 0;
  const widths = s.ctas.map(([label]) => {
    doc.font('Helvetica-Bold').fontSize(13);
    const w = doc.widthOfString(label) + 50;
    totalW += w + 16;
    return w;
  });
  totalW -= 16;
  let bx = (W - totalW) / 2;
  s.ctas.forEach(([label, href], i) => {
    const bw = widths[i];
    fillRect(doc, bx, btnY, bw, 44, i === 0 ? C.green : [51, 65, 85]);
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(13)
       .text(label, bx, btnY + 15, { width: bw, align: 'center', link: href });
    bx += bw + 16;
  });

  // Contact
  const cy = H - 90;
  doc.fillColor(C.mute).font('Helvetica-Bold').fontSize(9).text('EMAIL', 0, cy, { width: W / 2 - 20, align: 'right', characterSpacing: 2 });
  doc.text('WEBSITE', W / 2 + 20, cy, { width: W / 2, align: 'left', characterSpacing: 2 });
  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(14)
     .text(s.contact.email, 0, cy + 14, { width: W / 2 - 20, align: 'right' });
  doc.text(s.contact.web, W / 2 + 20, cy + 14, { width: W / 2, align: 'left' });
}

const DRAWERS = {
  cover: drawCover, problem: drawProblem, solution: drawSolution, features: drawFeatures,
  tech: drawTech, market: drawMarket, pricing: drawPricing, traction: drawTraction,
  revenue: drawRevenue, wins: drawWins, cta: drawCTA,
};

async function generatePdf() {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', layout: 'landscape', margin: 0, bufferPages: true,
      info: {
        Title:   'AreaConnect — Pitch Deck 2026',
        Author:  'AreaConnect Technologies',
        Subject: 'Investor and prospect pitch deck',
      },
    });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;
    const H = doc.page.height;

    SLIDES.forEach((s, i) => {
      if (i > 0) doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 });
      const painter = DRAWERS[s.type];
      if (painter) painter(doc, s, W, H);
      if (s.type !== 'cover' && s.type !== 'cta') drawFooter(doc, i, SLIDES.length, W, H);
    });

    doc.end();
  });
}

(async () => {
  console.log('→ Generating pitch deck PDF…');
  const pdfBuffer = await generatePdf();
  const localPath = '/tmp/AreaConnect-Pitch-Deck-2026.pdf';
  try { fs.writeFileSync(localPath, pdfBuffer); console.log(`✓ Local copy saved → ${localPath}`); } catch {}
  console.log(`✓ PDF generated (${(pdfBuffer.length / 1024).toFixed(1)} KB, ${SLIDES.length} slides)`);

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.RESEND_FROM || 'Orizu <noreply@areaconnect.pro>';
  const filename = `AreaConnect-Pitch-Deck-2026.pdf`;

  console.log(`→ Sending to ${to}…`);
  const { data, error } = await resend.emails.send({
    from, to,
    subject: 'AreaConnect — Pitch Deck 2026 (for today\'s estate demo)',
    html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;padding:28px 16px;margin:0;">
<div style="max-width:600px;margin:0 auto;">
  <div style="text-align:center;margin-bottom:16px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#111;">Area<span style="color:#10B981;">Connect</span></span>
  </div>
  <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">
    <div style="background:linear-gradient(135deg,#064E3B,#047857);padding:28px 32px;color:#fff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.75);margin-bottom:4px;">Pitch deck · 2026</div>
      <h1 style="font-size:22px;font-weight:800;letter-spacing:-0.02em;margin:0;">Deck for today's demo &mdash; attached</h1>
    </div>
    <div style="padding:28px 32px;">
      <p style="font-size:15px;color:#374151;line-height:1.65;margin:0 0 16px;">
        The full <strong>AreaConnect</strong> pitch deck is attached as a PDF for today's estate demo.
      </p>
      <p style="font-size:14px;color:#475569;line-height:1.6;margin:0 0 18px;">
        11 slides: the problem, the 5-app solution, core features, tech stack, market, pricing, traction, revenue model, why we win, and the call-to-action.
      </p>
      <p style="font-size:12px;color:#94A3B8;margin:0;">
        Need an edit before the meeting? Reply to this email.
      </p>
    </div>
    <div style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:12px 20px;">
      <span style="font-size:11px;color:#94A3B8;">AreaConnect Estate Management &middot; areaconnect.pro</span>
    </div>
  </div>
</div>
</body></html>`,
    attachments: [{ filename, content: pdfBuffer.toString('base64') }],
  });

  if (error) {
    console.error('✖ Resend error:', error);
    process.exit(1);
  }
  console.log(`✓ Sent. Message id: ${data?.id}`);
})().catch(err => {
  console.error('✖ Failed:', err);
  process.exit(1);
});
