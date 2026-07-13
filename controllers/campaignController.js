const Campaign = require('../models/Campaign');
const User = require('../models/User');
const emailService = require('../services/emailService');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const BRAND = {
  name: 'AreaConnect',
  tagline: 'Your estate, together.',
  logoText: 'Area<span style="color:{PRIMARY}">Connect</span>',
  footer: 'Powered by Area Connector Technologies · RC 9607864',
};

const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

exports.listAll = async (req, res) => {
  try {
    const { status, placement, q } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (placement) filter.placements = placement;
    if (q) filter.name = { $regex: q, $options: 'i' };

    const campaigns = await Campaign.find(filter)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: campaigns });
  } catch (err) {
    console.error('listAll campaigns', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getById = async (req, res) => {
  try {
    const c = await Campaign.findById(req.params.id).populate('createdBy', 'name email');
    if (!c) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, data: c });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.create = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.name || !body.content?.headline) {
      return res.status(400).json({ success: false, message: 'name and content.headline required' });
    }

    const baseSlug = slugify(body.slug || body.name);
    let slug = baseSlug || `campaign-${Date.now()}`;
    let n = 1;
    while (await Campaign.exists({ slug })) {
      n += 1;
      slug = `${baseSlug}-${n}`;
    }

    const campaign = await Campaign.create({
      ...body,
      slug,
      createdBy: req.user._id,
    });

    return res.status(201).json({ success: true, data: campaign });
  } catch (err) {
    console.error('create campaign', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

exports.update = async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.slug;
    delete updates.metrics;
    delete updates.seenBy;
    delete updates.dismissedBy;

    const c = await Campaign.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!c) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, data: c });
  } catch (err) {
    console.error('update campaign', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

exports.setStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!Campaign.STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const c = await Campaign.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!c) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, data: c });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.remove = async (req, res) => {
  try {
    await Campaign.findByIdAndDelete(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Public: for authenticated end users ─────────────────────────────────────
exports.getActiveForUser = async (req, res) => {
  try {
    const { placement } = req.query;
    const filter = { status: 'active' };
    if (placement) filter.placements = placement;

    const now = new Date();
    const candidates = await Campaign.find(filter).sort({ createdAt: -1 });

    const matched = candidates.filter((c) => {
      if (c.schedule?.startAt && c.schedule.startAt > now) return false;
      if (c.schedule?.endAt && c.schedule.endAt < now) return false;
      return c.matchesUser(req.user);
    });

    const uid = req.user._id.toString();
    const withState = matched.map((c) => {
      const dismissed = (c.dismissedBy || []).some((id) => id.toString() === uid);
      const seen = (c.seenBy || []).some((id) => id.toString() === uid);
      return { ...c.toObject(), _viewer: { seen, dismissed } };
    });

    const fresh = withState.filter((c) => !c._viewer.dismissed);
    return res.json({ success: true, data: fresh });
  } catch (err) {
    console.error('getActiveForUser', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.markSeen = async (req, res) => {
  try {
    await Campaign.findByIdAndUpdate(req.params.id, {
      $addToSet: { seenBy: req.user._id },
      $inc: { 'metrics.impressions': 1 },
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.dismiss = async (req, res) => {
  try {
    await Campaign.findByIdAndUpdate(req.params.id, {
      $addToSet: { dismissedBy: req.user._id },
      $inc: { 'metrics.dismissals': 1 },
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.click = async (req, res) => {
  try {
    await Campaign.findByIdAndUpdate(req.params.id, { $inc: { 'metrics.clicks': 1 } });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Send email to matching users on demand ──────────────────────────────────
exports.sendEmailBlast = async (req, res) => {
  try {
    const c = await Campaign.findById(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: 'Not found' });
    if (!c.placements.includes('email')) {
      return res.status(400).json({ success: false, message: 'Campaign is not an email placement' });
    }
    if (!c.email?.subject || !c.email?.htmlBody) {
      return res.status(400).json({ success: false, message: 'Email subject and body required' });
    }

    const users = await User.find({ isActive: true }).select('name email role estateId createdAt').lean();
    const targets = users.filter((u) => c.matchesUser(u));

    const results = await Promise.allSettled(
      targets.map((u) =>
        emailService.sendCampaignEmail({
          to: u.email,
          name: u.name,
          subject: c.email.subject,
          preheader: c.email.preheader,
          htmlBody: c.email.htmlBody,
          ctaUrl: c.content.ctaUrl,
          ctaText: c.content.ctaText,
          theme: c.content.theme,
          brand: { name: 'AreaConnect', logoUrl: process.env.BRAND_LOGO_URL || '' },
        })
      )
    );

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    await Campaign.findByIdAndUpdate(c._id, { $inc: { 'metrics.emailsSent': sent } });

    return res.json({ success: true, data: { targeted: targets.length, sent } });
  } catch (err) {
    console.error('sendEmailBlast', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// ── AI: generate email + ad content with Gemini ─────────────────────────────
exports.generateEmailContent = async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ success: false, message: 'GEMINI_API_KEY not configured' });
    }

    const {
      goal = 'Welcome new members and introduce the platform',
      audience = 'new residents on AreaConnect',
      tone = 'warm, confident, briefly witty',
      theme = {},
      brand = {},
      ctaText,
      ctaUrl,
      includeAd = true,
    } = req.body || {};

    const primary   = theme.primaryColor     || '#EC4899';
    const accent    = theme.accentColor      || '#F472B6';
    const bg        = theme.backgroundColor  || '#0F172A';
    const textColor = theme.textColor        || '#FFFFFF';
    const brandName = brand.name  || BRAND.name;
    const logoUrl   = brand.logoUrl || '';

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `You are a senior email designer + copywriter for "${brandName}", a Nigerian estate-management SaaS. Write a marketing email that looks like a modern SaaS product email (Linear, Notion, Stripe) — visually structured, not a wall of text.

GOAL: ${goal}
AUDIENCE: ${audience}
TONE: ${tone}
BRAND COLORS: primary=${primary}, accent=${accent}, background=${bg}, text=${textColor}
CTA TEXT (if provided, keep it): ${ctaText || '(pick one)'}
CTA URL: ${ctaUrl || '(none — do not invent one)'}

DESIGN LANGUAGE (the server wraps a logo header + gradient stripe + footer around your snippet — do NOT include those):
- Open with a bold H1 headline (fontSize:22-26px, fontWeight:800, letterSpacing:-0.02em, color:#0F172A, marginBottom:8px). One line.
- Follow with an intro paragraph (fontSize:15px, color:#475569, lineHeight:1.65).
- Include 2-4 "feature callouts" as div blocks with borderLeft:3px solid ${primary}, background:#F8FAFC, padding:14px 16px, borderRadius:8px, marginBottom:12px. Each has a bold title line (fontSize:14px, fontWeight:700, color:#0F172A) and a supporting line (fontSize:13px, color:#64748B, lineHeight:1.55). A single small emoji at the START of the title is fine.
- Between blocks, use a subtle divider: <div style="height:1px;background:#F1F5F9;margin:20px 0;"></div>
- Optionally add a quote/highlight card with background:${primary}0F, border:1px solid ${primary}33, padding:16px 18px, borderRadius:12px.
- Close with one short human sign-off paragraph (fontSize:14px, color:#475569).

HARD RULES
- HTML is a snippet only — no <html>, <head>, <body>, <style>, <script>, <link>, or <img> tags. No class attributes. Inline styles only.
- Address the reader once as "Hi {{name}}," on its own line before the H1. Use the literal placeholder — the server substitutes it.
- No "click here" language. CTAs are concrete verbs.
- Max 3 emojis in the entire body. None in subject or preheader.
- The subject uses no emojis. Under 60 chars. Concrete.
- The preheader is a distinct value-prop teaser (not "welcome to X"). Under 90 chars.
- Do NOT include the CTA button in htmlBody — the server appends it based on ctaText/ctaUrl.

RESPOND WITH ONLY RAW JSON — no markdown, no code fences, no commentary. Start with { and end with }.

Schema:
{
  "subject": "email subject line (max 60 chars, no emojis)",
  "preheader": "preview text shown in inbox (max 90 chars, no emojis, no {{name}})",
  "htmlBody": "the styled HTML snippet described above (structured divs, not paragraphs)",
  "ad": {
    "badge": "SHORT UPPERCASE BADGE (max 3 words)",
    "headline": "punchy headline (max 60 chars)",
    "subheadline": "one-line follow-up (max 80 chars)",
    "body": "2–3 short lines, plain text, separated by \\n\\n",
    "ctaText": "concrete verb CTA (2–4 words)"
  }
}`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) {
        return res.status(500).json({ success: false, message: 'AI returned unparseable content' });
      }
      parsed = JSON.parse(match[0]);
    }

    // Basic sanitization
    const email = {
      subject:   String(parsed.subject   || '').slice(0, 140),
      preheader: String(parsed.preheader || '').slice(0, 180),
      htmlBody:  String(parsed.htmlBody  || ''),
    };
    const ad = includeAd && parsed.ad ? {
      badge:       String(parsed.ad.badge       || '').slice(0, 40),
      headline:    String(parsed.ad.headline    || '').slice(0, 120),
      subheadline: String(parsed.ad.subheadline || '').slice(0, 180),
      body:        String(parsed.ad.body        || ''),
      ctaText:     String(parsed.ad.ctaText     || 'Get Started').slice(0, 40),
    } : null;

    return res.json({
      success: true,
      data: {
        email,
        ad,
        theme: { primaryColor: primary, accentColor: accent, backgroundColor: bg, textColor },
        brand: { name: brandName, logoUrl },
      },
    });
  } catch (err) {
    console.error('generateEmailContent', err);
    return res.status(500).json({ success: false, message: err.message || 'AI generation failed' });
  }
};

// Called from authController on signup — fires email campaigns marked sendOnUserSignup
exports.onUserSignup = async (user) => {
  try {
    const campaigns = await Campaign.find({
      status: 'active',
      placements: 'email',
      'email.sendOnUserSignup': true,
    });

    for (const c of campaigns) {
      if (!c.matchesUser(user)) continue;
      if (!c.email?.subject || !c.email?.htmlBody) continue;

      try {
        await emailService.sendCampaignEmail({
          to: user.email,
          name: user.name,
          subject: c.email.subject,
          preheader: c.email.preheader,
          htmlBody: c.email.htmlBody,
          ctaUrl: c.content.ctaUrl,
          ctaText: c.content.ctaText,
          theme: c.content.theme,
          brand: { name: 'AreaConnect', logoUrl: process.env.BRAND_LOGO_URL || '' },
        });
        await Campaign.findByIdAndUpdate(c._id, { $inc: { 'metrics.emailsSent': 1 } });
      } catch (e) {
        console.error('campaign email on signup failed', c.slug, e.message);
      }
    }
  } catch (err) {
    console.error('onUserSignup campaigns', err);
  }
};
