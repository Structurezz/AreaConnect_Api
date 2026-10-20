const mongoose = require('mongoose');

// Blog articles for the public landing site. Bodies are stored as structured
// blocks (not HTML) so the frontend can render them without injection risk.
const blockSchema = new mongoose.Schema({
  type:  { type: String, enum: ['h2', 'h3', 'p', 'ul', 'ol', 'quote', 'tip'], required: true },
  text:  { type: String, default: '' },
  items: { type: [String], default: undefined },
}, { _id: false });

const articleSchema = new mongoose.Schema({
  slug:           { type: String, required: true, unique: true, lowercase: true, trim: true },
  title:          { type: String, required: true, trim: true },
  excerpt:        { type: String, required: true },
  seoDescription: { type: String, default: '' },
  category:       { type: String, enum: ['Guide', 'Security', 'Payments', 'Community', 'Management', 'Product'], required: true },
  keywords:       { type: [String], default: [] },
  readMinutes:    { type: Number, default: 6 },
  body:           { type: [blockSchema], default: [] },
  topicKey:       { type: String, index: true },          // dedupe against the topic bank
  author:         { type: String, default: 'AreaConnect Editorial' },
  source:         { type: String, enum: ['gemini', 'manual'], default: 'gemini' },
  status:         { type: String, enum: ['published', 'draft'], default: 'published', index: true },
  publishedAt:    { type: Date, default: Date.now, index: true },
}, { timestamps: true });

module.exports = mongoose.model('Article', articleSchema);
