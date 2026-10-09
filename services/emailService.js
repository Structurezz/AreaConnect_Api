const { Resend } = require('resend');
const { generateInvoicePdf } = require('./pdfService');

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

  <p style="text-align:center;font-size:12px;color:#9CA3AF;margin-top:20px;">Powered by Area Connector Technologies &nbsp;&middot;&nbsp; RC 9607864</p>
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
    If you didn't expect this email, you can safely ignore it. &nbsp;·&nbsp; Powered by Area Connector Technologies · RC 9607864
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

  <p style="text-align:center;font-size:12px;color:#9CA3AF;margin-top:20px;">Powered by Area Connector Technologies &nbsp;&middot;&nbsp; RC 9607864</p>
</div>
</body></html>`,
  });

  return { sent: true };
};

// ── Shared invoice HTML builder ───────────────────────────────────────────────
const fmtNGN = (n) => `&#8358;${Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' }) : '&mdash;';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://estatemanager.areaconnect.pro';
const DEFAULT_HERO  = `${FRONTEND_URL}/estate-hero.jpeg`;

const METHOD_LABELS = {
  cash: 'Cash', bank_transfer: 'Bank Transfer',
  paystack: 'Paystack (Online)', manual: 'Manual Entry',
};
const FREQ_LABELS = {
  one_time: 'One-time', monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual',
};

