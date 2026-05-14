const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
  estateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true },
  body: { type: String, required: true },
  category: {
    type: String,
    enum: ['general', 'urgent', 'event', 'maintenance'],
    default: 'general',
  },
  imageUrl: { type: String, default: '' },
  isPinned: { type: Boolean, default: false },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

announcementSchema.index({ estateId: 1, isPinned: -1, createdAt: -1 });

module.exports = mongoose.model('Announcement', announcementSchema);
