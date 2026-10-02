const mongoose = require('mongoose');

const setlistEntrySchema = new mongoose.Schema({
  videoId:   { type: String, required: true },
  title:     { type: String },
  artist:    { type: String },
  startSec:  { type: Number, required: true }, // offset from mixtape start
  endSec:    { type: Number, required: true },
}, { _id: false });

const mixtapeSchema = new mongoose.Schema({
  estateId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true, index: true },
  sessionId:       { type: mongoose.Schema.Types.ObjectId, ref: 'DJSession' },
  hostUserId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  hostName:        { type: String, default: '' },
  hostPhoto:       { type: String, default: '' },
  title:           { type: String, required: true },
  description:     { type: String, default: '' },
  coverImage:      { type: String, default: '' },
  voiceAudioUrl:   { type: String, default: '' }, // Cloudinary URL for the DJ voice track
  voiceDurationSec:{ type: Number, default: 0 },
  setlist:         [setlistEntrySchema],
  totalDurationSec:{ type: Number, default: 0 },
  playCount:       { type: Number, default: 0 },
  peakListeners:   { type: Number, default: 0 },
}, { timestamps: true });

mixtapeSchema.index({ estateId: 1, createdAt: -1 });

module.exports = mongoose.model('Mixtape', mixtapeSchema);
