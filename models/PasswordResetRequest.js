const mongoose = require('mongoose');

// One row per forgot-password request. Estate managers see pending rows for
// their estate and approve or deny. Approving generates a temp password,
// stores a bcrypt hash on the user, flips mustChangePassword=true, and
// emails the resident. Denying just marks the row.
const passwordResetRequestSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User',   required: true, index: true },
  estateId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true, index: true },

  // Snapshot of who they were at request time (survives if the user is
  // deleted / renamed before the manager reviews).
  requesterName:  { type: String, default: '' },
  requesterEmail: { type: String, default: '' },
  requesterRole:  { type: String, default: '' },
  requesterUnit:  { type: String, default: '' },
  requesterPhone: { type: String, default: '' },

  requesterIp:    { type: String, default: '' },
  userAgent:      { type: String, default: '' },

  status:     { type: String, enum: ['pending', 'approved', 'denied', 'expired'], default: 'pending', index: true },
  requestedAt:{ type: Date, default: Date.now },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date, default: null },
  denyReason: { type: String, default: '' },
}, { timestamps: true });

passwordResetRequestSchema.index({ estateId: 1, status: 1, requestedAt: -1 });

module.exports = mongoose.model('PasswordResetRequest', passwordResetRequestSchema);