const generateInvoiceHtml = (inv) => {
  const isReceipt  = inv.status === 'paid';
  const statusColor = { paid: '#059669', pending: '#D97706', overdue: '#DC2626', waived: '#6B7280' }[inv.status] || '#D97706';
  const statusBg    = { paid: '#D1FAE5', pending: '#FEF3C7', overdue: '#FEE2E2', waived: '#F3F4F6' }[inv.status] || '#FEF3C7';
  const statusLabel = (inv.status || 'PENDING').toUpperCase();
  const HERO_IMG    = (inv.estate?.logoUrl && inv.estate.logoUrl.startsWith('http')) ? inv.estate.logoUrl : DEFAULT_HERO;

  const itemsHtml = inv.items.map((item, i) => `
    <tr style="background:${i % 2 === 0 ? '#F8FAFC' : '#fff'};">
      <td style="padding:12px 14px;font-size:13px;color:#0F172A;">
        <strong>${item.description}</strong>
        ${item.detail ? `<br><span style="font-size:11px;color:#94A3B8;">${item.detail}</span>` : ''}
      </td>
      <td style="padding:12px 14px;font-size:12px;color:#64748B;text-align:right;">${FREQ_LABELS[item.frequency] || '&mdash;'}</td>
      <td style="padding:12px 14px;font-size:13px;text-align:right;color:#0F172A;">${item.quantity}</td>
      <td style="padding:12px 14px;font-size:13px;text-align:right;color:#0F172A;">${fmtNGN(item.unitPrice)}</td>
      <td style="padding:12px 14px;font-size:13px;text-align:right;color:#64748B;">${item.vat}%</td>
      <td style="padding:12px 14px;font-size:13px;text-align:right;color:#0F172A;font-weight:700;">${fmtNGN(item.total)}</td>
    </tr>`).join('');

  const metaRows = [
    ['Invoice No:', `<strong>${inv.invoiceNumber}</strong>`],
    ['Date Issued:', fmtDate(inv.date)],
    ['Due Date:', fmtDate(inv.dueDate)],
    inv.paidAt     ? ['Date Paid:',       fmtDate(inv.paidAt)]                          : null,
    inv.method     ? ['Payment Method:',  METHOD_LABELS[inv.method] || inv.method]      : null,
    inv.recordedBy ? ['Recorded By:',     inv.recordedBy]                               : null,
  ].filter(Boolean).map(([label, val]) =>
    `<tr><td style="padding:4px 0;color:#94A3B8;font-size:12px;font-weight:600;padding-right:12px;white-space:nowrap;">${label}</td>
         <td style="padding:4px 0;font-size:12px;color:#0F172A;">${val}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box;margin:0;padding:0;}</style></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;padding:32px 16px;">
<div style="max-width:700px;margin:0 auto;">

  <!-- Logo bar -->
  <div style="text-align:center;margin-bottom:20px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#111;">Area<span style="color:#10B981;">Connect</span></span>
  </div>

  <!-- Invoice card -->
  <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">

    <!-- Header: two columns -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>
        <!-- Left: estate brand -->
        <td style="background:#0F172A;padding:24px;width:50%;vertical-align:top;">
          <div style="font-size:18px;font-weight:800;color:#fff;letter-spacing:-0.02em;">${inv.estate.name}</div>
          <div style="font-size:10px;color:#94A3B8;letter-spacing:0.06em;text-transform:uppercase;margin-top:2px;">Estate Management</div>
          <div style="margin-top:14px;font-size:11px;color:#94A3B8;line-height:1.7;">${inv.estate.address || ''}</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px;">Code: <span style="color:#10B981;font-weight:700;">${inv.estate.estateCode}</span></div>
        </td>
        <!-- Right: hero image via background-image (email-safe, no position:absolute) -->
        <td width="50%" style="padding:0;background-color:#1E3A5F;background-image:url(${HERO_IMG});background-size:cover;background-position:center;background-repeat:no-repeat;" valign="top">
          <!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:260px;height:130px;"><v:fill type="frame" src="${HERO_IMG}" color="#1E3A5F"/><v:textbox inset="0,0,0,0"><![endif]-->
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;min-height:130px;">
            <tr>
              <td style="padding:20px;height:130px;background:linear-gradient(135deg,rgba(15,23,42,0.82) 0%,rgba(15,23,42,0.28) 100%);" valign="top">
                <div style="font-size:24px;font-weight:900;color:#fff;letter-spacing:-0.03em;">${isReceipt ? 'RECEIPT' : 'INVOICE'}</div>
                <div style="font-size:11px;color:rgba(255,255,255,0.65);margin-top:3px;">${isReceipt ? 'Payment Confirmation' : 'Payment Request'}</div>
                <div style="display:inline-block;margin-top:10px;background:${statusBg};color:${statusColor};font-size:11px;font-weight:800;padding:3px 10px;border-radius:20px;letter-spacing:0.04em;">${statusLabel}</div>
              </td>
            </tr>
          </table>
          <!--[if gte mso 9]></v:textbox></v:rect><![endif]-->
        </td>
      </tr>
    </table>

    <!-- Bill To + Invoice Meta -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-bottom:2px solid #E2E8F0;">
      <tr>
        <td style="padding:18px 20px;width:50%;vertical-align:top;border-right:1px solid #E2E8F0;">
          <div style="font-size:9px;font-weight:800;color:#94A3B8;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px;">Bill To</div>
          <div style="font-size:15px;font-weight:700;color:#0F172A;">${inv.resident.name}</div>
          ${inv.resident.unit !== 'N/A' ? `<div style="font-size:12px;color:#64748B;margin-top:3px;">Unit: ${inv.resident.unit}</div>` : ''}
          <div style="font-size:12px;color:#64748B;">${inv.estate.name}</div>
          ${inv.resident.email ? `<div style="font-size:11px;color:#94A3B8;margin-top:4px;">${inv.resident.email}</div>` : ''}
          ${inv.resident.phone ? `<div style="font-size:11px;color:#94A3B8;">${inv.resident.phone}</div>` : ''}
        </td>
        <td style="padding:18px 20px;width:50%;vertical-align:top;">
          <table cellpadding="0" cellspacing="0" style="width:100%;">${metaRows}</table>
        </td>
      </tr>
    </table>

    <!-- Line items -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <thead>
        <tr style="background:#0F172A;">
          ${['Description','Freq.','Qty','Unit Price','VAT %','Amount'].map((h,i) =>
            `<th style="padding:10px 14px;color:#fff;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;text-align:${i===0?'left':'right'};">${h}</th>`
          ).join('')}
        </tr>
      </thead>
      <tbody>${itemsHtml}</tbody>
    </table>

    <!-- Summary -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;padding:16px;">
      <tr>
        <td style="padding:16px 20px;">
          ${inv.notes ? `<div style="background:#F8FAFC;border-left:3px solid #10B981;border-radius:0 8px 8px 0;padding:10px 14px;font-size:12px;color:#64748B;">${inv.notes}</div>` : ''}
        </td>
        <td style="padding:16px 20px;width:240px;vertical-align:top;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="font-size:13px;color:#64748B;padding:4px 0;">Subtotal</td><td style="font-size:13px;color:#0F172A;text-align:right;padding:4px 0;">${fmtNGN(inv.subtotal)}</td></tr>
            <tr><td style="font-size:13px;color:#64748B;padding:4px 0;">VAT (0%)</td><td style="font-size:13px;color:#0F172A;text-align:right;padding:4px 0;">${fmtNGN(0)}</td></tr>
            <tr style="border-top:2px solid #0F172A;">
              <td style="font-size:15px;font-weight:800;color:#0F172A;padding:10px 0 4px;">TOTAL</td>
              <td style="font-size:15px;font-weight:800;color:#10B981;text-align:right;padding:10px 0 4px;">${fmtNGN(inv.total)}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Footer -->
    <div style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:14px 20px;display:flex;justify-content:space-between;">
      <span style="font-size:11px;color:#94A3B8;">Generated by <strong style="color:#10B981;">AreaConnect</strong> Estate Management</span>
      <span style="font-size:11px;color:#CBD5E1;">${inv.invoiceNumber}</span>
    </div>
  </div>

  <p style="text-align:center;font-size:12px;color:#9CA3AF;margin-top:20px;">Powered by Area Connector Technologies &nbsp;&middot;&nbsp; RC 9607864</p>
</div>
</body></html>`;
};

// ── Payment receipt email (to resident) ──────────────────────────────────────
const sendPaymentReceiptEmail = async ({ to, residentName, estateName, inv }) => {
  if (!process.env.RESEND_API_KEY) return { skipped: true };

  const subject = inv.status === 'paid'
    ? `Payment Receipt — ${inv.invoiceNumber} | ${estateName}`
    : `Payment Invoice — ${inv.invoiceNumber} | ${estateName}`;

  const pdfBuffer = await generateInvoicePdf(inv);

  await getResend().emails.send({
    from: FROM(),
    to,
    subject,
    html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;padding:24px 16px;margin:0;">
<div style="max-width:600px;margin:0 auto;">
  <div style="text-align:center;margin-bottom:16px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#111;">Area<span style="color:#10B981;">Connect</span></span>
  </div>
  <div style="background:#D1FAE5;border:1px solid #A7F3D0;border-radius:10px;padding:14px 20px;font-size:14px;color:#065F46;line-height:1.6;">
    Hi <strong>${residentName}</strong>, ${inv.status === 'paid'
      ? `your payment of <strong>NGN ${Number(inv.total || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</strong> to <strong>${estateName}</strong> has been confirmed.`
      : `please find your invoice of <strong>NGN ${Number(inv.total || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</strong> from <strong>${estateName}</strong> attached.`}
    Your ${inv.status === 'paid' ? 'receipt' : 'invoice'} is attached as a PDF.
  </div>
  <p style="text-align:center;font-size:12px;color:#9CA3AF;margin-top:20px;">Powered by Area Connector Technologies &nbsp;&middot;&nbsp; RC 9607864</p>
</div>
</body></html>`,
    attachments: [
      {
        filename: `${inv.invoiceNumber}.pdf`,
        content: pdfBuffer.toString('base64'),
      },
    ],
  });

  return { sent: true };
};

// ── Subscription expiry reminder email (to manager) ──────────────────────────
const sendSubscriptionReminderEmail = async ({ to, managerName, estateName, daysLeft, sub }) => {
  if (!process.env.RESEND_API_KEY) return { skipped: true };

  const isUrgent  = daysLeft <= 3;
  const isTrial   = sub.status === 'trial';
  const planName  = sub.planId?.name || 'Current Plan';
  const expiryDate = isTrial ? sub.trialEndsAt : sub.nextBillingDate;
  const color     = isUrgent ? '#DC2626' : '#D97706';
  const bg        = isUrgent ? '#FEE2E2' : '#FEF3C7';

  const fmtNGNSub = (n) => n != null ? `&#8358;${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}` : '&mdash;';

  const subInvoiceHtml = `
    <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);margin-top:20px;">
      <div style="background:#0F172A;padding:20px 24px;">
        <div style="font-size:10px;color:#94A3B8;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">${estateName}</div>
        <div style="font-size:20px;font-weight:800;color:#fff;">Subscription Summary</div>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${[
          ['Plan',           planName],
          ['Status',         (sub.status || '').toUpperCase()],
          ['Billing Cycle',  sub.cycle === 'annual' ? 'Annual' : 'Monthly'],
          ['Expiry Date',    fmtDate(expiryDate)],
          ['Days Remaining', `<strong style="color:${color};">${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong>`],
          sub.planId?.price != null ? ['Amount Due', fmtNGNSub(sub.planId.price)] : null,
        ].filter(Boolean).map(([label, val], i) => `
          <tr style="background:${i%2===0?'#F8FAFC':'#fff'};">
            <td style="padding:12px 20px;font-size:13px;color:#94A3B8;font-weight:600;width:40%;">${label}</td>
            <td style="padding:12px 20px;font-size:13px;color:#0F172A;">${val}</td>
          </tr>`).join('')}
      </table>
      <div style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:14px 20px;">
        <span style="font-size:11px;color:#94A3B8;">AreaConnect Estate Management &nbsp;&middot;&nbsp; areaconnect.pro</span>
      </div>
    </div>`;

  await getResend().emails.send({
    from: FROM(),
    to,
    subject: `${isUrgent ? '🚨 URGENT:' : '⚠️'} Your ${isTrial ? 'trial' : 'subscription'} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} — ${estateName}`,
    html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;padding:32px 16px;margin:0;">
<div style="max-width:600px;margin:0 auto;">

  <div style="text-align:center;margin-bottom:20px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#111;">Area<span style="color:#10B981;">Connect</span></span>
  </div>

  <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">
    <div style="background:linear-gradient(135deg,${color},${color}cc);padding:28px 32px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.75);margin-bottom:6px;">${estateName}</div>
      <h1 style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.02em;">
        ${isUrgent ? '🚨' : '⚠️'} ${isTrial ? 'Trial' : 'Subscription'} Expiring Soon
      </h1>
    </div>
    <div style="padding:32px;">
      <p style="font-size:15px;color:#374151;line-height:1.7;margin-bottom:20px;">
        Hi <strong>${managerName || 'Manager'}</strong>,<br><br>
        Your <strong>${planName}</strong> ${isTrial ? 'trial' : 'subscription'} for <strong>${estateName}</strong> expires in
        <strong style="color:${color};">${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong>
        on <strong>${fmtDate(expiryDate)}</strong>.
      </p>
      <div style="background:${bg};border:1px solid ${color}40;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
        <p style="font-size:13px;color:${color};font-weight:600;line-height:1.6;">
          ${isUrgent
            ? 'If your subscription expires, your estate features will be suspended and residents will lose access.'
            : 'Renew now to ensure uninterrupted access for you and your residents.'}
        </p>
      </div>
      <div style="text-align:center;margin-bottom:28px;">
        <a href="${FRONTEND_URL}/upgrade"
          style="display:inline-block;background:linear-gradient(135deg,#10B981,#059669);color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:14px 40px;border-radius:10px;">
          Renew Now &rarr;
        </a>
      </div>
      ${subInvoiceHtml}
    </div>
  </div>

  <p style="text-align:center;font-size:12px;color:#9CA3AF;margin-top:20px;">
    Powered by Area Connector Technologies · RC 9607864
  </p>
</div>
</body></html>`,
  });

  return { sent: true };
};

// ── Pitch / intro email (to prospects) ───────────────────────────────────────
// ── Live announcement blast (estate manager just went on air) ─────────────
// Fired from dj.start when kind === 'announcement'. The subject + hero are
// deliberately loud so this stands out from routine notification mail.
const sendLiveAnnouncementEmail = async ({
  to, name, estateName, hostName, title, message, joinUrl,
}) => {
  if (!process.env.RESEND_API_KEY || !to) return { skipped: true };
  const safeName = (name || 'Neighbour').split(' ')[0];
  const safeMsg  = message || title || 'Something important for the estate — tap to listen.';
  const url      = joinUrl || `${FRONTEND_URL}/announcements`;

  await getResend().emails.send({
    from: FROM(),
    to,
    subject: `🚨 LIVE NOW: ${hostName} is broadcasting to ${estateName} — tap to listen`,
    html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="background:#0F172A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;padding:28px 16px;margin:0;">
<div style="max-width:600px;margin:0 auto;">
  <div style="text-align:center;margin-bottom:16px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#fff;">Area<span style="color:#10B981;">Connect</span></span>
  </div>

  <div style="background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 24px 60px rgba(239,68,68,0.3);border:3px solid #DC2626;">
    <!-- Siren header -->
    <div style="background:linear-gradient(135deg,#7F1D1D 0%,#B91C1C 55%,#DC2626 100%);padding:36px 32px;text-align:center;position:relative;">
      <div style="display:inline-block;background:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.3);padding:5px 14px;border-radius:999px;margin-bottom:14px;">
        <span style="font-size:10px;font-weight:800;letter-spacing:0.2em;color:#FEE2E2;text-transform:uppercase;">
          🔴 LIVE &middot; ${estateName}
        </span>
      </div>
      <div style="font-size:48px;line-height:1;margin-bottom:8px;">📢</div>
      <h1 style="font-size:26px;font-weight:900;color:#fff;letter-spacing:-0.02em;line-height:1.15;margin:0 0 6px;">
        ${hostName} is on air right now
      </h1>
      <div style="font-size:13px;color:#FECACA;line-height:1.5;">
        An estate-wide announcement is broadcasting <strong>live</strong>. Join before it ends.
      </div>
    </div>

    <!-- Message preview -->
    <div style="padding:28px 32px 10px;">
      <p style="font-size:15px;color:#374151;line-height:1.65;margin:0 0 16px;">
        Hi <strong>${safeName}</strong>,<br><br>
        <strong>${hostName}</strong> is broadcasting a live announcement to <strong>${estateName}</strong> right now.
      </p>
      <div style="background:#FEF2F2;border-left:4px solid #DC2626;border-radius:0 10px 10px 0;padding:14px 18px;margin:0 0 24px;">
        <div style="font-size:11px;font-weight:800;color:#991B1B;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px;">
          What it's about
        </div>
        <div style="font-size:14px;color:#1F2937;line-height:1.55;">
          ${safeMsg}
        </div>
      </div>
      <div style="text-align:center;margin:4px 0 10px;">
        <a href="${url}"
          style="display:inline-block;background:linear-gradient(135deg,#DC2626,#991B1B);color:#fff;font-weight:800;font-size:15px;text-decoration:none;padding:16px 36px;border-radius:12px;box-shadow:0 10px 24px rgba(220,38,38,0.4);letter-spacing:-0.01em;">
          🎧 Listen now &rarr;
        </a>
      </div>
      <p style="text-align:center;font-size:11px;color:#94A3B8;margin:14px 0 0;">
        You can also open the AreaMates app and tap the red LIVE banner.
      </p>
    </div>

    <div style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:14px 24px;text-align:center;">
      <span style="font-size:11px;color:#64748B;">
        Live broadcast at ${estateName} &middot; AreaConnect Estate Management
      </span>
    </div>
  </div>

  <p style="text-align:center;font-size:12px;color:#94A3B8;margin-top:18px;">
    You received this because you're a resident at ${estateName}.<br>
    Powered by Area Connector Technologies &middot; RC 9607864
  </p>
</div>
</body></html>`,
  });
  return { sent: true };
};

// ── Auto-renewal receipt (recurring charge succeeded) ─────────────────────
const sendRenewalReceiptEmail = async ({
  to, managerName, estateName, plan, cycle, amount, reference, cardLast4, cardBrand, nextBillingDate,
}) => {
  if (!process.env.RESEND_API_KEY || !to) return { skipped: true };
  const planName = plan?.name || 'Current Plan';
  const amountFmt = fmtNGN(amount);
  const cycleLabel = cycle === 'annual' ? 'Annual' : 'Monthly';
  const cardLabel  = cardLast4 ? `${(cardBrand || 'Card').toUpperCase()} •••• ${cardLast4}` : 'card on file';

  await getResend().emails.send({
    from: FROM(),
    to,
    subject: `✅ Payment received — ${estateName} ${planName} renewed`,
    html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;padding:32px 16px;margin:0;">
<div style="max-width:600px;margin:0 auto;">
  <div style="text-align:center;margin-bottom:20px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#111;">Area<span style="color:#10B981;">Connect</span></span>
  </div>
  <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">
    <div style="background:linear-gradient(135deg,#10B981,#059669);padding:30px 32px;text-align:center;">
      <div style="font-size:40px;line-height:1;margin-bottom:6px;">✅</div>
      <h1 style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.02em;margin:0;">Payment received &middot; ${planName} renewed</h1>
    </div>
    <div style="padding:30px 32px;">
      <p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 20px;">
        Hi <strong>${managerName || 'there'}</strong>,<br><br>
        We just renewed your <strong>${planName}</strong> subscription for <strong>${estateName}</strong>.
        Your access continues without interruption.
      </p>
      <div style="background:#fff;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden;margin-bottom:20px;">
        <div style="background:#0F172A;padding:18px 22px;">
          <div style="font-size:10px;color:#94A3B8;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:3px;">Renewal receipt</div>
          <div style="font-size:18px;font-weight:800;color:#fff;letter-spacing:-0.02em;">${amountFmt}</div>
        </div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          ${[
            ['Reference',    reference],
            ['Plan',         `${planName} (${cycleLabel})`],
            ['Charged',      cardLabel],
            ['Amount',       amountFmt],
            ['Access until', fmtDate(nextBillingDate)],
          ].map(([l,v],i)=>`<tr style="background:${i%2===0?'#F8FAFC':'#fff'};"><td style="padding:11px 22px;font-size:12px;color:#94A3B8;font-weight:600;width:42%;">${l}</td><td style="padding:11px 22px;font-size:13px;color:#0F172A;">${v}</td></tr>`).join('')}
        </table>
      </div>
      <p style="font-size:13px;color:#64748B;line-height:1.6;">
        Reply to this email if anything looks off. Have a great month running ${estateName}!
      </p>
    </div>
  </div>
  <p style="text-align:center;font-size:12px;color:#9CA3AF;margin-top:20px;">Powered by Area Connector Technologies &middot; RC 9607864</p>
</div>
</body></html>`,
  });
  return { sent: true };
};

// ── Subscription expired (renewal failed or no stored card) ───────────────
const sendSubscriptionExpiredEmail = async ({
  to, managerName, estateName, planName, amountDue, failureReason, hasAuth,
}) => {
  if (!process.env.RESEND_API_KEY || !to) return { skipped: true };
  const payUrl = `${FRONTEND_URL}/upgrade`;
  const reasonLine = hasAuth
    ? 'We tried to charge the card on file but the attempt failed'
    : 'There is no payment method on file, so we could not auto-renew';
  const detail = failureReason ? ` (${failureReason})` : '';

  await getResend().emails.send({
    from: FROM(),
    to,
    subject: `🚨 Your ${estateName} subscription is paused — action needed`,
    html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;padding:32px 16px;margin:0;">
<div style="max-width:600px;margin:0 auto;">
  <div style="text-align:center;margin-bottom:20px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#111;">Area<span style="color:#10B981;">Connect</span></span>
  </div>
  <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">
    <div style="background:linear-gradient(135deg,#DC2626,#B91C1C);padding:30px 32px;text-align:center;">
      <div style="font-size:40px;line-height:1;margin-bottom:6px;">🚨</div>
      <h1 style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.02em;margin:0;">Access paused for ${estateName}</h1>
    </div>
    <div style="padding:30px 32px;">
      <p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 18px;">
        Hi <strong>${managerName || 'there'}</strong>,<br><br>
        Your <strong>${planName || 'subscription'}</strong> for <strong>${estateName}</strong> just reached its billing date.
        ${reasonLine}${detail}, so we've paused the account.
      </p>
      <div style="background:#FEE2E2;border:1px solid #FECACA;border-radius:12px;padding:14px 18px;margin-bottom:22px;">
        <div style="font-size:11px;font-weight:800;color:#991B1B;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px;">What this means right now</div>
        <ul style="margin:0;padding-left:18px;font-size:13px;color:#7F1D1D;line-height:1.75;">
          <li>Residents can't log into AreaMates until the account is reactivated</li>
          <li>Visitor QR passes won't verify at the gate</li>
          <li>All your estate data is safe &mdash; nothing is deleted</li>
        </ul>
      </div>
      <div style="text-align:center;margin-bottom:22px;">
        <a href="${payUrl}"
          style="display:inline-block;background:linear-gradient(135deg,#10B981,#059669);color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:14px 36px;border-radius:12px;box-shadow:0 4px 14px rgba(16,185,129,0.35);">
          Reactivate &mdash; ${amountDue != null ? fmtNGN(amountDue) : 'pay now'} &rarr;
        </a>
      </div>
      <p style="font-size:13px;color:#64748B;line-height:1.6;">
        Takes under a minute. Reply to this email if you need help &mdash; we're happy to switch plans or arrange bank transfer.
      </p>
    </div>
  </div>
  <p style="text-align:center;font-size:12px;color:#9CA3AF;margin-top:20px;">Powered by Area Connector Technologies &middot; RC 9607864</p>
</div>
</body></html>`,
  });
  return { sent: true };
};

// ── Comp / promo gift email ───────────────────────────────────────────────
// Sent when a super admin grants an estate free access to a plan. The email
// welcomes the manager, explains the perk, and ships with an invoice-style
// breakdown that shows the normal price struck-through with a ₦0 total.
// A PDF receipt generated by the same shared pdfService is attached so
// the estate has an archived record of the gift.
const sendCompGiftEmail = async ({
  to,
  managerName,
  estateName,
  estateCode,
  estateAddress,
  estateLogoUrl,
  managerPhone,
  plan,
  cycle,
  reason,
  expiresAt,
  grantedByName,
}) => {
  if (!process.env.RESEND_API_KEY) return { skipped: true };
  if (!to) return { skipped: true, reason: 'no recipient' };

  const cycleLabel     = cycle === 'annual' ? 'year' : 'month';
  const normalAmount   = cycle === 'annual' ? Number(plan?.price?.annual || 0) : Number(plan?.price?.monthly || 0);
  const normalAmountFmt = normalAmount > 0 ? fmtNGN(normalAmount) : '&mdash;';
  const planName       = plan?.name || 'Premium';
  const expiryText     = expiresAt ? fmtDate(expiresAt) : 'Never expires';
  const expiryLabelHtml = expiresAt
    ? `Valid until <strong>${fmtDate(expiresAt)}</strong>`
    : `<strong>Open-ended &mdash; no end date</strong>`;
  const invoiceNo      = `COMP-${Date.now().toString(36).toUpperCase()}`;
  const issuedAt       = new Date();

  // ── Build inv object shaped like the existing receipt system ────────────
  // Two line items: the plan at its normal price, then an AreaConnect gift
  // credit that offsets it to zero. Shared pdfService renders a RECEIPT
  // (status 'paid') with a green PAID badge.
  const inv = {
    invoiceNumber: invoiceNo,
    date: issuedAt,
    dueDate: issuedAt,
    paidAt: issuedAt,
    status: 'paid',
    method: 'comp',
    recordedBy: grantedByName || 'AreaConnect team',
    estate: {
      name:       estateName,
      estateCode: estateCode || '—',
      address:    estateAddress || '',
      logoUrl:    estateLogoUrl || '',
    },
    resident: {
      name:  managerName || 'Estate Manager',
      unit:  'N/A',
      email: to,
      phone: managerPhone || '',
    },
    items: [
      {
        description: `${planName} subscription`,
        detail:      `${cycle === 'annual' ? 'Annual' : 'Monthly'} access · all plan features included`,
        frequency:   cycle === 'annual' ? 'annual' : 'monthly',
        quantity:    1,
        unitPrice:   normalAmount,
        vat:         0,
        total:       normalAmount,
      },
      {
        description: 'AreaConnect gift credit',
        detail:      reason
          ? `Reason: ${reason}`
          : `Comp granted by ${grantedByName || 'AreaConnect team'}`,
        frequency:   'one_time',
        quantity:    1,
        unitPrice:   -normalAmount,
        vat:         0,
        total:       -normalAmount,
      },
    ],
    subtotal: 0,
    total:    0,
    notes: expiresAt
      ? `This is a complimentary gift from the AreaConnect team. Normal pricing of ${fmtNGN(normalAmount)}/${cycleLabel} resumes after ${fmtDate(expiresAt)}.`
      : `This is a complimentary gift from the AreaConnect team. Comp access stays active until an AreaConnect admin ends it.`,
  };

  // Generate the PDF. We don't let a PDF failure block the email — the
  // HTML body still carries the invoice-style breakdown inline.
  let pdfBuffer = null;
  try {
    pdfBuffer = await generateInvoicePdf(inv);
  } catch (e) {
    console.error('[sendCompGiftEmail] PDF generation failed', e.message);
  }

  const reasonHtml = reason ? `
    <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:12px;padding:14px 18px;margin:0 0 24px;">
      <div style="font-size:11px;font-weight:800;color:#B45309;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px;">Why you're getting this</div>
      <div style="font-size:13px;color:#78350F;line-height:1.6;">${reason}</div>
    </div>` : '';

  const invoiceHtml = `
    <div style="background:#fff;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;margin-top:24px;">
      <div style="background:#0F172A;padding:22px 26px;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:10px;color:#94A3B8;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">Receipt &middot; ${estateName}</div>
          <div style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-0.02em;">Gift Invoice</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:10px;color:#94A3B8;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">Status</div>
          <div style="display:inline-block;background:#10B981;color:#fff;font-size:11px;font-weight:800;padding:4px 10px;border-radius:20px;letter-spacing:0.06em;">PAID &middot; ₦0</div>
        </div>
      </div>

      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${[
          ['Invoice #',   invoiceNo],
          ['Issued',      fmtDate(issuedAt)],
          ['Plan',        planName],
          ['Billing',     cycle === 'annual' ? 'Annual' : 'Monthly'],
          ['Access until', expiryText],
          grantedByName ? ['Granted by', `${grantedByName} &middot; AreaConnect team`] : null,
        ].filter(Boolean).map(([label, val], i) => `
          <tr style="background:${i%2===0?'#F8FAFC':'#fff'};">
            <td style="padding:11px 24px;font-size:12px;color:#94A3B8;font-weight:600;width:42%;">${label}</td>
            <td style="padding:11px 24px;font-size:13px;color:#0F172A;">${val}</td>
          </tr>`).join('')}
      </table>

      <div style="border-top:1px solid #E2E8F0;padding:20px 26px;background:#fff;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <td style="font-size:13px;color:#64748B;padding:4px 0;">${planName} &middot; ${cycle === 'annual' ? 'Annual' : 'Monthly'} subscription</td>
            <td align="right" style="font-size:13px;color:#64748B;padding:4px 0;"><span style="text-decoration:line-through;">${normalAmountFmt}</span></td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#059669;padding:4px 0;font-weight:600;">AreaConnect gift credit</td>
            <td align="right" style="font-size:13px;color:#059669;padding:4px 0;font-weight:600;">&minus; ${normalAmountFmt}</td>
          </tr>
          <tr>
            <td colspan="2" style="padding:12px 0 6px;"><div style="border-top:1px dashed #CBD5E1;"></div></td>
          </tr>
          <tr>
            <td style="font-size:14px;color:#0F172A;font-weight:800;padding:4px 0;">Total due</td>
            <td align="right" style="font-size:22px;color:#10B981;font-weight:900;letter-spacing:-0.02em;padding:4px 0;">&#8358;0.00</td>
          </tr>
          <tr>
            <td colspan="2" style="font-size:11px;color:#94A3B8;padding:6px 0 0;">You will not be charged for this period. ${expiresAt ? `Normal pricing of ${normalAmountFmt}/${cycleLabel} resumes after ${fmtDate(expiresAt)}.` : 'This gift stays active until an AreaConnect admin ends it.'}</td>
          </tr>
        </table>
      </div>

      <div style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:14px 24px;">
        <span style="font-size:11px;color:#94A3B8;">AreaConnect Estate Management &nbsp;&middot;&nbsp; areaconnect.pro</span>
      </div>
    </div>`;

  await getResend().emails.send({
    from: FROM(),
    to,
    subject: `🎁 You've been gifted ${planName} access — ${estateName}`,
    attachments: pdfBuffer ? [{
      filename: `${invoiceNo}.pdf`,
      content: pdfBuffer.toString('base64'),
    }] : [],
    html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;padding:32px 16px;margin:0;">
<div style="max-width:600px;margin:0 auto;">

  <div style="text-align:center;margin-bottom:20px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#111;">Area<span style="color:#10B981;">Connect</span></span>
  </div>

  <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">
    <div style="background:linear-gradient(135deg,#F59E0B 0%,#D97706 60%,#B45309 100%);padding:36px 32px;text-align:center;">
      <div style="font-size:52px;margin-bottom:6px;line-height:1;">🎁</div>
      <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.85);margin-bottom:8px;">A gift from AreaConnect</div>
      <h1 style="font-size:26px;font-weight:900;color:#fff;letter-spacing:-0.02em;line-height:1.2;margin:0;">
        ${estateName}, you've just unlocked<br>${planName} — on the house.
      </h1>
    </div>

    <div style="padding:32px;">
      <p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 20px;">
        Hi <strong>${managerName || 'there'}</strong>,<br><br>
        We're giving <strong>${estateName}</strong> full access to our
        <strong style="color:#D97706;">${planName}</strong> plan — every feature, no payment, no card required.
        ${expiresAt ? `This gift is valid until <strong>${fmtDate(expiresAt)}</strong>.` : `This gift stays active indefinitely.`}
      </p>

      ${reasonHtml}

      <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:12px;padding:16px 20px;margin-bottom:24px;">
        <div style="font-size:11px;font-weight:800;color:#065F46;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">What you can do right now</div>
        <ul style="margin:0;padding-left:18px;font-size:13px;color:#065F46;line-height:1.75;">
          <li>Invite your residents and get them onto AreaMates</li>
          <li>Issue your first visitor QR passes in under 30 seconds</li>
          <li>Schedule your first dues cycle via Paystack &mdash; collection usually jumps 60% &rarr; 90% in month one</li>
          <li>Broadcast your first announcement with read receipts</li>
        </ul>
      </div>

      <div style="text-align:center;margin-bottom:12px;">
        <a href="${FRONTEND_URL}"
          style="display:inline-block;background:linear-gradient(135deg,#10B981,#059669);color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:14px 40px;border-radius:12px;box-shadow:0 4px 14px rgba(16,185,129,0.35);">
          Open your dashboard &rarr;
        </a>
      </div>
      <p style="text-align:center;font-size:12px;color:#94A3B8;margin:0 0 4px;">
        ${expiryLabelHtml}
      </p>

      ${pdfBuffer ? `
      <div style="margin-top:28px;background:#F8FAFC;border:1px dashed #CBD5E1;border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:10px;">
        <div style="font-size:18px;">📎</div>
        <div style="flex:1;">
          <div style="font-size:12px;font-weight:700;color:#0F172A;">Attached: ${invoiceNo}.pdf</div>
          <div style="font-size:11px;color:#64748B;margin-top:1px;">Keep this PDF receipt for your records.</div>
        </div>
      </div>` : ''}

      ${invoiceHtml}

      <p style="font-size:13px;color:#64748B;line-height:1.7;margin-top:28px;">
        Questions, feedback, or want to switch plans later?
        Just reply to this email &mdash; a real human will respond within a few hours.<br><br>
        Welcome aboard,<br>
        <strong style="color:#0F172A;">The AreaConnect team</strong>
      </p>
    </div>
  </div>

  <p style="text-align:center;font-size:12px;color:#9CA3AF;margin-top:20px;">
    Powered by Area Connector Technologies &middot; RC 9607864<br>
    This is a courtesy gift from our team. You will not be charged for ${planName} ${expiresAt ? `until ${fmtDate(expiresAt)}` : 'while this comp is active'}.
  </p>
</div>
</body></html>`,
  });

  return { sent: true };
};

const sendPitchEmail = async ({ to, name, title, company, city }) => {
  if (!process.env.RESEND_API_KEY) return { skipped: true };

  const firstName = (name || '').split(' ')[0] || 'there';
  const greeting = title ? `${title} ${(name || '').split(' ').slice(-1)[0]}` : firstName;

  await getResend().emails.send({
    from: FROM(),
    reply_to: 'michael@areaconnect.pro',
    to,
    subject: `Try AreaConnect Free for 30 Days — Transform How You Manage ${company || 'Your Estate'}`,
    html: `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box;margin:0;padding:0;}</style></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;padding:24px 20px;margin:0;">
<div style="width:100%;max-width:100%;margin:0 auto;">

  <!-- Logo -->
  <div style="text-align:center;margin-bottom:24px;">
    <span style="font-size:26px;font-weight:900;letter-spacing:-0.04em;color:#0F172A;">Area<span style="color:#10B981;">Connect</span></span>
    <div style="font-size:11px;color:#94A3B8;letter-spacing:0.08em;text-transform:uppercase;margin-top:4px;">Smart Estate Management Platform</div>
  </div>

  <!-- Hero card (full-width) -->
  <div style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.12);">

    <!-- Header gradient -->
    <div style="background:linear-gradient(135deg,#0F172A 0%,#1E3A5F 60%,#10B981 100%);padding:40px 32px;text-align:center;">
      <div style="display:inline-block;background:rgba(16,185,129,0.2);border:1px solid rgba(16,185,129,0.4);color:#34D399;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:5px 14px;border-radius:20px;margin-bottom:16px;">
        30 Days Free · No Card Required
      </div>
      <h1 style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-0.03em;line-height:1.2;margin-bottom:8px;">
        Try AreaConnect Free<br>for a Full Month
      </h1>
      <p style="font-size:15px;color:rgba(255,255,255,0.85);line-height:1.6;">
        Run your entire estate on us for 30 days — every feature, no charge, no commitment.
      </p>
    </div>

    <!-- Body -->
    <div style="padding:36px 32px;">

      <!-- Greeting -->
      <p style="font-size:16px;color:#374151;line-height:1.7;margin-bottom:24px;">
        Hi <strong style="color:#0F172A;">${greeting}</strong>,
      </p>
      <p style="font-size:15px;color:#4B5563;line-height:1.8;margin-bottom:20px;">
        Managing <strong>${company}</strong>${city ? ` in <strong>${city}</strong>` : ''} comes with real challenges —
        tracking residents, managing security, collecting levies, and keeping everyone informed.
        <strong style="color:#0F172A;">AreaConnect</strong> was built specifically for estates like yours.
      </p>
      <p style="font-size:15px;color:#4B5563;line-height:1.8;margin-bottom:28px;">
        That's why we're inviting you to <strong style="color:#059669;">try the entire platform free for 30 days</strong> —
        the full feature set, unlimited residents, real support from our team. If it doesn't save you hours every week,
        walk away. No card, no auto-charge, no strings.
      </p>

      <!-- Three-phone showcase: Manager · Resident · Guard (mirrors real app source) -->
      <div style="background:linear-gradient(160deg,#0F172A 0%,#1E293B 55%,#0F172A 100%);border-radius:18px;padding:28px 8px 22px;margin-bottom:32px;text-align:center;position:relative;overflow:hidden;">
        <p style="font-size:10px;font-weight:800;color:#34D399;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:4px;">One platform · Three apps</p>
        <p style="font-size:17px;font-weight:800;color:#fff;letter-spacing:-0.02em;margin-bottom:22px;">Purpose-built for every role in your estate</p>

        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>

            <!-- ─── PHONE 1 · ESTATE MANAGER (bg #F8FAFB, green #10B981) ─── -->
            <td width="33%" align="center" valign="top" style="padding:0 2px;">
              <div style="display:inline-block;width:136px;background:#0B1220;border:2px solid #1F2937;border-radius:22px;padding:5px 4px 4px;box-shadow:0 12px 30px rgba(0,0,0,0.45);">
                <div style="width:40px;height:5px;background:#000;border-radius:3px;margin:2px auto 4px;"></div>
                <div style="background:#F8FAFB;border-radius:15px;padding:0;text-align:left;overflow:hidden;">

                  <!-- Hero: white card w/ green border & green glow -->
                  <div style="background:#fff;border:1px solid rgba(16,185,129,0.20);border-radius:10px;margin:6px 5px 5px;padding:7px 7px 8px;position:relative;overflow:hidden;">
                    <div style="position:absolute;top:-18px;left:-18px;width:56px;height:56px;border-radius:50%;background:rgba(16,185,129,0.10);"></div>
                    <table width="100%" cellpadding="0" cellspacing="0" style="position:relative;"><tr>
                      <td style="vertical-align:top;">
                        <div style="display:inline-block;background:rgba(16,185,129,0.10);border:1px solid rgba(16,185,129,0.20);border-radius:99px;padding:1px 5px;font-size:5px;font-weight:700;color:#10B981;letter-spacing:0.03em;">FRI, AUG 1</div>
                        <div style="font-size:9px;font-weight:800;color:#0F172A;line-height:1.15;margin-top:3px;letter-spacing:-0.02em;">Good morning,<br/>Michael 👋</div>
                        <div style="font-size:5px;color:#475569;margin-top:2px;">Palm Estate — what's happening</div>
                      </td>
                      <td width="18" style="vertical-align:top;text-align:right;">
                        <div style="width:16px;height:16px;border-radius:50%;background:#10B981;color:#fff;font-size:9px;font-weight:800;text-align:center;line-height:16px;">M</div>
                      </td>
                    </tr></table>
                    <!-- Hero action buttons: Visitors + Alerts -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:5px;border-collapse:separate;border-spacing:3px 0;"><tr>
                      <td width="50%" style="background:rgba(16,185,129,0.10);border:1px solid rgba(16,185,129,0.20);border-radius:6px;padding:3px 4px;text-align:center;">
                        <span style="font-size:6px;color:#10B981;font-weight:700;">👤＋ Visitors</span>
                      </td>
                      <td width="50%" style="background:#10B981;border-radius:6px;padding:3px 4px;text-align:center;">
                        <span style="font-size:6px;color:#fff;font-weight:700;">🔔 Alerts</span>
                        <span style="display:inline-block;background:#EF4444;color:#fff;font-size:5px;font-weight:800;border-radius:99px;padding:0 3px;margin-left:2px;">2</span>
                      </td>
                    </tr></table>
                  </div>

                  <!-- 2×2 Stats grid: Residents / Visitors Today / Inside Now / Open Alerts -->
                  <div style="padding:0 5px 4px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:3px;">
                      <tr>
                        <td width="50%" style="background:#fff;border:1px solid rgba(0,0,0,0.06);border-radius:6px;padding:5px 4px;">
                          <div style="width:12px;height:12px;border-radius:4px;background:rgba(99,102,241,0.10);color:#6366F1;font-size:8px;line-height:12px;text-align:center;">👥</div>
                          <div style="font-size:11px;font-weight:800;color:#6366F1;letter-spacing:-0.03em;margin-top:2px;">248</div>
                          <div style="font-size:5px;color:#475569;font-weight:500;">Residents</div>
                        </td>
                        <td width="50%" style="background:#fff;border:1px solid rgba(0,0,0,0.06);border-radius:6px;padding:5px 4px;">
                          <div style="width:12px;height:12px;border-radius:4px;background:rgba(16,185,129,0.10);color:#10B981;font-size:8px;line-height:12px;text-align:center;">＋</div>
                          <div style="font-size:11px;font-weight:800;color:#10B981;letter-spacing:-0.03em;margin-top:2px;">17</div>
                          <div style="font-size:5px;color:#475569;font-weight:500;">Visitors Today</div>
                        </td>
                      </tr>
                      <tr>
                        <td style="background:#fff;border:1px solid rgba(0,0,0,0.06);border-radius:6px;padding:5px 4px;">
                          <div style="width:12px;height:12px;border-radius:4px;background:rgba(251,191,36,0.10);color:#FBBF24;font-size:8px;line-height:12px;text-align:center;">🚶</div>
                          <div style="font-size:11px;font-weight:800;color:#FBBF24;letter-spacing:-0.03em;margin-top:2px;">9</div>
                          <div style="font-size:5px;color:#475569;font-weight:500;">Inside Now</div>
                        </td>
                        <td style="background:#fff;border:1px solid rgba(0,0,0,0.06);border-radius:6px;padding:5px 4px;">
                          <div style="width:12px;height:12px;border-radius:4px;background:rgba(239,68,68,0.10);color:#EF4444;font-size:8px;line-height:12px;text-align:center;">⚠</div>
                          <div style="font-size:11px;font-weight:800;color:#EF4444;letter-spacing:-0.03em;margin-top:2px;">2</div>
                          <div style="font-size:5px;color:#475569;font-weight:500;">Open Alerts</div>
                        </td>
                      </tr>
                    </table>
                  </div>

                  <!-- Bottom tab bar: Home · People · Alerts · Chat · More -->
                  <div style="border-top:1px solid rgba(0,0,0,0.06);background:#fff;padding:4px 2px;">
                    <table width="100%" cellpadding="0" cellspacing="0"><tr>
                      <td width="20%" align="center" style="font-size:7px;color:#10B981;font-weight:800;line-height:1.1;">⌂<br/><span style="font-size:5px;">Home</span></td>
                      <td width="20%" align="center" style="font-size:7px;color:#94A3B8;line-height:1.1;">👥<br/><span style="font-size:5px;">People</span></td>
                      <td width="20%" align="center" style="font-size:7px;color:#94A3B8;line-height:1.1;">⚠<br/><span style="font-size:5px;">Alerts</span></td>
                      <td width="20%" align="center" style="font-size:7px;color:#94A3B8;line-height:1.1;">💬<br/><span style="font-size:5px;">Chat</span></td>
                      <td width="20%" align="center" style="font-size:7px;color:#94A3B8;line-height:1.1;">⋯<br/><span style="font-size:5px;">More</span></td>
                    </tr></table>
                  </div>
                </div>
              </div>
              <div style="margin-top:10px;font-size:11px;font-weight:800;color:#fff;letter-spacing:-0.01em;">Estate Manager</div>
              <div style="font-size:9px;color:#94A3B8;margin-top:2px;">Run everything from one dashboard</div>
            </td>

            <!-- ─── PHONE 2 · RESIDENT (bg #F7F5F1 cream, hero INDIGO #6366F1) ─── -->
            <td width="33%" align="center" valign="top" style="padding:0 2px;">
              <div style="display:inline-block;width:136px;background:#0B1220;border:2px solid #1F2937;border-radius:22px;padding:5px 4px 4px;box-shadow:0 12px 30px rgba(0,0,0,0.45);">
                <div style="width:40px;height:5px;background:#000;border-radius:3px;margin:2px auto 4px;"></div>
                <div style="background:#F7F5F1;border-radius:15px;padding:0;text-align:left;overflow:hidden;">

                  <!-- Indigo hero card -->
                  <div style="background:#6366F1;padding:8px 8px 9px;margin:5px 5px 6px;border-radius:10px;">
                    <table width="100%" cellpadding="0" cellspacing="0"><tr>
                      <td style="vertical-align:top;">
                        <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:99px;padding:1px 5px;font-size:5px;font-weight:700;color:rgba(255,255,255,0.9);letter-spacing:0.05em;text-transform:uppercase;">🏢 PALM ESTATE</div>
                        <div style="font-size:6px;color:rgba(255,255,255,0.75);margin-top:3px;">Good morning,</div>
                        <div style="font-size:12px;font-weight:700;color:#fff;line-height:1.1;">Michael 👋</div>
                        <div style="font-size:6px;color:rgba(255,255,255,0.65);margin-top:2px;">📍 Unit 12 · Block B</div>
                      </td>
                      <td style="vertical-align:top;text-align:right;">
                        <div style="display:inline-block;background:rgba(197,48,48,0.9);border-radius:99px;padding:2px 5px;font-size:5px;font-weight:700;color:#fff;letter-spacing:0.05em;">🛡 ALERT</div>
                      </td>
                    </tr></table>
                    <!-- Stats row: Active Passes / All Visitors / Notices -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;border-collapse:separate;border-spacing:2px 0;"><tr>
                      <td width="33%" style="background:rgba(255,255,255,0.12);border-radius:5px;padding:4px 2px;text-align:center;">
                        <div style="font-size:7px;color:rgba(255,255,255,0.7);">✓</div>
                        <div style="font-size:10px;color:#fff;font-weight:700;">3</div>
                        <div style="font-size:4px;color:rgba(255,255,255,0.65);font-weight:600;">Active Passes</div>
                      </td>
                      <td width="33%" style="background:rgba(255,255,255,0.12);border-radius:5px;padding:4px 2px;text-align:center;">
                        <div style="font-size:7px;color:rgba(255,255,255,0.7);">👥</div>
                        <div style="font-size:10px;color:#fff;font-weight:700;">28</div>
                        <div style="font-size:4px;color:rgba(255,255,255,0.65);font-weight:600;">All Visitors</div>
                      </td>
                      <td width="33%" style="background:rgba(255,255,255,0.12);border-radius:5px;padding:4px 2px;text-align:center;">
                        <div style="font-size:7px;color:rgba(255,255,255,0.7);">📢</div>
                        <div style="font-size:10px;color:#fff;font-weight:700;">5</div>
                        <div style="font-size:4px;color:rgba(255,255,255,0.65);font-weight:600;">Notices</div>
                      </td>
                    </tr></table>
                  </div>

                  <!-- "QUICK ACTIONS" section heading -->
                  <div style="padding:0 6px;font-size:5px;color:#4A5568;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:3px;">Quick Actions</div>

                  <!-- 2×2 Quick Actions: white cards, colored icon on tinted bg, colored label -->
                  <div style="padding:0 5px 4px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:3px;">
                      <tr>
                        <td width="50%" style="background:#fff;border:1px solid rgba(0,0,0,0.06);border-radius:6px;padding:4px;text-align:center;">
                          <div style="display:inline-block;width:16px;height:16px;border-radius:5px;background:rgba(39,103,73,0.10);color:#276749;font-size:10px;line-height:16px;text-align:center;">＋</div>
                          <div style="font-size:6px;font-weight:700;color:#276749;margin-top:2px;">Invite Visitor</div>
                        </td>
                        <td width="50%" style="background:#fff;border:1px solid rgba(0,0,0,0.06);border-radius:6px;padding:4px;text-align:center;">
                          <div style="display:inline-block;width:16px;height:16px;border-radius:5px;background:rgba(43,108,176,0.10);color:#2B6CB0;font-size:10px;line-height:16px;text-align:center;">🛍</div>
                          <div style="font-size:6px;font-weight:700;color:#2B6CB0;margin-top:2px;">Marketplace</div>
                        </td>
                      </tr>
                      <tr>
                        <td style="background:#fff;border:1px solid rgba(0,0,0,0.06);border-radius:6px;padding:4px;text-align:center;">
                          <div style="display:inline-block;width:16px;height:16px;border-radius:5px;background:rgba(107,70,193,0.10);color:#6B46C1;font-size:10px;line-height:16px;text-align:center;">💬</div>
                          <div style="font-size:6px;font-weight:700;color:#6B46C1;margin-top:2px;">Community</div>
                        </td>
                        <td style="background:#fff;border:1px solid rgba(0,0,0,0.06);border-radius:6px;padding:4px;text-align:center;">
                          <div style="display:inline-block;width:16px;height:16px;border-radius:5px;background:rgba(197,48,48,0.10);color:#C53030;font-size:10px;line-height:16px;text-align:center;">🛡</div>
                          <div style="font-size:6px;font-weight:700;color:#C53030;margin-top:2px;">Alert Security</div>
                        </td>
                      </tr>
                    </table>
                  </div>

                  <!-- Bottom tab bar: Home · Visitors · Chat · Market · More (indigo active) -->
                  <div style="border-top:1px solid rgba(0,0,0,0.07);background:#fff;padding:4px 2px;">
                    <table width="100%" cellpadding="0" cellspacing="0"><tr>
                      <td width="20%" align="center" style="font-size:7px;color:#6366F1;font-weight:800;line-height:1.1;">⌂<br/><span style="font-size:5px;">Home</span></td>
                      <td width="20%" align="center" style="font-size:7px;color:#A0AEC0;line-height:1.1;">👤<br/><span style="font-size:5px;">Visitors</span></td>
                      <td width="20%" align="center" style="font-size:7px;color:#A0AEC0;line-height:1.1;">💬<br/><span style="font-size:5px;">Chat</span></td>
                      <td width="20%" align="center" style="font-size:7px;color:#A0AEC0;line-height:1.1;">🛍<br/><span style="font-size:5px;">Market</span></td>
                      <td width="20%" align="center" style="font-size:7px;color:#A0AEC0;line-height:1.1;">⋯<br/><span style="font-size:5px;">More</span></td>
                    </tr></table>
                  </div>
                </div>
              </div>
              <div style="margin-top:10px;font-size:11px;font-weight:800;color:#fff;letter-spacing:-0.01em;">Resident App</div>
              <div style="font-size:9px;color:#94A3B8;margin-top:2px;">Passes, notices, security — one tap</div>
            </td>

            <!-- ─── PHONE 3 · GUARD (bg #060C18, gold #F59E0B, code-entry screen) ─── -->
            <td width="33%" align="center" valign="top" style="padding:0 2px;">
              <div style="display:inline-block;width:136px;background:#0B1220;border:2px solid #1F2937;border-radius:22px;padding:5px 4px 4px;box-shadow:0 12px 30px rgba(0,0,0,0.45);">
                <div style="width:40px;height:5px;background:#000;border-radius:3px;margin:2px auto 4px;"></div>
                <div style="background:#060C18;border-radius:15px;padding:0;text-align:left;overflow:hidden;">

                  <!-- Centered shield header -->
                  <div style="padding:10px 8px 6px;text-align:center;">
                    <div style="display:inline-block;width:26px;height:26px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.25);border-radius:9px;color:#F59E0B;font-size:15px;line-height:26px;text-align:center;">🛡</div>
                    <div style="font-size:11px;font-weight:800;color:#fff;margin-top:4px;letter-spacing:0.02em;">Gate Security</div>
                    <div style="font-size:5px;color:rgba(255,255,255,0.55);margin-top:2px;">Enter visitor access code to verify</div>
                  </div>

                  <!-- Code card: dark card w/ label, QR + input, dots, gold Verify button -->
                  <div style="margin:0 6px;background:#0F1A2E;border:1px solid rgba(255,255,255,0.07);border-radius:9px;padding:7px 6px 6px;">
                    <div style="font-size:5px;color:rgba(255,255,255,0.30);font-weight:700;letter-spacing:0.12em;text-align:center;text-transform:uppercase;">Visitor Access Code</div>
                    <!-- Input row -->
                    <div style="background:#0D172A;border:1px solid rgba(245,158,11,0.25);border-radius:6px;padding:4px 6px;margin-top:4px;">
                      <table width="100%" cellpadding="0" cellspacing="0"><tr>
                        <td width="12" style="vertical-align:middle;font-size:8px;color:rgba(255,255,255,0.30);">▦</td>
                        <td style="text-align:center;font-family:'Courier New',monospace;font-size:12px;font-weight:800;color:#F59E0B;letter-spacing:0.35em;">ABC123</td>
                      </tr></table>
                    </div>
                    <!-- Progress dots (6 bars) -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:5px;border-collapse:separate;border-spacing:2px 0;"><tr>
                      <td style="height:3px;background:#F59E0B;border-radius:99px;"></td>
                      <td style="height:3px;background:#F59E0B;border-radius:99px;"></td>
                      <td style="height:3px;background:#F59E0B;border-radius:99px;"></td>
                      <td style="height:3px;background:#F59E0B;border-radius:99px;"></td>
                      <td style="height:3px;background:#F59E0B;border-radius:99px;"></td>
                      <td style="height:3px;background:#F59E0B;border-radius:99px;"></td>
                    </tr></table>
                    <!-- Verify button (gold, black text) -->
                    <div style="background:#F59E0B;border-radius:6px;padding:5px;text-align:center;margin-top:5px;">
                      <span style="font-size:8px;font-weight:800;color:#000;">🔍 Verify Code</span>
                    </div>
                  </div>

                  <div style="height:14px;"></div>

                  <!-- Bottom tab bar (dark): Gate · Alerts · Log · Profile -->
                  <div style="border-top:1px solid rgba(255,255,255,0.07);background:#0A1020;padding:4px 2px;">
                    <table width="100%" cellpadding="0" cellspacing="0"><tr>
                      <td width="25%" align="center" style="font-size:8px;color:#F59E0B;font-weight:800;line-height:1.1;">🛡<br/><span style="font-size:5px;">Gate</span></td>
                      <td width="25%" align="center" style="font-size:8px;color:rgba(255,255,255,0.30);line-height:1.1;">⚠<br/><span style="font-size:5px;">Alerts</span></td>
                      <td width="25%" align="center" style="font-size:8px;color:rgba(255,255,255,0.30);line-height:1.1;">☰<br/><span style="font-size:5px;">Entry Log</span></td>
                      <td width="25%" align="center" style="font-size:8px;color:rgba(255,255,255,0.30);line-height:1.1;">👤<br/><span style="font-size:5px;">Profile</span></td>
                    </tr></table>
                  </div>
                </div>
              </div>
              <div style="margin-top:10px;font-size:11px;font-weight:800;color:#fff;letter-spacing:-0.01em;">Guard App</div>
              <div style="font-size:9px;color:#94A3B8;margin-top:2px;">Verify visitors by code in seconds</div>
            </td>

          </tr>
        </table>

        <p style="font-size:11px;color:#94A3B8;margin-top:20px;line-height:1.6;">
          Three connected apps. One shared source of truth. Zero data re-entry.
        </p>
      </div>

      <!-- Feature grid -->
      <div style="margin-bottom:32px;">
        <p style="font-size:11px;font-weight:800;color:#94A3B8;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:16px;">What You Get</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          ${[
            ['🏠', 'Resident Management',    'Digital resident directory, unit assignment, lease tracking'],
            ['🔐', 'Security & Access',       'Visitor pre-registration, QR codes, guard dashboard, security logs'],
            ['💰', 'Levy & Payment Tracking', 'Automated billing, payment history, invoices & receipts via email'],
            ['📢', 'Announcements & Alerts',  'Broadcast messages, emergency alerts, community noticeboard'],
            ['💬', 'Community Lounge',        'Social feed, polls, marketplace — residents stay connected'],
            ['📊', 'Analytics Dashboard',     'Occupancy rates, payment stats, visitor trends at a glance'],
          ].map(([icon, title, desc], i) => `
          <tr style="background:${i % 2 === 0 ? '#F8FAFC' : '#fff'};">
            <td style="padding:14px 16px;width:40px;font-size:22px;vertical-align:top;">${icon}</td>
            <td style="padding:14px 8px 14px 0;vertical-align:top;">
              <div style="font-size:14px;font-weight:700;color:#0F172A;margin-bottom:3px;">${title}</div>
              <div style="font-size:12px;color:#6B7280;line-height:1.5;">${desc}</div>
            </td>
          </tr>`).join('')}
        </table>
      </div>

      <!-- Pricing callout -->
      <div style="background:linear-gradient(135deg,#F0FDF4,#ECFDF5);border:1.5px solid #A7F3D0;border-radius:14px;padding:22px 24px;margin-bottom:28px;">
        <p style="font-size:11px;font-weight:800;color:#059669;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;">30 Days Free · Then Pick a Plan</p>
        <p style="font-size:12px;color:#065F46;line-height:1.6;margin-bottom:14px;">
          You won't be charged during your first month. After that, choose the plan that fits your estate — or cancel with one click.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          ${[
            ['Starter',    'Free 30 days, then &#8358;20,000/mo',  'Up to 50 residents &middot; security, announcements, visitor mgmt'],
            ['Growth',     'Free 30 days, then &#8358;47,000/mo',  'Up to 150 residents &middot; payments, AI, community chat, events'],
            ['Premium',    'Free 30 days, then &#8358;80,000/mo',  'Up to 300 residents &middot; marketplace, lounge, white-label'],
            ['Enterprise', 'Free 30 days, then &#8358;100,000/mo', 'Up to 500 residents &middot; full suite, API access, priority support'],
          ].map(([plan, price, desc]) => `
          <tr>
            <td style="padding:6px 0;font-size:13px;font-weight:700;color:#0F172A;width:110px;">${plan}</td>
            <td style="padding:6px 0;font-size:14px;font-weight:800;color:#059669;width:130px;">${price}</td>
            <td style="padding:6px 0;font-size:12px;color:#6B7280;">${desc}</td>
          </tr>`).join('')}
        </table>
      </div>

      <!-- Social proof -->
      <div style="background:#F8FAFC;border-radius:12px;padding:18px 20px;margin-bottom:28px;border-left:4px solid #10B981;">
        <p style="font-size:13px;font-style:italic;color:#374151;line-height:1.7;margin-bottom:8px;">
          "AreaConnect reduced our security incidents by 60% in the first month. The visitor management system alone is worth every kobo."
        </p>
        <p style="font-size:12px;font-weight:600;color:#6B7280;">— Estate Manager, Lekki Phase 1, Lagos</p>
      </div>

      <!-- Stats row -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:32px;">
        ${[
          ['30 Days','Free Trial'],
          ['500+',   'Active Estates'],
          ['50,000+','Residents Managed'],
          ['99.9%',  'Platform Uptime'],
        ].map(([num, label]) => `
        <td style="text-align:center;padding:16px 8px;background:#F8FAFC;border-radius:10px;margin:4px;">
          <div style="font-size:22px;font-weight:900;color:#10B981;letter-spacing:-0.03em;">${num}</div>
          <div style="font-size:10px;color:#94A3B8;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-top:3px;">${label}</div>
        </td>`).join('')}
      </table>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:20px;">
        <a href="https://area-connector.areaconnect.pro/register"
          style="display:inline-block;background:linear-gradient(135deg,#10B981,#059669);color:#fff;font-weight:800;font-size:16px;text-decoration:none;padding:16px 48px;border-radius:12px;letter-spacing:-0.01em;box-shadow:0 4px 16px rgba(16,185,129,0.4);">
          Start My Free 30 Days &rarr;
        </a>
        <p style="font-size:12px;color:#94A3B8;margin-top:10px;">No credit card required &nbsp;·&nbsp; Cancel anytime &nbsp;·&nbsp; Setup in under 10 minutes</p>
      </div>

      <!-- CEO personal sign-off -->
      <div style="border-top:1px solid #E2E8F0;padding-top:24px;margin-top:4px;">
        <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
          <tr>
            <td style="vertical-align:top;padding-right:16px;width:52px;">
              <div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#10B981,#059669);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;color:#fff;text-align:center;line-height:48px;">
                MO
              </div>
            </td>
            <td style="vertical-align:top;">
              <p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 10px;">
                I built AreaConnect because I've seen first-hand how much time Nigerian estate managers lose to manual processes — WhatsApp dues reminders, handwritten visitor logs, security gaps. That's why I'm giving you <strong style="color:#059669;">30 days on the house</strong> — spin up <strong>${company}</strong> on AreaConnect, put every feature through its paces, and only pay if it earns its keep. If it doesn't work for you, no card was ever charged.
              </p>
              <p style="font-size:13px;color:#374151;margin:0;">
                Feel free to reach me directly —<br>
                <a href="mailto:michael@areaconnect.pro" style="color:#10B981;font-weight:700;text-decoration:none;font-size:14px;">michael@areaconnect.pro</a>
              </p>
              <div style="margin-top:12px;">
                <div style="font-size:14px;font-weight:800;color:#0F172A;">Michael Orizu</div>
                <div style="font-size:12px;color:#64748B;margin-top:1px;">CEO &amp; Co-founder, AreaConnect</div>
                <div style="margin-top:6px;">
                  <a href="https://areaconnect.pro" style="color:#10B981;font-size:12px;font-weight:600;text-decoration:none;">areaconnect.pro</a>
                </div>
              </div>
            </td>
          </tr>
        </table>
      </div>
    </div>
  </div>

  <p style="text-align:center;font-size:12px;color:#9CA3AF;margin-top:20px;line-height:1.8;">
    You're receiving this because you were identified as a property professional in Nigeria.<br>
    <a href="${FRONTEND_URL}/unsubscribe" style="color:#CBD5E1;text-decoration:none;">Unsubscribe</a>
    &nbsp;·&nbsp; AreaConnect &nbsp;·&nbsp; Lagos, Nigeria
  </p>
</div>
</body></html>`,
  });

  return { sent: true };
};

// ── Withdrawal receipt email (to estate manager) ─────────────────────────────
const sendWithdrawalReceiptEmail = async ({ to, managerName, estateName, estateCode, amount, bankName, accountNumber, accountName, reference, transferCode, status, createdAt }) => {
  if (!process.env.RESEND_API_KEY) return { skipped: true };

  const isPending  = status === 'pending';
  const maskedAcct = accountNumber
    ? accountNumber.slice(0, -4).replace(/\d/g, '•') + accountNumber.slice(-4)
    : '••••';

  const notes = [
    `Bank: ${bankName || '—'}`,
    `Account: ${accountName || '—'} · ${maskedAcct}`,
    transferCode && transferCode !== 'TRF_test_mock' ? `Transfer Code: ${transferCode}` : null,
    isPending
      ? 'Transfer is processing — typically completes within 5 minutes.'
      : 'Funds have been sent to your bank account.',
  ].filter(Boolean).join('  ·  ');

  const inv = {
    status:        isPending ? 'pending' : 'paid',
    invoiceNumber: reference,
    date:          createdAt || new Date(),
    dueDate:       createdAt || new Date(),
    paidAt:        isPending ? null : (createdAt || new Date()),
    method:        'bank_transfer',
    recordedBy:    null,
    estate:        { name: estateName, address: '', estateCode: estateCode || '' },
    resident:      { name: managerName || 'Estate Manager', unit: 'N/A', email: to, phone: null },
    items: [{
      description: 'Wallet Withdrawal',
      detail:      `${bankName || ''} · ${maskedAcct}`,
      frequency:   'one_time',
      quantity:    1,
      unitPrice:   amount,
      vat:         0,
      total:       amount,
    }],
    subtotal: amount,
    total:    amount,
    notes,
  };

  const pdfBuffer = await generateInvoicePdf(inv);

  await getResend().emails.send({
    from: FROM(),
    to,
    subject: `Withdrawal ${isPending ? 'Initiated' : 'Successful'} — ₦${Number(amount).toLocaleString('en-NG')} | ${estateName}`,
    html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;padding:24px 16px;margin:0;">
<div style="max-width:600px;margin:0 auto;">
  <div style="text-align:center;margin-bottom:16px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#111;">Area<span style="color:#10B981;">Connect</span></span>
  </div>
  <div style="background:${isPending ? '#FEF3C7' : '#D1FAE5'};border:1px solid ${isPending ? '#FDE68A' : '#A7F3D0'};border-radius:10px;padding:14px 20px;font-size:14px;color:${isPending ? '#92400E' : '#065F46'};line-height:1.6;">
    Hi <strong>${managerName || 'Manager'}</strong>, your withdrawal of <strong>₦${Number(amount).toLocaleString('en-NG')}</strong> from <strong>${estateName}</strong>
    ${isPending ? 'is being processed. Funds typically arrive within 5 minutes.' : 'was successful. Funds have been sent to your bank account.'}
    Your receipt is attached as a PDF.
  </div>
  <p style="text-align:center;font-size:12px;color:#9CA3AF;margin-top:20px;">Powered by Area Connector Technologies &nbsp;&middot;&nbsp; RC 9607864</p>
</div>
</body></html>`,
    attachments: [{
      filename: `withdrawal-${reference}.pdf`,
      content: pdfBuffer.toString('base64'),
    }],
  });

  return { sent: true };
};

// ── Withdrawal rejected email (to estate manager) ──────────────────────────
const sendWithdrawalRejectedEmail = async ({ to, managerName, estateName, amount, reference, reason }) => {
  if (!process.env.RESEND_API_KEY) return { skipped: true };

  await getResend().emails.send({
    from: FROM(),
    to,
    subject: `Withdrawal declined — ₦${Number(amount).toLocaleString('en-NG')} | ${estateName}`,
    html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;padding:24px 16px;margin:0;">
<div style="max-width:600px;margin:0 auto;">
  <div style="text-align:center;margin-bottom:16px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#111;">Area<span style="color:#10B981;">Connect</span></span>
  </div>
  <div style="background:#FEE2E2;border:1px solid #FCA5A5;border-radius:10px;padding:14px 20px;font-size:14px;color:#991B1B;line-height:1.6;">
    Hi <strong>${managerName || 'Manager'}</strong>, your withdrawal request of
    <strong>₦${Number(amount).toLocaleString('en-NG')}</strong> from <strong>${estateName}</strong>
    (ref <code>${reference}</code>) was declined by the admin.
    <br/><br/>
    <strong>Reason:</strong> ${reason || 'Not specified'}
    <br/><br/>
    The amount is credited back to your wallet. You can submit a new request anytime.
  </div>
  <p style="text-align:center;font-size:12px;color:#9CA3AF;margin-top:20px;">Powered by Area Connector Technologies &nbsp;&middot;&nbsp; RC 9607864</p>
</div>
</body></html>`,
  });

  return { sent: true };
};

// ── Marketing / campaign email ──────────────────────────────────────────────
const sendCampaignEmail = async ({ to, name, subject, preheader, htmlBody, ctaUrl, ctaText, theme, brand }) => {
  if (!process.env.RESEND_API_KEY) return { skipped: true };

  const primary   = theme?.primaryColor    || '#EC4899';
  const accent    = theme?.accentColor     || '#F472B6';
  const brandName = brand?.name            || 'AreaConnect';
  const logoUrl   = brand?.logoUrl         || '';
  const social    = brand?.social || {
    twitter:   process.env.BRAND_TWITTER_URL   || 'https://x.com/areaconnect',
    instagram: process.env.BRAND_INSTAGRAM_URL || 'https://instagram.com/areaconnect',
    linkedin:  process.env.BRAND_LINKEDIN_URL  || 'https://linkedin.com/company/areaconnect',
    website:   process.env.BRAND_WEBSITE_URL   || 'https://areaconnect.pro',
  };

  const nameFallback = (name || '').trim() || 'there';
  const personalize = (s) => String(s || '').replace(/\{\{name\}\}/g, nameFallback);

  const finalSubject   = personalize(subject);
  const finalPreheader = personalize(preheader);
  const finalBody      = personalize(htmlBody);

  const cta = ctaUrl
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
         <tr><td align="center">
           <a href="${ctaUrl}" style="display:inline-block;background:linear-gradient(135deg,${primary},${accent});color:#ffffff;text-decoration:none;padding:15px 34px;border-radius:12px;font-weight:700;font-size:15px;letter-spacing:-0.01em;box-shadow:0 6px 18px ${primary}44;">
             ${ctaText || 'Get Started'}
           </a>
         </td></tr>
       </table>`
    : '';

  const preheaderBlock = finalPreheader
    ? `<div style="display:none !important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${finalPreheader}</div>`
    : '';

  const logoBlock = logoUrl
    ? `<img src="${logoUrl}" alt="${brandName}" style="height:36px;display:inline-block;" />`
    : `<span style="font-size:24px;font-weight:800;letter-spacing:-0.03em;color:#0F172A;">${
        brandName.startsWith('Area')
          ? `Area<span style="color:${primary};">${brandName.slice(4) || 'Connect'}</span>`
          : brandName
      }</span>`;

  // Social icon buttons — text-based glyphs work reliably across email clients
  const socialIcon = (href, glyph, aria) => `<a href="${href}" aria-label="${aria}" style="display:inline-block;width:36px;height:36px;line-height:36px;text-align:center;border-radius:50%;background:${primary};color:#ffffff;text-decoration:none;font-family:'Helvetica Neue',Arial,sans-serif;font-weight:700;font-size:14px;margin:0 4px;">${glyph}</a>`;

  const socialRow = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
      <tr><td align="center">
        ${social.twitter   ? socialIcon(social.twitter,   '𝕏',  'Twitter / X')  : ''}
        ${social.instagram ? socialIcon(social.instagram, 'IG', 'Instagram')     : ''}
        ${social.linkedin  ? socialIcon(social.linkedin,  'in', 'LinkedIn')      : ''}
        ${social.website   ? socialIcon(social.website,   '↗',  'Website')       : ''}
      </td></tr>
    </table>`;

  await getResend().emails.send({
    from: FROM(),
    to,
    subject: finalSubject,
    html: `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${finalSubject}</title></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:24px 12px;margin:0;color:#0F172A;">
${preheaderBlock}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">
  <tr><td align="center" style="padding:8px 0 20px;">${logoBlock}</td></tr>

  <tr><td style="background:#ffffff;border-radius:18px;box-shadow:0 8px 32px rgba(15,23,42,0.08);overflow:hidden;">
    <div style="height:6px;background:linear-gradient(90deg,${primary} 0%,${accent} 100%);"></div>
    <div style="padding:36px 34px 30px;">
      <div style="font-size:15px;color:#0F172A;line-height:1.7;">
        ${finalBody}
      </div>
      ${cta}
    </div>
  </td></tr>

  <tr><td align="center" style="padding:28px 20px 8px;">
    ${socialRow}
    <p style="font-size:12px;color:#64748B;margin:0 0 4px;font-weight:600;letter-spacing:-0.01em;">${brandName} — your estate, together.</p>
    <p style="font-size:11px;color:#94A3B8;margin:0 0 12px;">Powered by Area Connector Technologies · RC 9607864</p>
    <p style="font-size:11px;color:#CBD5E1;margin:0;">You're receiving this because you signed up for ${brandName}.<br/>
      <a href="${social.website || '#'}" style="color:#94A3B8;text-decoration:underline;">Manage preferences</a> · <a href="${social.website || '#'}" style="color:#94A3B8;text-decoration:underline;">Unsubscribe</a>
    </p>
  </td></tr>
</table>
</body></html>`,
  });

  return { sent: true };
};

module.exports = {
  sendVisitorPass,
  sendInviteEmail,
  sendManagerNotificationEmail,
  sendPaymentReceiptEmail,
  sendWithdrawalReceiptEmail,
  sendWithdrawalRejectedEmail,
  sendSubscriptionReminderEmail,
  sendCompGiftEmail,
  sendRenewalReceiptEmail,
  sendSubscriptionExpiredEmail,
  sendLiveAnnouncementEmail,
  generateInvoiceHtml,
  sendPitchEmail,
  sendCampaignEmail,
};
