const jwt = require('jsonwebtoken');

const generateAccessToken = (userId, role, estateId) => {
  return jwt.sign(
    { userId, role, estateId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.NODE_ENV === 'production' ? '15m' : '7d' }
  );
};

const generateRefreshToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
};

const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
};

module.exports = { generateAccessToken, generateRefreshToken, verifyRefreshToken };
