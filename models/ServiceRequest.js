const mongoose = require('mongoose');

// A member's request to site staff (utils/siteRoles REQUEST_KINDS): hotel
// housekeeping / repairs / room service, "call a nurse", hostel repairs,
// sick bay, an injury or hazard report on an industrial site…
const serviceRequestSchema = new mongoose.Schema({
  estateId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  requesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  unitId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', default: null },
  kind:        { type: String, required: true },
  note:        { type: String, default: '', trim: true, maxlength: 1000 },
  urgent:      { type: Boolean, default: false },
  roles:       [{ type: String }],                       // staff roles it went to
  routedTo:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  status:      { type: String, enum: ['open', 'accepted', 'done', 'cancelled'], default: 'open' },
  assigneeId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  acceptedAt:  { type: Date, default: null },
  doneAt:      { type: Date, default: null },
  reply:       { type: String, default: '', trim: true, maxlength: 500 },
  // Conversation on the request between the requester, the care workers it
  // went to and the managers.
  messages: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name:   String,
    role:   String,  // label: Patient, Nurse, Doctor, Administrator…
    text:   { type: String, trim: true, maxlength: 1000 },
    at:     { type: Date, default: Date.now },
  }],
  // A manager-created task for staff (not from a member)
  fromManager: { type: Boolean, default: false },
  subjectId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // e.g. the patient it's about
}, { timestamps: true });

serviceRequestSchema.index({ estateId: 1, status: 1, createdAt: -1 });
serviceRequestSchema.index({ routedTo: 1, status: 1 });

serviceRequestSchema.index({ estateId: 1, requesterId: 1, createdAt: -1 });
serviceRequestSchema.index({ assigneeId: 1, status: 1 });

module.exports = mongoose.model('ServiceRequest', serviceRequestSchema);
