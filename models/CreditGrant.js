const mongoose = require('mongoose');

// Audit record for a bonus-credit grant made by an AreaConnect admin. The
// per-user credits themselves live in CreditTransaction (type 'grant').
const creditGrantSchema = new mongoose.Schema({
  adminId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Client-generated per grant attempt; retries reuse the same record.
  requestId:      { type: String, required: true },
  scope:          { type: String, enum: ['users', 'estates'], required: true },
  estateIds:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'Estate' }],
  creditsEach:    { type: Number, required: true, min: 1 },
  recipients:     { type: Number, default: 0 },  // users actually credited
  totalCredits:   { type: Number, default: 0 },
  note:           { type: String, default: '', maxlength: 200 },
  status:         { type: String, enum: ['processing', 'done', 'partial'], default: 'processing' },
}, { timestamps: true });

creditGrantSchema.index({ createdAt: -1 });
creditGrantSchema.index({ requestId: 1 }, { unique: true });

module.exports = mongoose.model('CreditGrant', creditGrantSchema);
