const express = require('express');
const router  = express.Router();
const { Resend } = require('resend');

const getResend = () => new Resend(process.env.RESEND_API_KEY);
const FROM = () => process.env.RESEND_FROM || 'AreaConnect <noreply@areaconnect.pro>';

router.post('/', async (req, res) => {
  const { name, email, company, subject, message } = req.body;

  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping contact email');
    return res.json({ ok: true });
  }

  try {
    await getResend().emails.send({
      from: FROM(),
      to: 'hello@areaconnect.pro',
      replyTo: email,
      subject: `[Contact] ${subject} — ${name}`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#fff;">
          <h2 style="font-size:20px;font-weight:800;color:#111;margin:0 0 24px;">New contact form submission</h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;width:120px;">Name</td><td style="padding:8px 0;font-weight:600;color:#111;">${name}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Email</td><td style="padding:8px 0;font-weight:600;color:#111;"><a href="mailto:${email}" style="color:#10B981;">${email}</a></td></tr>
            ${company ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Estate/Company</td><td style="padding:8px 0;font-weight:600;color:#111;">${company}</td></tr>` : ''}
            <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Subject</td><td style="padding:8px 0;font-weight:600;color:#111;">${subject}</td></tr>
          </table>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
          <p style="color:#374151;font-size:14px;line-height:1.7;white-space:pre-wrap;">${message}</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
          <p style="color:#9ca3af;font-size:12px;">Sent via areaconnect.pro contact form — reply directly to respond to ${name}.</p>
        </div>
      `,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Contact email error:', err);
    res.status(500).json({ error: 'Failed to send message. Please try again.' });
  }
});

module.exports = router;
