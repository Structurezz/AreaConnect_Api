const mongoose = require('mongoose');

// One row per campaign per day — powers the trend charts without scanning users.
const campaignStatSchema = new mongoose.Schema({
  campaignId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  day:         { type: String, required: true }, // YYYY-MM-DD (UTC)
  impressions: { type: Number, default: 0 },
  clicks:      { type: Number, default: 0 },
  dismissals:  { type: Number, default: 0 },
  emails:      { type: Number, default: 0 },
  pushes:      { type: Number, default: 0 },
}, { timestamps: false });

campaignStatSchema.index({ campaignId: 1, day: 1 }, { unique: true });
campaignStatSchema.index({ day: 1 });

campaignStatSchema.statics.bump = function (campaignId, field, n = 1) {
  const day = new Date().toISOString().slice(0, 10);
  return this.updateOne({ campaignId, day }, { $inc: { [field]: n } }, { upsert: true }).catch(() => {});
};

module.exports = mongoose.model('CampaignStat', campaignStatSchema);
