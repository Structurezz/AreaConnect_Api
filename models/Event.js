const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  estateId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  title:      { type: String, required: true, trim: true },
  description:{ type: String, default: '' },
  date:       { type: Date, required: true },
  time:       { type: String, default: '' },
  location:   { type: String, default: '' },
  organizer:  { type: String, default: '' },
  isFridayFunTimes: { type: Boolean, default: false },
  rsvps:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isActive:   { type: Boolean, default: true },
}, { timestamps: true });

eventSchema.index({ estateId: 1, date: 1 });
module.exports = mongoose.model('Event', eventSchema);
