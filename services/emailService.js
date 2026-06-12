const { Resend } = require('resend');

const getResend = () => new Resend(process.env.RESEND_API_KEY);
const FROM      = () => process.env.RESEND_FROM || 'Orizu <noreply@areaconnect.pro>';

// ── Visitor pass ─────────────────────────────────────────────────────────────
const sendVisitorPass = async ({ to, visitorName, hostName, code, expectedDate, estateName }) => {
  if (!process.env.RESEND_API_KEY) return { skipped: true };

  const dateStr = new Date(expectedDate).toLocaleDateString('en-NG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  await getResend().emails.send({
    from: FROM(),
    to,
    subject: `Your Visitor Pass — ${estateName}`,
    html: `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box;margin:0;padding:0}</style></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px 16px;">

<div style="max-width:520px;margin:0 auto;">

  <!-- Logo bar -->
  <div style="text-align:center;margin-bottom:24px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#111;">Area<span style="color:#10B981;">Connect</span></span>
  </div>

  <!-- Card -->
  <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

    <!-- Header stripe -->
    <div style="background:linear-gradient(135deg,#10B981,#059669);padding:28px 32px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.75);margin-bottom:6px;">${estateName}</p>
      <h1 style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.02em;">Visitor Pass</h1>
    </div>

    <!-- Body -->
    <div style="padding:32px;">
      <p style="font-size:15px;color:#374151;line-height:1.6;margin-bottom:24px;">
        Hi <strong>${visitorName}</strong>,<br>
        <strong>${hostName}</strong> has invited you to visit on <strong>${dateStr}</strong>.
        Present the code below at the security gate.
      </p>

      <!-- Code block -->
      <div style="background:#F0FDF9;border:2px solid #A7F3D0;border-radius:12px;padding:28px;text-align:center;margin-bottom:24px;">
        <p style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#059669;margin-bottom:10px;">Access Code</p>
        <p style="font-family:'Courier New',Courier,monospace;font-size:40px;font-weight:800;color:#047857;letter-spacing:0.3em;">${code}</p>
      </div>

      <p style="font-size:13px;color:#6B7280;line-height:1.6;">
        Valid for 24 hours after your expected arrival date. If you have any issues, contact your host directly.
      </p>
    </div>
  </div>

  <p style="text-align:center;font-size:12px;color:#9CA3AF;margin-top:20px;">Powered by AreaConnect</p>
</div>
</body></html>`,
  });

  return { sent: true };
};

// ── Resident invite ───────────────────────────────────────────────────────────
const sendInviteEmail = async ({ to, name, estateName, loginUrl, tempPassword }) => {
  if (!process.env.RESEND_API_KEY) return { skipped: true };

  await getResend().emails.send({
    from: FROM(),
    to,
    subject: `You're invited to ${estateName} — your login details`,
    html: `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box;margin:0;padding:0}</style></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px 16px;">

<div style="max-width:520px;margin:0 auto;">

  <!-- Logo bar -->
  <div style="text-align:center;margin-bottom:24px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#111;">Area<span style="color:#10B981;">Connect</span></span>
  </div>

  <!-- Card -->
  <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

    <!-- Header stripe -->
    <div style="background:linear-gradient(135deg,#10B981,#059669);padding:28px 32px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.75);margin-bottom:6px;">${estateName}</p>
      <h1 style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.02em;">Welcome to AreaMates</h1>
    </div>

    <!-- Body -->
    <div style="padding:32px;">
      <p style="font-size:15px;color:#374151;line-height:1.6;margin-bottom:28px;">
        Hi <strong>${name}</strong>, your estate manager has added you to <strong>${estateName}</strong>.
        Use the credentials below to sign in.
      </p>

      <!-- Credentials -->
      <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:24px;margin-bottom:28px;">
        <p style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#9CA3AF;margin-bottom:16px;">Your Login Credentials</p>

        <div style="margin-bottom:16px;">
          <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#9CA3AF;margin-bottom:4px;">Email</p>
          <p style="font-size:15px;font-weight:600;color:#111827;">${to}</p>
        </div>

        <div style="border-top:1px solid #E5E7EB;padding-top:16px;">
          <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#9CA3AF;margin-bottom:8px;">Temporary Password</p>
          <p style="font-family:'Courier New',Courier,monospace;font-size:22px;font-weight:800;letter-spacing:0.1em;color:#047857;background:#F0FDF9;border:1px solid #A7F3D0;border-radius:8px;padding:10px 14px;display:inline-block;">${tempPassword}</p>
        </div>
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:24px;">
        <a href="${loginUrl}"
          style="display:inline-block;background:linear-gradient(135deg,#10B981,#059669);color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:14px 40px;border-radius:10px;letter-spacing:-0.01em;">
          Sign In to AreaMates →
        </a>
      </div>

      <!-- Security tip -->
      <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:14px 16px;">
        <p style="font-size:13px;color:#92400E;line-height:1.5;">
          <strong>Security tip:</strong> Change your password after your first login. Keep your credentials private.
        </p>
      </div>
    </div>
  </div>

  <p style="text-align:center;font-size:12px;color:#9CA3AF;margin-top:20px;">
    If you didn't expect this email, you can safely ignore it. &nbsp;·&nbsp; Powered by AreaConnect
  </p>
</div>
</body></html>`,
  });

  return { sent: true };
};

