const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const push = require('../services/pushService');

router.get('/public-key', async (req, res) => {
  try { res.json({ success: true, data: { publicKey: await push.publicKey() } }); }
  catch (e) { res.status(500).json({ success: false, message: 'Push not available' }); }
});

router.post('/subscribe', authenticate, async (req, res) => {
  try {
    await push.subscribe(req.user._id, req.body.subscription, { app: String(req.body.app || '').slice(0, 30), userAgent: req.headers['user-agent'] });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message || 'Could not enable notifications' });
  }
});

router.post('/unsubscribe', authenticate, async (req, res) => {
  await push.unsubscribe(req.body.endpoint).catch(() => {});
  res.json({ success: true });
});

module.exports = router;
