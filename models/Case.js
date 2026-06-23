const mongoose = require('mongoose');
const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const proceedingSchema = new Schema({
  event: { type: String, enum: [
    'case_filed','case_opened','lawyer_hired_prosecution','lawyer_hired_defense',
    'opening_statement','rebuttal','evidence_submitted','cross_examination',
    'closing_argument','jury_summoned','jury_deliberation_started','jury_vote_cast',
    'judge_deliberation','verdict_delivered','fine_issued','fine_paid',
    'settlement_proposed','settlement_accepted','settlement_rejected',
    'appeal_filed','appeal_ruled','case_closed','punishment_enforced',
  ], required: true },
  actorId: { type: ObjectId, ref: 'User' },
  actorName: String,      // 'Judge Orizu', 'Barrister Adaeze Okafor', etc.
  role: String,           // display role label
  content: String,        // speech/action text
  isAI: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now },
}, { _id: true });

const caseSchema = new Schema({
  estateId: { type: ObjectId, ref: 'Estate', required: true },
  caseNumber: { type: String, unique: true }, // auto: COURT-YYYY-NNNN
  title: { type: String, required: true },
  type: { type: String, enum: [
    'noise_complaint','property_damage','harassment','payment_dispute',
    'marketplace_violation','community_rules','eviction_dispute','boundary_dispute','other'
  ], required: true },
  severity: { type: String, enum: ['minor','moderate','major','critical'], default: 'minor' },
  charges: [String],
  plaintiffStatement: String,

  plaintiff: { userId: { type: ObjectId, ref: 'User' }, name: String },
  defendant: { userId: { type: ObjectId, ref: 'User' }, name: String, isEstate: { type: Boolean, default: false } },

  status: { type: String, enum: [
    'filed','open','in_hearing','jury_deliberation','judge_deliberation',
    'verdict_delivered','settled','appealing','closed'
  ], default: 'filed' },

  evidence: [{
    submittedById: { type: ObjectId, ref: 'User' },
    side: { type: String, enum: ['prosecution','defense','neutral'] },
    label: String,
    content: String,
    mediaUrl: String,
    submittedAt: { type: Date, default: Date.now },
  }],

  lawyers: {
    prosecution: {
      type: { type: String, enum: ['ai','self'], default: 'self' },
      aiPersona: { type: String, enum: ['adaeze','chidi','ngozi'] },
      hiredAt: Date,
    },
    defense: {
      type: { type: String, enum: ['ai','self'], default: 'self' },
      aiPersona: { type: String, enum: ['emeka','chidi','ngozi'] },
      hiredAt: Date,
    },
  },

  proceedings: [proceedingSchema],

  jury: {
    members: [{ type: ObjectId, ref: 'User' }],
    votes: [{
      userId: { type: ObjectId, ref: 'User' },
      vote: { type: String, enum: ['guilty','not_guilty','abstain'] },
      reasoning: String,
      castAt: Date,
    }],
    deadline: Date,
    verdict: { type: String, enum: ['guilty','not_guilty','hung','none'], default: 'none' },
    tally: { guilty: { type: Number, default: 0 }, notGuilty: { type: Number, default: 0 }, abstain: { type: Number, default: 0 } },
  },

  verdict: {
    decision: { type: String, enum: ['guilty','not_guilty','dismissed','settled','mistrial'] },
    summary: String,   // judge's full speech
    fine: { type: Number, default: 0 },
    punishment: { type: String, enum: ['none','warning','fine','marketplace_ban','lounge_suspension','community_suspension','estate_ban'], default: 'none' },
    punishmentDurationDays: { type: Number, default: 0 },
    conditions: String,
    deliveredAt: Date,
  },

  fine: {
    amount: { type: Number, default: 0 },
    status: { type: String, enum: ['none','pending','paid','waived'], default: 'none' },
    paidAt: Date,
    dueDate: Date,
    paymentRef: String,
  },

  settlement: {
    proposedById: { type: ObjectId, ref: 'User' },
    terms: String,
    amount: { type: Number, default: 0 },
    status: { type: String, enum: ['none','proposed','accepted','rejected'], default: 'none' },
    proposedAt: Date,
  },

  appeal: {
    filed: { type: Boolean, default: false },
    reason: String,
    status: { type: String, enum: ['none','pending','granted','denied'], default: 'none' },
    filedAt: Date,
    ruledAt: Date,
  },

  relatedAction: {
    feature: String,   // 'marketplace','lounge','community'
    targetUserId: { type: ObjectId, ref: 'User' },
    actionType: String, // 'ban','suspend','warn'
    isEnforced: { type: Boolean, default: false },
  },

  isPublic: { type: Boolean, default: true },
  filedAt: { type: Date, default: Date.now },
  openedAt: Date,
  closedAt: Date,
}, { timestamps: true });

// Auto-generate caseNumber before save
caseSchema.pre('save', async function(next) {
  if (this.caseNumber) return next();
  const year = new Date().getFullYear();
  const count = await mongoose.model('Case').countDocuments({ estateId: this.estateId }) + 1;
  this.caseNumber = `COURT-${year}-${String(count).padStart(4, '0')}`;
  next();
});

module.exports = mongoose.model('Case', caseSchema);
