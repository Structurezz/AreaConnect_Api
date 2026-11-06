const mongoose = require('mongoose');

// Deliveries and vehicles the guards log at the gate (site module 'gatelog').
const gateLogSchema = new mongoose.Schema({
  estateId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  kind:         { type: String, enum: ['delivery', 'vehicle'], default: 'delivery' },
  vehiclePlate: { type: String, default: '', trim: true, uppercase: true },
  driverName:   { type: String, default: '', trim: true },
  driverPhone:  { type: String, default: '', trim: true },
  company:      { type: String, default: '', trim: true },
  goods:        { type: String, default: '', trim: true },
  destination:  { type: String, default: '', trim: true }, // unit / department / person
  notes:        { type: String, default: '', trim: true },
  timeIn:       { type: Date, default: Date.now },
  timeOut:      { type: Date, default: null },
  loggedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  closedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

gateLogSchema.index({ estateId: 1, timeIn: -1 });

gateLogSchema.index({ estateId: 1, timeOut: 1 });

module.exports = mongoose.model('GateLog', gateLogSchema);
