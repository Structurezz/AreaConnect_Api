const mongoose = require('mongoose');

const securityLogSchema = new mongoose.Schema({
  estateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  action: {
    type: String,
    enum: ['visitor_entry', 'visitor_exit', 'access_denied', 'alert_raised', 'alert_resolved'],
    required: true,
  },
  visitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Visitor' },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  details: { type: String, default: '' },
  ipAddress: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('SecurityLog', securityLogSchema);
