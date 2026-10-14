const crypto = require('crypto');

// Public, signed link to a user's profile photo — for emails. Photos are often
// stored as base64 data URLs, which Gmail/Outlook refuse to display, so emails
// link to GET /api/public/avatar/:userId/:sig instead. The HMAC means only
// links we generated work; you can't enumerate other users' photos.
const SECRET = () => process.env.AVATAR_URL_SECRET || process.env.JWT_SECRET || 'avatar';
const API_BASE = () => (process.env.API_PUBLIC_URL || 'https://areaconnectapi-production.up.railway.app').replace(/\/$/, '');

const signAvatar = (userId) =>
  crypto.createHmac('sha256', SECRET()).update(String(userId)).digest('hex').slice(0, 32);

const verifyAvatarSig = (userId, sig) => {
  const expected = signAvatar(userId);
  return typeof sig === 'string' && sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
};

const avatarUrl = (user) => (user?.profilePhoto ? `${API_BASE()}/api/public/avatar/${user._id}/${signAvatar(user._id)}` : null);

module.exports = { signAvatar, verifyAvatarSig, avatarUrl };
