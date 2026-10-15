const mongoose = require('mongoose');

// Small key/value store for server-generated settings that must survive
// restarts and be shared by every instance (e.g. Web Push VAPID keys).
const appConfigSchema = new mongoose.Schema({
  key:   { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

module.exports = mongoose.model('AppConfig', appConfigSchema);
