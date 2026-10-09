const mongoose = require('mongoose');

// A single pageview on the public landing site. We never store the raw IP —
// only a salted hash, used to compute unique-visitor counts without
// identifying anyone. Country + city are resolved asynchronously via a
// best-effort ip-api.com lookup; absence of a result is normal.
const siteVisitSchema = new mongoose.Schema({
  path:      { type: String, required: true, index: true },
  referrer:  { type: String, default: '' },

  utm: {
    source:   { type: String, default: '' },
    medium:   { type: String, default: '' },
    campaign: { type: String, default: '' },
    term:     { type: String, default: '' },
    content:  { type: String, default: '' },
  },

  // Client-reported fingerprint — approximate, intentionally minimal
  userAgent:  { type: String, default: '' },
  language:   { type: String, default: '' },
  timezone:   { type: String, default: '' },
  screen:     { type: String, default: '' }, // "1440x900"
  isMobile:   { type: Boolean, default: false },
  device:     { type: String, default: '' }, // mobile, tablet, desktop
  browser:    { type: String, default: '' }, // Chrome, Safari, Firefox, …
  os:         { type: String, default: '' },

  // Session identity — sent by client; also hashed IP so we can approximate
  // unique visitors across sessions.
  sessionId:  { type: String, default: '', index: true },
  ipHash:     { type: String, default: '', index: true },

  // Geo (filled by async lookup; may be blank)
  country:    { type: String, default: '' },
  countryCode:{ type: String, default: '' },
  city:       { type: String, default: '' },
  region:     { type: String, default: '' },

  visitedAt:  { type: Date, default: Date.now, index: true },
}, { timestamps: false });

siteVisitSchema.index({ visitedAt: -1 });
siteVisitSchema.index({ 'utm.source': 1, visitedAt: -1 });

module.exports = mongoose.model('SiteVisit', siteVisitSchema);
