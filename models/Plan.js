const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true },
  description: { type: String, default: '' },
  color: { type: String, default: '#7C3AED' },
  badge: { type: String, default: '' },

  price: {
    monthly: { type: Number, default: 0 },
    annual:  { type: Number, default: 0 },
  },

  features: {
    // Limits (-1 = unlimited)
    maxResidents:        { type: Number, default: 20 },
    maxUnits:            { type: Number, default: 10 },
    maxVisitorsPerMonth: { type: Number, default: 50 },

    // Core
    visitorManagement:   { type: Boolean, default: true },
    residentManagement:  { type: Boolean, default: true },
    unitManagement:      { type: Boolean, default: true },

    // Communication
    announcements:       { type: Boolean, default: false },
    communityChat:       { type: Boolean, default: false },
    nkechiAI:            { type: Boolean, default: false },

    // Commerce
    marketplace:         { type: Boolean, default: false },
    paymentSystem:       { type: Boolean, default: false },

    // Safety
    securityPortal:      { type: Boolean, default: false },
    emergencyBroadcast:  { type: Boolean, default: false },

    // Entertainment (Resident Lounge)
    residentLounge:      { type: Boolean, default: false },
    musicPlayer:         { type: Boolean, default: false },
    fridayNightFunTimes: { type: Boolean, default: false },
    eventBoard:          { type: Boolean, default: false },
    pollsAndVoting:      { type: Boolean, default: false },

    // Analytics & Admin
    analytics:           { type: String, enum: ['none', 'basic', 'full'], default: 'none' },
    customBranding:      { type: Boolean, default: false },
    apiAccess:           { type: Boolean, default: false },
    prioritySupport:     { type: Boolean, default: false },
    whiteLabel:          { type: Boolean, default: false },
  },

  isActive:  { type: Boolean, default: true },
  isDefault: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Plan', planSchema);
