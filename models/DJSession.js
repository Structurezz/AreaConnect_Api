const mongoose = require('mongoose');

const nowPlayingSchema = new mongoose.Schema({
  videoId:   { type: String },
  title:     { type: String },
  artist:    { type: String },
  startedAt: { type: Date, default: Date.now },
  seekSec:   { type: Number, default: 0 },
}, { _id: false });

const djSessionSchema = new mongoose.Schema({
  estateId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true, index: true },
  hostUserId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  hostName:    { type: String, default: '' },
  hostPhoto:   { type: String, default: '' },
  title:       { type: String, default: 'Live Set' },
  kind:        { type: String, enum: ['dj', 'announcement', 'prayer', 'chat', 'podcast'], default: 'dj' },
  message:     { type: String, default: '' }, // short banner text for announcement mode
  isLive:      { type: Boolean, default: true },
  startedAt:   { type: Date, default: Date.now },
  endedAt:     { type: Date, default: null },
  nowPlaying:  { type: nowPlayingSchema, default: () => ({}) },
  musicVolume: { type: Number, default: 60, min: 0, max: 100 },
  peakListeners: { type: Number, default: 0 },
}, { timestamps: true });

djSessionSchema.index({ estateId: 1, isLive: 1 });

module.exports = mongoose.model('DJSession', djSessionSchema);
