const mongoose = require('mongoose');

// Channels that actually deliver today. login_sidebar is kept for legacy rows only.
const PLACEMENTS = ['modal', 'dashboard_banner', 'lounge_feed', 'email', 'push', 'login_sidebar'];
// What the campaign is trying to move — maps to a real AreaConnect feature.
const GOALS = ['onboarding', 'payments', 'visitors', 'security', 'community', 'marketplace', 'podcast', 'upgrade', 'referral', 'announcement', 'retention'];
const FREQUENCIES = ['until_dismissed', 'once', 'until_clicked'];
const SUB_STATUSES = ['trial', 'active', 'expired', 'suspended', 'cancelled', 'none'];
const AUDIENCE_SEGMENTS = ['all', 'new_users', 'existing_users', 'by_role', 'by_estate'];
const STATUSES = ['draft', 'active', 'paused', 'ended'];
const ROLES = ['resident', 'estate_manager'];
// APPS accepts both the newer, role-aligned keys and the legacy keys so
// pre-existing campaigns in the DB (app: 'residents' / 'estatemanager') keep working.
const APPS = ['resident', 'residents', 'estate_manager', 'estatemanager', 'both'];

const APP_TO_ROLE = {
  resident: 'resident',
  residents: 'resident',
  estate_manager: 'estate_manager',
  estatemanager: 'estate_manager',
};

const campaignSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  status: { type: String, enum: STATUSES, default: 'draft', index: true },
  goal: { type: String, enum: GOALS, default: 'onboarding' },
  priority: { type: Number, default: 2, min: 1, max: 3 }, // 1 = high
  frequency: { type: String, enum: FREQUENCIES, default: 'until_dismissed' },
  notes: { type: String, default: '' },

  placements: {
    type: [{ type: String, enum: PLACEMENTS }],
    default: ['modal'],
  },

  audience: {
    segment: { type: String, enum: AUDIENCE_SEGMENTS, default: 'all' },
    newUserWithinDays: { type: Number, default: 7, min: 1, max: 365 },
    existingUserBeyondDays: { type: Number, default: 7, min: 1, max: 365 },
    roles: [{ type: String, enum: ROLES }],
    estateIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Estate' }],
    app: { type: String, enum: APPS, default: 'resident' },
    excludeEstateIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Estate' }],
    states: [{ type: String, trim: true }],
    subscriptionStatuses: [{ type: String, enum: SUB_STATUSES }],
    activeWithinDays: { type: Number, default: 0, min: 0, max: 365 }, // 0 = any
  },

  content: {
    headline: { type: String, required: true, trim: true },
    subheadline: { type: String, default: '', trim: true },
    body: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    ctaText: { type: String, default: 'Get Started' },
    ctaUrl: { type: String, default: '' },
    theme: {
      primaryColor: { type: String, default: '#059669' },
      accentColor: { type: String, default: '#34D399' },
      textColor: { type: String, default: '#FFFFFF' },
      backgroundColor: { type: String, default: '#0F172A' },
    },
    badge: { type: String, default: '' },
  },

  email: {
    subject: { type: String, default: '' },
    preheader: { type: String, default: '' },
    htmlBody: { type: String, default: '' },
    sendOnUserSignup: { type: Boolean, default: false },
  },

  push: {
    title: { type: String, default: '' },
    body: { type: String, default: '' },
    url: { type: String, default: '' },
  },

  sends: [{
    channel: { type: String, enum: ['email', 'push', 'test_email'] },
    at: { type: Date, default: Date.now },
    targeted: Number,
    sent: Number,
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  }],

  schedule: {
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
  },

  metrics: {
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    dismissals: { type: Number, default: 0 },
    emailsSent: { type: Number, default: 0 },
    pushesSent: { type: Number, default: 0 },
  },

  seenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  dismissedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  clickedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

campaignSchema.index({ status: 1, placements: 1 });
campaignSchema.index({ 'schedule.startAt': 1, 'schedule.endAt': 1 });

// ctx (optional): { state, subStatus } for the user's estate — needed only when the
// audience filters on location or subscription status.
campaignSchema.methods.matchesUser = function (user, ctx = {}) {
  const a = this.audience || {};
  const eid = user.estateId && (user.estateId._id || user.estateId).toString();

  if (eid && (a.excludeEstateIds || []).some((id) => id.toString() === eid)) return false;
  if ((a.states || []).length) {
    const st = (ctx.state || '').toLowerCase();
    if (!st || !a.states.some((x) => x.toLowerCase() === st)) return false;
  }
  if ((a.subscriptionStatuses || []).length && !a.subscriptionStatuses.includes(ctx.subStatus || 'none')) return false;
  if (a.activeWithinDays > 0) {
    const seen = user.lastSeen ? new Date(user.lastSeen).getTime() : 0;
    if (Date.now() - seen > a.activeWithinDays * 86400000) return false;
  }

  // App filter: hard-restricts by the user's role. The by_role segment carries
  // its own explicit role list, so let that take precedence instead of double-filtering.
  if (a.app && a.app !== 'both' && a.segment !== 'by_role') {
    const requiredRole = APP_TO_ROLE[a.app];
    if (!requiredRole || user.role !== requiredRole) return false;
  }

  const now = Date.now();
  const ageDays = user.createdAt ? (now - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24) : 999;

  switch (a.segment) {
    case 'all':
      return true;
    case 'new_users':
      return ageDays <= (a.newUserWithinDays || 7);
    case 'existing_users':
      return ageDays >= (a.existingUserBeyondDays || 7);
    case 'by_role':
      return (a.roles || []).includes(user.role);
    case 'by_estate':
      if (!eid) return false;
      return (a.estateIds || []).some(id => id.toString() === eid);
    default:
      return false;
  }
};

campaignSchema.methods.isLive = function () {
  if (this.status !== 'active') return false;
  const now = Date.now();
  if (this.schedule?.startAt && new Date(this.schedule.startAt).getTime() > now) return false;
  if (this.schedule?.endAt && new Date(this.schedule.endAt).getTime() < now) return false;
  return true;
};

campaignSchema.methods.needsEstateCtx = function () {
  const a = this.audience || {};
  return (a.states || []).length > 0 || (a.subscriptionStatuses || []).length > 0;
};

campaignSchema.statics.PLACEMENTS = PLACEMENTS;
campaignSchema.statics.GOALS = GOALS;
campaignSchema.statics.AUDIENCE_SEGMENTS = AUDIENCE_SEGMENTS;
campaignSchema.statics.STATUSES = STATUSES;
campaignSchema.statics.APPS = APPS;
campaignSchema.statics.ROLES = ROLES;
campaignSchema.statics.APP_TO_ROLE = APP_TO_ROLE;

module.exports = mongoose.model('Campaign', campaignSchema);
