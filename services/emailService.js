const nodemailer = require('nodemailer');

const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

const sendVisitorPass = async ({ to, visitorName, hostName, code, qrCodeUrl, expectedDate, estateName }) => {
  if (!process.env.SMTP_USER) return { skipped: true };

  const transporter = createTransporter();
  const dateStr = new Date(expectedDate).toLocaleDateString('en-NG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  await transporter.sendMail({
    from: `"${estateName} Estate" <${process.env.SMTP_USER}>`,
    to,
    subject: `Your Visitor Pass — ${estateName}`,
    html: `
      <div style="font-family:DM Sans,sans-serif;max-width:600px;margin:auto;background:#0B1C3D;color:#fff;border-radius:12px;overflow:hidden;">
        <div style="background:#C9A84C;padding:20px;text-align:center;">
          <h1 style="margin:0;font-family:Georgia,serif;font-size:24px;">${estateName}</h1>
          <p style="margin:4px 0;opacity:.85">Visitor Pass</p>
        </div>
        <div style="padding:32px;">
          <p>Hello <strong>${visitorName}</strong>,</p>
          <p><strong>${hostName}</strong> has invited you to visit on <strong>${dateStr}</strong>.</p>
          <div style="background:rgba(255,255,255,.08);border:2px solid #C9A84C;border-radius:10px;padding:24px;text-align:center;margin:24px 0;">
            <p style="margin:0 0 8px;opacity:.7;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Your Access Code</p>
            <p style="font-family:monospace;font-size:40px;font-weight:700;color:#C9A84C;letter-spacing:8px;margin:0;">${code}</p>
          </div>
          <p style="font-size:13px;opacity:.7">Show this code or the QR code at the security gate. The code is valid for 24 hours after your expected date.</p>
        </div>
      </div>
    `,
  });

  return { sent: true };
};

const sendInviteEmail = async ({ to, name, estateCode, estateName, inviteUrl }) => {
  if (!process.env.SMTP_USER) return { skipped: true };

  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"${estateName} Estate" <${process.env.SMTP_USER}>`,
    to,
    subject: `You've been invited to join ${estateName} Estate`,
    html: `
      <div style="font-family:DM Sans,sans-serif;max-width:600px;margin:auto;">
        <h2>Welcome to ${estateName}!</h2>
        <p>Hi ${name},</p>
        <p>You've been invited to join the estate management portal. Use the code below to register:</p>
        <div style="background:#0B1C3D;color:#C9A84C;padding:20px;text-align:center;border-radius:8px;font-family:monospace;font-size:32px;letter-spacing:6px;margin:20px 0;">
          ${estateCode}
        </div>
        ${inviteUrl ? `<p><a href="${inviteUrl}" style="background:#0B1C3D;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">Register Now</a></p>` : ''}
      </div>
    `,
  });

  return { sent: true };
};

module.exports = { sendVisitorPass, sendInviteEmail };
