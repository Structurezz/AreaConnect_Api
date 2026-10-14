const router = require('express').Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const { verifyAvatarSig } = require('../utils/avatarUrl');

// GET /api/public/avatar/:userId/:sig — serves a profile photo for emails.
router.get('/:userId/:sig', async (req, res) => {
  const { userId, sig } = req.params;
  if (!mongoose.isValidObjectId(userId) || !verifyAvatarSig(userId, sig)) return res.sendStatus(404);
  const user = await User.findById(userId).select('profilePhoto').lean();
  const photo = user?.profilePhoto;
  if (!photo) return res.sendStatus(404);
  if (/^https?:\/\//i.test(photo)) return res.redirect(302, photo);
  const m = photo.match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,(.+)$/i);
  if (!m) return res.sendStatus(404);
  res.set('Content-Type', m[1].toLowerCase());
  res.set('Cache-Control', 'public, max-age=86400');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return res.send(Buffer.from(m[2], 'base64'));
});

module.exports = router;
