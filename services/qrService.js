const QRCode = require('qrcode');

const generateQRCode = async (visitorCode) => {
  const qrData = JSON.stringify({ code: visitorCode });
  return QRCode.toDataURL(qrData, {
    color: { dark: '#0B1C3D', light: '#FFFFFF' },
    width: 300,
    margin: 2,
  });
};

/** Generates a unique 6-character alphanumeric visitor code */
const generateVisitorCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

module.exports = { generateQRCode, generateVisitorCode };
