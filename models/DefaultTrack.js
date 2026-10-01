const mongoose = require('mongoose');

const defaultTrackSchema = new mongoose.Schema({
  videoId:   { type: String, required: true, unique: true, trim: true },
  title:     { type: String, required: true, trim: true },
  artist:    { type: String, default: '', trim: true },
  // Lower order = earlier in the house playlist. Not strictly required
  // (frontend already shuffles) but lets admins pin favourites to the top.
  order:     { type: Number, default: 0 },
  // Soft-disable so a bad track can be hidden without losing the record
  isActive:  { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

defaultTrackSchema.index({ isActive: 1, order: 1 });

module.exports = mongoose.model('DefaultTrack', defaultTrackSchema);
