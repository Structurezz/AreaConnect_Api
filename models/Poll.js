const mongoose = require('mongoose');

const pollSchema = new mongoose.Schema({
  estateId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', required: true },
  question:  { type: String, required: true, trim: true },
  options: [{
    text:  { type: String, required: true },
    votes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  }],
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  endsAt:        { type: Date },
  isActive:      { type: Boolean, default: true },
  allowMultiple: { type: Boolean, default: false },
}, { timestamps: true });

pollSchema.index({ estateId: 1, isActive: 1 });
module.exports = mongoose.model('Poll', pollSchema);
