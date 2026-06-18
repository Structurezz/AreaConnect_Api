const mongoose = require('mongoose');

const prospectSchema = new mongoose.Schema({
  name:    { type: String, required: true },
  title:   { type: String, default: '' },
  company: { type: String, required: true },
  email:   { type: String, required: true },
  phone:   { type: String, default: '' },
  city:    { type: String, default: '' },
  type: {
    type: String,
    enum: ['developer', 'estate_manager', 'property_company', 'investment_firm', 'government'],
    default: 'estate_manager',
  },
  status: {
    type: String,
    enum: ['new', 'contacted', 'interested', 'converted', 'declined'],
    default: 'new',
  },
  website:     { type: String, default: '' },
  emailSentAt: { type: Date },
  notes:       { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Prospect', prospectSchema);
