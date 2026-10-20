const mongoose = require('mongoose');

// Landing-page demo calls. Stored so booked slots disappear from the calendar
// widget, whichever meeting provider created the call.
const demoBookingSchema = new mongoose.Schema({
  start:       { type: Date, required: true },
  end:         { type: Date, required: true },
  name:        { type: String, required: true },
  email:       { type: String, required: true, lowercase: true, trim: true },
  company:     String,
  phone:       String,
  notes:       String,
  provider:    { type: String, enum: ['zoho', 'google', 'none'], default: 'none' },
  meetingKey:  String,
  joinLink:    String,
  startLink:   String,
  status:      { type: String, enum: ['booked', 'cancelled'], default: 'booked' },
}, { timestamps: true });

// One live booking per slot.
demoBookingSchema.index({ start: 1 }, { unique: true, partialFilterExpression: { status: 'booked' } });

module.exports = mongoose.model('DemoBooking', demoBookingSchema);
