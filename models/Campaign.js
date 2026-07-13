const mongoose = require('mongoose');

const PLACEMENTS = ['modal', 'email', 'login_sidebar', 'lounge_feed', 'dashboard_banner'];
const AUDIENCE_SEGMENTS = ['all', 'new_users', 'existing_users', 'by_role', 'by_estate'];
const STATUSES = ['draft', 'active', 'paused', 'ended'];
const APPS = ['residents', 'estatemanager', 'both'];

const campaignSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  status: { type: String, enum: STATUSES, default: 'draft', index: true },

  placements: {
    type: [{ type: String, enum: PLACEMENTS }],
    default: ['modal'],
  },

  audience: {
    segment: { type: String, enum: AUDIENCE_SEGMENTS, default: 'all' },
    newUserWithinDays: { type: Number, default: 7, min: 1, max: 365 },
    existingUserBeyondDays: { type: Number, default: 7, min: 1, max: 365 },
    roles: [{ type: String, enum: ['resident', 'estate_manager'] }],
    estateIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Estate' }],
    app: { type: String, enum: APPS, default: 'residents' },
  },

  content: {
    headline: { type: String, required: true, trim: true },
    subheadline: { type: String, default: '', trim: true },
    body: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    ctaText: { type: String, default: 'Get Started' },
    ctaUrl: { type: String, default: '' },
    theme: {
      primaryColor: { type: String, default: '#EC4899' },
      accentColor: { type: String, default: '#F472B6' },
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

  schedule: {
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
  },

  metrics: {
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    dismissals: { type: Number, default: 0 },
    emailsSent: { type: Number, default: 0 },
  },

  seenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  dismissedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

campaignSchema.index({ status: 1, placements: 1 });
campaignSchema.index({ 'schedule.startAt': 1, 'schedule.endAt': 1 });

campaignSchema.methods.matchesUser = function (user) {
  const a = this.audience || {};

  if (a.app && a.app !== 'both') {
    const appRole = a.app === 'residents' ? 'resident' : 'estate_manager';
    if (user.role !== appRole) return false;
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
      if (!user.estateId) return false;
      return (a.estateIds || []).some(id => id.toString() === user.estateId.toString());
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

campaignSchema.statics.PLACEMENTS = PLACEMENTS;
campaignSchema.statics.AUDIENCE_SEGMENTS = AUDIENCE_SEGMENTS;
campaignSchema.statics.STATUSES = STATUSES;
campaignSchema.statics.APPS = APPS;

module.exports = mongoose.model('Campaign', campaignSchema);
