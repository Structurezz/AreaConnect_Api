const mongoose = require('mongoose');

const CommentSchema = new mongoose.Schema({
  author:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text:      { type: String, required: true, maxlength: 500 },
  createdAt: { type: Date, default: Date.now },
});

const PostSchema = new mongoose.Schema({
  estateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true, index: true },
  author:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content:  { type: String, maxlength: 1000, default: '' },
  images:   [{ type: String }],
  likes:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  comments: [CommentSchema],
  // 'story' = shown only in the Lounge stories row for 24h, never in the
  // timeline. 'post' (default, incl. all existing docs) = the timeline.
  kind:     { type: String, enum: ['post', 'story'], default: 'post' },
}, { timestamps: true });

PostSchema.index({ estateId: 1, createdAt: -1 });
PostSchema.index({ estateId: 1, kind: 1, createdAt: -1 });

module.exports = mongoose.model('Post', PostSchema);
