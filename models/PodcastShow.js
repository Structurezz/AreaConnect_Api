const mongoose = require('mongoose');
const crypto    = require('crypto');

const guestInviteSchema = new mongoose.Schema({
  inviteToken: { type: String, default: () => crypto.randomBytes(16).toString('hex'), index: true },
  name:        { type: String, required: true },
  estate:      { type: String, default: '' },
  phone:       { type: String, default: '' },
  email:       { type: String, default: '' },
  status:      { type: String, enum: ['pending', 'joined', 'left', 'revoked'], default: 'pending' },
  joinedAt:    { type: Date },
  leftAt:      { type: Date },
  createdAt:   { type: Date, default: Date.now },
}, { _id: true });

const podcastShowSchema = new mongoose.Schema({
  hostUserId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  hostName:     { type: String, default: 'AreaConnect FM' },
  title:        { type: String, required: true },
  description:  { type: String, default: '' },
  coverImage:   { type: String, default: '' },
  scheduledAt:  { type: Date },
  status:       { type: String, enum: ['scheduled', 'live', 'ended'], default: 'scheduled', index: true },
  startedAt:    { type: Date },
  endedAt:      { type: Date },
  isRecurring:  { type: Boolean, default: false }, // e.g. Friday Talk Show
  recurrence:   { type: String, default: '' },     // human label
  guests:       [guestInviteSchema],
  peakListeners:{ type: Number, default: 0 },

  // Optional background music the host mixes under their voice (radio-style).
  nowPlaying: {
    videoId:   { type: String },
    title:     { type: String },
    artist:    { type: String },
    startedAt: { type: Date },
  },
  musicVolume: { type: Number, default: 35, min: 0, max: 100 },
  episodeId:    { type: mongoose.Schema.Types.ObjectId, ref: 'PodcastEpisode' },
}, { timestamps: true });

podcastShowSchema.index({ status: 1, scheduledAt: 1 });

module.exports = mongoose.model('PodcastShow', podcastShowSchema);
