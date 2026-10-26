const mongoose = require('mongoose');

// An admin invitation for an estate manager to self-onboard via the Register page.
const onboardingInviteSchema = new mongoose.Schema({
  token:        { type: String, required: true, unique: true, index: true },
  name:         { type: String, default: '', trim: true },
  email:        { type: String, required: true, lowercase: true, trim: true, index: true },
  phone:        { type: String, default: '' },
  estateName:   { type: String, default: '', trim: true },
  estateAddress:{ type: String, default: '' },
  planSlug:     { type: String, default: 'growth' },
  note:         { type: String, default: '' },
  status:       { type: String, enum: ['pending', 'accepted', 'revoked', 'expired'], default: 'pending' },
  sentCount:    { type: Number, default: 1 },
  lastSentAt:   { type: Date, default: Date.now },
  expiresAt:    { type: Date, required: true },
  acceptedAt:   Date,
  estateId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Estate' },
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  invitedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('OnboardingInvite', onboardingInviteSchema);
