const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
const AppConfig = require('../models/AppConfig');

// Web Push: reaches a phone even when the app isn't open (service worker).
// VAPID keys come from env if set, otherwise they're generated once and kept
// in the database so every deploy/instance signs with the same identity.
let vapid = null;
async function getVapid() {
  if (vapid) return vapid;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    let row = await AppConfig.findOne({ key: 'vapid' }).lean();
    if (!row) {
      try { row = await AppConfig.create({ key: 'vapid', value: webpush.generateVAPIDKeys() }); }
      catch (e) { if (e.code !== 11000) throw e; row = await AppConfig.findOne({ key: 'vapid' }).lean(); } // another instance won
    }
    vapid = row.value;
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@areaconnect.pro', vapid.publicKey, vapid.privateKey);
  return vapid;
}

async function publicKey() {
  return (await getVapid()).publicKey;
}

async function subscribe(userId, sub, { app = '', userAgent = '' } = {}) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new Error('Invalid subscription');
  // An endpoint belongs to one browser; if someone else logs in there, it moves to them.
  return PushSubscription.findOneAndUpdate(
    { endpoint: sub.endpoint },
    { userId, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, app, userAgent: String(userAgent).slice(0, 300) },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

async function unsubscribe(endpoint) {
  if (endpoint) await PushSubscription.deleteOne({ endpoint });
}

/**
 * Push a JSON payload to every device of a user. Never throws.
 * opts: { ttl (s), urgency: 'very-low'|'low'|'normal'|'high', topic }
 */
async function sendToUser(userId, payload, opts = {}) {
  try {
    const subs = await PushSubscription.find({ userId }).lean();
    if (!subs.length) return { sent: 0 };
    await getVapid();
    const body = JSON.stringify(payload);
    let sent = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, {
          TTL: opts.ttl ?? 60, urgency: opts.urgency || 'normal', ...(opts.topic ? { topic: opts.topic } : {}),
        });
        sent += 1;
        PushSubscription.updateOne({ _id: s._id }, { lastOkAt: new Date() }).catch(() => {});
      } catch (e) {
        // 404/410: the browser dropped this subscription — forget it.
        if (e.statusCode === 404 || e.statusCode === 410) await PushSubscription.deleteOne({ _id: s._id }).catch(() => {});
        else console.error('[push]', e.statusCode || '', e.body || e.message);
      }
    }));
    return { sent };
  } catch (e) {
    console.error('[push]', e.message);
    return { sent: 0 };
  }
}

module.exports = { publicKey, subscribe, unsubscribe, sendToUser, getVapid };
