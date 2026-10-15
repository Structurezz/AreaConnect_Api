const mongoose = require('mongoose');

// A browser/device that agreed to receive Web Push (calls ring even when the
// app is closed). One user can have several (phone, laptop, each app).
const pushSubscriptionSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  endpoint: { type: String, required: true, unique: true },
  keys: {
    p256dh: { type: String, required: true },
    auth:   { type: String, required: true },
  },
  app:       { type: String, default: '' },        // residents | estatemanager | security
  userAgent: { type: String, default: '' },
  lastOkAt:  { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
