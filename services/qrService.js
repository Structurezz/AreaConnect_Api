const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

/**
 * Generates a QR code PNG file and returns the URL path to it.
 * Falls back to a data URL if file write fails.
 */
const generateQRCode = async (visitorCode, baseUrl = '') => {
  try {
    const uploadsDir = path.join(__dirname, '../uploads/qrcodes');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const fileName = `qr_${visitorCode}.png`;
    const filePath = path.join(uploadsDir, fileName);

    const qrData = JSON.stringify({ code: visitorCode, ts: Date.now() });
    await QRCode.toFile(filePath, qrData, {
      color: { dark: '#0B1C3D', light: '#FFFFFF' },
      width: 300,
      margin: 2,
    });

    return `${baseUrl}/uploads/qrcodes/${fileName}`;
  } catch (err) {
    // Fallback: return base64 data URL
    const qrData = JSON.stringify({ code: visitorCode });
    return QRCode.toDataURL(qrData, { width: 300 });
  }
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
