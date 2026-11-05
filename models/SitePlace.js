const mongoose = require('mongoose');

// A real-world place on a site, pinned on Google Maps: a hall / hostel, a
// faculty or building, a gate, the clinic… Units link to a place with
// unit.placeId (or by matching place.block to unit.block), so members,
// visitors and guards get directions to the right building on big campuses.
const KINDS = ['hall', 'building', 'faculty', 'gate', 'clinic', 'library', 'sports', 'parking', 'security', 'chapel', 'food', 'office', 'other'];

const sitePlaceSchema = new mongoose.Schema({
  estateId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true, index: true },
  name:        { type: String, required: true, trim: true, maxlength: 120 },
  kind:        { type: String, enum: KINDS, default: 'building' },
  block:       { type: String, default: '', trim: true }, // matches Unit.block (e.g. hall name)
  description: { type: String, default: '', trim: true, maxlength: 500 },
  lat:         { type: Number, required: true, min: -90, max: 90 },
  lng:         { type: Number, required: true, min: -180, max: 180 },
  googlePlaceId: { type: String, default: '' },
  address:     { type: String, default: '' },
  isPublic:    { type: Boolean, default: true }, // shown to members and on visitor passes
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

sitePlaceSchema.statics.KINDS = KINDS;

module.exports = mongoose.model('SitePlace', sitePlaceSchema);
