const Campaign = require('../models/Campaign');
const User = require('../models/User');
const emailService = require('../services/emailService');

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
