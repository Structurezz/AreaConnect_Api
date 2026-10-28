const mongoose = require('mongoose');

const podcastEpisodeSchema = new mongoose.Schema({
  showId:          { type: mongoose.Schema.Types.ObjectId, ref: 'PodcastShow', required: true, index: true },
  hostUserId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  hostName:        { type: String, default: 'AreaConnect FM' },
  title:           { type: String, required: true },
  description:     { type: String, default: '' },
  coverImage:      { type: String, default: '' },
  audioUrl:        { type: String, default: '' },
  durationSec:     { type: Number, default: 0 },
  guestNames:      [{ type: String }],
  peakListeners:   { type: Number, default: 0 },
  playCount:       { type: Number, default: 0 },
  publishedAt:     { type: Date, default: Date.now },
  isPublished:     { type: Boolean, default: true },
  featured:        { type: Boolean, default: false },
  category:        { type: String, default: 'community' },
  tags:            [{ type: String }],
  seriesName:      { type: String, default: '' },
  episodeNumber:   { type: Number, default: 0 },
  showNotes:       { type: String, default: '' },
  audience: {
    scope:     { type: String, enum: ['all', 'estates'], default: 'all' },
    estateIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Estate' }],
  },
}, { timestamps: true });

podcastEpisodeSchema.index({ publishedAt: -1 });

module.exports = mongoose.model('PodcastEpisode', podcastEpisodeSchema);
