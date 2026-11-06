const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  estateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isNkechi: { type: Boolean, default: false },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  content: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  attachment: {
    url:  { type: String, default: '' },
    name: { type: String, default: '' },
    type: { type: String, default: '' }, // MIME type
    size: { type: Number, default: 0 },
  },
  sticker: { type: String, default: '' }, // sticker id from the client sticker packs
  isGroupMessage: { type: Boolean, default: false },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

messageSchema.index({ estateId: 1, isGroupMessage: 1, createdAt: 1 });
messageSchema.index({ senderId: 1, receiverId: 1 });

messageSchema.index({ receiverId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