// ── Manager notification email ────────────────────────────────────────────────
const TYPE_META = {
  payment_received: { label: 'Payment Received',  color: '#10B981', icon: '💰' },
  new_resident:     { label: 'New Resident',       color: '#6366F1', icon: '👤' },
  visitor_checkin:  { label: 'Visitor Check-In',   color: '#0EA5E9', icon: '🚪' },
  visitor_checkout: { label: 'Visitor Check-Out',  color: '#F59E0B', icon: '🚪' },
  new_alert:        { label: 'Security Alert',     color: '#EF4444', icon: '🚨' },
};

const sendManagerNotificationEmail = async ({ to, managerName, estateName, type, title, body }) => {
  if (!process.env.RESEND_API_KEY) return { skipped: true };

  const meta = TYPE_META[type] || { label: title, color: '#10B981', icon: '🔔' };

  await getResend().emails.send({
    from: FROM(),
    to,
    subject: `[${estateName}] ${meta.label}: ${title}`,
    html: `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box;margin:0;padding:0}</style></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px 16px;">

<div style="max-width:520px;margin:0 auto;">

  <div style="text-align:center;margin-bottom:24px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#111;">Area<span style="color:#10B981;">Connect</span></span>
  </div>

  <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

    <div style="background:linear-gradient(135deg,${meta.color},${meta.color}cc);padding:28px 32px;">
      <p style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.75);margin-bottom:6px;">${estateName}</p>
      <h1 style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.02em;">${meta.icon} ${meta.label}</h1>
    </div>

    <div style="padding:32px;">
      <p style="font-size:15px;color:#374151;line-height:1.6;margin-bottom:24px;">
        Hi <strong>${managerName || 'Manager'}</strong>,
      </p>

      <div style="background:#F9FAFB;border-left:4px solid ${meta.color};border-radius:0 10px 10px 0;padding:16px 20px;margin-bottom:24px;">
        <p style="font-size:13px;font-weight:700;color:#111827;margin-bottom:4px;">${title}</p>
        <p style="font-size:14px;color:#374151;line-height:1.6;">${body}</p>
      </div>

      <p style="font-size:13px;color:#6B7280;line-height:1.6;">
        Log in to your estate dashboard to view full details.
      </p>
    </div>
  </div>

  <p style="text-align:center;font-size:12px;color:#9CA3AF;margin-top:20px;">Powered by AreaConnect</p>
</div>
</body></html>`,
  });

  return { sent: true };
};

module.exports = { sendVisitorPass, sendInviteEmail, sendManagerNotificationEmail };
