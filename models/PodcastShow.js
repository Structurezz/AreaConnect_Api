const mongoose = require('mongoose');
const crypto    = require('crypto');

const guestInviteSchema = new mongoose.Schema({
  inviteToken: { type: String, default: () => crypto.randomBytes(16).toString('hex'), index: true },
  name:        { type: String, required: true },
  estate:      { type: String, default: '' },
  phone:       { type: String, default: '' },
  email:       { type: String, default: '' },
  status:      { type: String, enum: ['pending', 'joined', 'left', 'revoked'], default: 'pending' },
  // Admin hub additions
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // platform user (e.g. estate manager)
  role:        { type: String, enum: ['guest', 'co_host', 'estate_leader', 'expert'], default: 'guest' },
  title:       { type: String, default: '' },   // e.g. "Chairman, Residents' Association"
  topic:       { type: String, default: '' },   // what they will speak about
  emailedAt:   { type: Date },
  emailCount:  { type: Number, default: 0 },
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
  // Admin hub additions
  category:     { type: String, default: 'community' }, // community, security, finance, lifestyle, news, interview, events
  tags:         [{ type: String }],
  language:     { type: String, default: 'English' },
  seriesName:   { type: String, default: '' },
  episodeNumber:{ type: Number, default: 0 },
  durationMins: { type: Number, default: 45 },
  audience: {
    scope:     { type: String, enum: ['all', 'estates'], default: 'all' },
    estateIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Estate' }],
  },
  segments: [{
    title:   { type: String, required: true },
    minutes: { type: Number, default: 5 },
    notes:   { type: String, default: '' },
    speaker: { type: String, default: '' },
  }],
  notes:        { type: String, default: '' },     // private producer notes
  remindedAt:   { type: Date },
  remindCount:  { type: Number, default: 0 },
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
