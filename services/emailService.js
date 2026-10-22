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
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:0;">

<div style="width:100%;max-width:100%;margin:0;">

  <!-- Logo bar -->
  <div style="text-align:center;padding:20px 16px 0;margin-bottom:24px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#111;">Area<span style="color:#10B981;">Connect</span></span>
  </div>

  <!-- Card -->
  <div style="background:#fff;border-radius:0;overflow:hidden;box-shadow:none;">

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
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:0;">

<div style="width:100%;max-width:100%;margin:0;">

  <!-- Logo bar -->
  <div style="text-align:center;padding:20px 16px 0;margin-bottom:24px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#111;">Area<span style="color:#10B981;">Connect</span></span>
  </div>

  <!-- Card -->
  <div style="background:#fff;border-radius:0;overflow:hidden;box-shadow:none;">

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
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:0;">

<div style="width:100%;max-width:100%;margin:0;">

  <div style="text-align:center;padding:20px 16px 0;margin-bottom:24px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#111;">Area<span style="color:#10B981;">Connect</span></span>
  </div>

  <div style="background:#fff;border-radius:0;overflow:hidden;box-shadow:none;">

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
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;margin:0;padding:0;">
<div style="width:100%;max-width:100%;margin:0;">

  <!-- Logo bar -->
  <div style="text-align:center;padding:20px 16px 0;margin-bottom:20px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#111;">Area<span style="color:#10B981;">Connect</span></span>
  </div>

  <!-- Invoice card -->
  <div style="background:#fff;border-radius:0;overflow:hidden;box-shadow:none;">

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
      <span style="font-size:11px;color:#94A3B8;">Powered by <strong style="color:#10B981;">Area Connector Technologies</strong> &nbsp;·&nbsp; RC 9607864</span>
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
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;margin:0;padding:0;">
<div style="width:100%;max-width:100%;margin:0;">
  <div style="text-align:center;padding:20px 16px 0;margin-bottom:16px;">
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
    <div style="background:#fff;border-radius:0;overflow:hidden;box-shadow:none;margin-top:20px;">
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
        <span style="font-size:11px;color:#94A3B8;">Powered by <strong style="color:#10B981;">Area Connector Technologies</strong> &nbsp;&middot;&nbsp; RC 9607864</span>
      </div>
    </div>`;

  await getResend().emails.send({
    from: FROM(),
    to,
    subject: `${isUrgent ? '🚨 URGENT:' : '⚠️'} Your ${isTrial ? 'trial' : 'subscription'} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} — ${estateName}`,
    html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;margin:0;padding:0;">
<div style="width:100%;max-width:100%;margin:0;">

  <div style="text-align:center;padding:20px 16px 0;margin-bottom:20px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#111;">Area<span style="color:#10B981;">Connect</span></span>
  </div>

  <div style="background:#fff;border-radius:0;overflow:hidden;box-shadow:none;">
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
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#0F172A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;margin:0;padding:0;">
<div style="width:100%;max-width:100%;margin:0;">
  <div style="text-align:center;padding:20px 16px 0;margin-bottom:16px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#fff;">Area<span style="color:#10B981;">Connect</span></span>
  </div>

  <div style="background:#fff;border-radius:0;overflow:hidden;box-shadow:none;border:3px solid #DC2626;">
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
      <p style="text-align:center;font-size:11px;color:#94A3B8;margin:0;padding:14px 16px 20px;">
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

// ── Password-reset review request (to estate manager) ────────────────────
const sendPasswordResetRequestEmail = async ({
  to, managerName, estateName, requesterName, requesterRole, requesterUnit, requesterEmail, reviewUrl,
}) => {
  if (!process.env.RESEND_API_KEY || !to) return { skipped: true };
  const unitLine = requesterUnit ? `<strong>${requesterUnit}</strong> · ` : '';
  const roleLabel = requesterRole === 'security' ? 'Security officer' : 'Resident';
  await getResend().emails.send({
    from: FROM(),
    to,
    subject: `🔐 Password reset request · ${requesterName} (${estateName})`,
    html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;margin:0;padding:0;">
<div style="width:100%;max-width:100%;margin:0;">
  <div style="text-align:center;padding:20px 16px 0;margin-bottom:16px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#111;">Area<span style="color:#10B981;">Connect</span></span>
  </div>
  <div style="background:#fff;border-radius:0;overflow:hidden;box-shadow:none;">
    <div style="background:linear-gradient(135deg,#4F46E5,#6366F1);padding:28px 32px;color:#fff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.85);margin-bottom:4px;">${estateName}</div>
      <h1 style="font-size:22px;font-weight:800;letter-spacing:-0.02em;margin:0;">🔐 Password reset request</h1>
    </div>
    <div style="padding:28px 32px;">
      <p style="font-size:15px;color:#374151;line-height:1.65;margin:0 0 18px;">
        Hi <strong>${managerName || 'Manager'}</strong>,<br><br>
        A ${roleLabel.toLowerCase()} at ${estateName} is asking you to approve a password reset for their account.
      </p>
      <div style="background:#EEF2FF;border:1px solid #C7D2FE;border-radius:12px;padding:14px 18px;margin-bottom:22px;">
        <div style="font-size:11px;font-weight:800;color:#4338CA;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">Request details</div>
        <div style="font-size:14px;color:#1F2937;line-height:1.6;">
          ${unitLine}<strong>${requesterName}</strong><br>
          <span style="color:#64748B;">${requesterEmail} &middot; ${roleLabel}</span>
        </div>
      </div>
      <div style="text-align:center;margin:2px 0 8px;">
        <a href="${reviewUrl}"
          style="display:inline-block;background:linear-gradient(135deg,#10B981,#059669);color:#fff;font-weight:700;font-size:14px;text-decoration:none;padding:12px 28px;border-radius:12px;">
          Review in dashboard &rarr;
        </a>
      </div>
      <p style="font-size:12px;color:#64748B;line-height:1.6;margin-top:18px;">
        Approving will email the ${roleLabel.toLowerCase()} a temporary password. They'll be forced to change it on next sign-in.
      </p>
    </div>
    <div style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:12px 20px;">
      <span style="font-size:11px;color:#94A3B8;">Powered by <strong style="color:#10B981;">Area Connector Technologies</strong> &nbsp;&middot;&nbsp; RC 9607864</span>
    </div>
  </div>
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
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;margin:0;padding:0;">
<div style="width:100%;max-width:100%;margin:0;">
  <div style="text-align:center;padding:20px 16px 0;margin-bottom:20px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#111;">Area<span style="color:#10B981;">Connect</span></span>
  </div>
  <div style="background:#fff;border-radius:0;overflow:hidden;box-shadow:none;">
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
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;margin:0;padding:0;">
<div style="width:100%;max-width:100%;margin:0;">
  <div style="text-align:center;padding:20px 16px 0;margin-bottom:20px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#111;">Area<span style="color:#10B981;">Connect</span></span>
  </div>
  <div style="background:#fff;border-radius:0;overflow:hidden;box-shadow:none;">
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
        <span style="font-size:11px;color:#94A3B8;">Powered by <strong style="color:#10B981;">Area Connector Technologies</strong> &nbsp;&middot;&nbsp; RC 9607864</span>
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
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;margin:0;padding:0;">
<div style="width:100%;max-width:100%;margin:0;">

  <div style="text-align:center;padding:20px 16px 0;margin-bottom:20px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#111;">Area<span style="color:#10B981;">Connect</span></span>
  </div>

  <div style="background:#fff;border-radius:0;overflow:hidden;box-shadow:none;">
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

// Inline images for the pitch email (CID attachments — no hosting needed).
// areamates-phone.gif is a recording of the landing page hero iPhone animation.
const PITCH_ASSET_DIR = require('path').join(__dirname, '../assets/email');
let pitchAssets;
const getPitchAssets = () => {
  if (!pitchAssets) {
    const fs = require('fs');
    const file = (filename, contentId) => ({
      filename, contentId,
      content: fs.readFileSync(require('path').join(PITCH_ASSET_DIR, filename)),
    });
    pitchAssets = [
      file('logo.png', 'ac-logo'),
      file('areamates-phone.gif', 'ac-phone'),
      file('michael.png', 'ac-michael'),
    ];
  }
  return pitchAssets;
};

const sendPitchEmail = async ({ to, name, title, company, city }) => {
  if (!process.env.RESEND_API_KEY) return { skipped: true };

  const REPLY_TO  = 'michael@areaconnect.pro';
  const REGISTER  = 'https://area-connector.areaconnect.pro/register';
  const firstName = escapeHtml((name || '').trim().split(' ')[0] || 'there');
  const org       = escapeHtml(company || 'your estate');
  const where     = city ? ` in ${escapeHtml(city)}` : '';
  const about     = company ? ` (${company})` : '';

  // Tap-to-reply: each option opens a pre-written reply, so answering takes one tap
  const reply = (subject, body) =>
    `mailto:${REPLY_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  const C = { ink: '#0F172A', body: '#475569', muted: '#94A3B8', line: '#E2E8F0', soft: '#F8FAFC', green: '#10B981', greenDark: '#059669', indigo: '#6366F1' };

  // An ordinary evening on AreaConnect — mirrors what the phone animation shows
  const timeline = [
    ['6:28 PM', C.indigo, 'Ada creates a visitor pass',     'Tunde gets a 6-digit code by SMS.'],
    ['6:31 PM', C.green,  'Gate 2 verifies the code',       'The guard checks it in seconds — no phone calls, no paper log.'],
    ['6:31 PM', '#0EA5E9','Ada gets a ping',                '“Tunde Adeyemi has arrived.”'],
    ['9:04 PM', '#F59E0B','Service charge paid',            'Receipt sent automatically. The manager sees it on the dashboard.'],
  ].map(([time, dot, head, text], i, arr) => `
        <tr>
          <td width="64" valign="top" style="padding:0 0 ${i === arr.length - 1 ? 0 : 18}px;font-size:12px;font-weight:600;color:${C.muted};white-space:nowrap;">${time}</td>
          <td width="22" valign="top" style="padding:3px 0 0;">
            <div style="width:10px;height:10px;border-radius:50%;background:${dot};"></div>
          </td>
          <td valign="top" style="padding:0 0 ${i === arr.length - 1 ? 0 : 18}px;">
            <div style="font-size:15px;font-weight:600;color:${C.ink};">${head}</div>
            <div style="font-size:14px;line-height:1.55;color:${C.body};margin-top:2px;">${text}</div>
          </td>
        </tr>`).join('');

  const pains = [
    ['🚪', 'Gate & visitor access',     'Who’s coming in — and did anyone check?'],
    ['💳', 'Levies & service charges',  'Chasing payments on WhatsApp'],
    ['📣', 'Keeping residents informed', 'Notices nobody reads'],
    ['🛡️', 'Security response',         'Getting help fast when something happens'],
  ].map(([icon, label, hint]) => `
        <tr><td style="padding:0 0 8px;">
          <a href="${reply(`Re: ${label}${about}`, `Hi Michael,\n\nThe one that costs us the most time is: ${label}.\n\n`)}"
             style="display:block;text-decoration:none;background:#FFFFFF;border:1px solid ${C.line};border-radius:12px;padding:13px 14px;">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              <td width="32" style="font-size:19px;vertical-align:middle;">${icon}</td>
              <td style="vertical-align:middle;">
                <div style="font-size:15px;font-weight:600;color:${C.ink};">${label}</div>
                <div style="font-size:13px;color:${C.muted};margin-top:1px;">${hint}</div>
              </td>
              <td width="64" style="vertical-align:middle;text-align:right;font-size:12px;font-weight:600;color:${C.greenDark};white-space:nowrap;">Tap &rsaquo;</td>
            </tr></table>
          </a>
        </td></tr>`).join('');

  const apps = [
    ['Estate Manager', C.green,  'Residents, dues, payouts and reports in one dashboard.'],
    ['AreaMates',      C.indigo, 'Residents invite guests, pay dues and get notices.'],
    ['Guard',          '#F59E0B','Verify a visitor’s code at the gate in seconds.'],
  ].map(([t, color, d]) => `
          <td width="33%" valign="top" style="padding:0 10px 0 0;">
            <div style="height:3px;width:28px;border-radius:2px;background:${color};margin-bottom:10px;"></div>
            <div style="font-size:14px;font-weight:700;color:${C.ink};">${t}</div>
            <div style="font-size:13px;line-height:1.5;color:${C.body};margin-top:3px;">${d}</div>
          </td>`).join('');

  const { error } = await getResend().emails.send({
    from: FROM(),
    reply_to: REPLY_TO,
    to,
    subject: `A calmer evening at ${company || 'your estate'}`,
    attachments: getPitchAssets(),
    html: `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<title>AreaConnect</title></head>
<body style="margin:0;padding:0;background:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;color:${C.ink};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Visitor passes, dues and notices — quietly handled. One question inside, one tap to answer.</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;"><tr><td align="left" style="padding:28px 24px 36px;text-align:left;">

  <!-- Logo -->
  <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;"><tr>
    <td style="vertical-align:middle;padding-right:10px;"><img src="cid:ac-logo" width="36" height="36" alt="AreaConnect" style="display:block;border:0;border-radius:9px;"></td>
    <td style="vertical-align:middle;font-size:18px;font-weight:800;letter-spacing:-0.02em;color:${C.ink};">Area<span style="color:${C.green};">Connect</span></td>
  </tr></table>

  <!-- Intro -->
  <div style="font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${C.green};margin:0 0 10px;">For ${org}</div>
  <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;font-weight:800;letter-spacing:-0.03em;color:${C.ink};">
    Your whole estate,<br>quietly taken care of.
  </h1>
  <p style="margin:0 0 14px;font-size:16px;line-height:1.7;color:${C.body};">Hi ${firstName},</p>
  <p style="margin:0 0 28px;font-size:16px;line-height:1.7;color:${C.body};">
    I’m Michael, founder of AreaConnect. We help estates like ${org}${where} run the gate, dues and resident
    updates from one place &mdash; so evenings are a little calmer for everyone. Here’s what it looks like on a resident’s phone:
  </p>

  <!-- Animated phone (recorded from areaconnect.pro) -->
  <a href="https://areaconnect.pro" style="display:inline-block;text-decoration:none;">
    <img src="cid:ac-phone" width="300" alt="AreaMates app: visitor passes updating live as guests arrive" style="display:block;border:0;width:300px;max-width:100%;height:auto;">
  </a>

  <!-- An evening, step by step -->
  <h2 style="margin:32px 0 16px;font-size:19px;font-weight:700;letter-spacing:-0.01em;color:${C.ink};">An ordinary evening, handled</h2>
  <table cellpadding="0" cellspacing="0" style="margin:0 0 34px;max-width:560px;">${timeline}
  </table>

  <!-- Interactive question -->
  <div style="background:${C.soft};border:1px solid ${C.line};border-radius:16px;padding:20px 16px 12px;margin:0 0 34px;max-width:560px;">
    <div style="font-size:18px;font-weight:700;letter-spacing:-0.01em;color:${C.ink};">What takes up most of your week?</div>
    <div style="font-size:13px;color:${C.muted};margin:4px 0 14px;">Tap one &mdash; it opens a ready-made reply. I read every one myself.</div>
    <table width="100%" cellpadding="0" cellspacing="0">${pains}
    </table>
  </div>

  <!-- Three apps -->
  <h2 style="margin:0 0 16px;font-size:19px;font-weight:700;letter-spacing:-0.01em;color:${C.ink};">Three apps, one estate</h2>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 34px;max-width:620px;"><tr>${apps}
  </tr></table>

  <!-- Offer + CTAs -->
  <p style="margin:0 0 6px;font-size:16px;line-height:1.7;color:${C.body};">
    If you’d like to try it, <strong style="color:${C.ink};">the first month is free</strong> &mdash; every feature, no card, nothing to cancel.
    Setup takes about ten minutes, and I’m happy to do it with you.
  </p>
  <p style="margin:0 0 22px;font-size:13px;color:${C.muted};">After that, plans start at &#8358;20,000/month.</p>
  <table cellpadding="0" cellspacing="0" style="margin:0 0 36px;"><tr>
    <td style="padding:0 10px 10px 0;">
      <a href="${REGISTER}" style="display:inline-block;background:${C.green};color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;padding:13px 22px;border-radius:999px;">Start my free month &rarr;</a>
    </td>
    <td style="padding:0 0 10px;">
      <a href="${reply(`Walkthrough for ${company || 'our estate'}`, `Hi Michael,\n\nI'd like a 15-minute walkthrough. A good time for me is:\n\n`)}" style="display:inline-block;background:#FFFFFF;color:${C.greenDark};font-size:15px;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:999px;border:1px solid #A7F3D0;">Book a 15-min walkthrough</a>
    </td>
  </tr></table>

  <!-- Sign-off -->
  <table cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.line};padding-top:22px;max-width:560px;width:100%;"><tr>
    <td width="68" valign="top" style="padding-top:22px;"><img src="cid:ac-michael" width="56" height="56" alt="Michael Orizu" style="display:block;border:0;border-radius:50%;"></td>
    <td valign="top" style="padding-top:22px;">
      <div style="font-size:15px;line-height:1.6;color:${C.body};">No pressure either way &mdash; thanks for reading.</div>
      <div style="font-size:15px;font-weight:700;color:${C.ink};margin-top:6px;">Michael Orizu</div>
      <div style="font-size:13px;color:${C.muted};">Founder, AreaConnect &middot; <a href="mailto:${REPLY_TO}" style="color:${C.greenDark};text-decoration:none;">${REPLY_TO}</a></div>
    </td>
  </tr></table>

  <!-- Quiet opt-out -->
  <p style="margin:30px 0 0;font-size:12px;line-height:1.8;color:${C.muted};">
    Not the right time? <a href="${reply(`Not right now${about}`, 'Hi Michael,\n\nNot right now, thanks.\n')}" style="color:${C.body};">Let me know</a>
    and I won’t follow up. &middot; <a href="${FRONTEND_URL}/unsubscribe" style="color:${C.muted};">Unsubscribe</a><br>
    Area Connector Technologies &middot; RC 9607864 &middot; Lagos, Nigeria
  </p>

</td></tr></table>
</body></html>`,
  });
  // Resend reports failures in the response rather than throwing
  if (error) throw Object.assign(new Error(error.message), { name: error.name, statusCode: error.statusCode });

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
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;margin:0;padding:0;">
<div style="width:100%;max-width:100%;margin:0;">
  <div style="text-align:center;padding:20px 16px 0;margin-bottom:16px;">
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
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;margin:0;padding:0;">
<div style="width:100%;max-width:100%;margin:0;">
  <div style="text-align:center;padding:20px 16px 0;margin-bottom:16px;">
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
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0F172A;margin:0;padding:0;">
${preheaderBlock}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:100%;margin:0;">
  <tr><td align="center" style="padding:8px 0 20px;">${logoBlock}</td></tr>

  <tr><td style="background:#ffffff;border-radius:0;box-shadow:none;overflow:hidden;">
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


// ── Emergency alert emails ──────────────────────────────────────────────────
// Sent alongside the real-time socket alert so anyone without the app open
// still hears about it. Uses Resend's batch API (≤100 per request) — firing
// one request per recipient trips Resend's rate limit on large estates.
const ALERT_TYPE_LABEL = {
  security: 'Security threat', fire: 'Fire emergency', medical: 'Medical emergency',
  noise: 'Noise complaint', other: 'Alert',
};
const ALERT_SEVERITY_COLOR = { critical: '#B91C1C', high: '#DC2626', medium: '#D97706', low: '#2563EB' };
const APP_URL_BY_ROLE = {
  resident:       process.env.RESIDENTS_URL || 'https://area-mates.areaconnect.pro',
  estate_manager: process.env.CLIENT_URL    || 'https://area-connector.areaconnect.pro',
  super_admin:    process.env.CLIENT_URL    || 'https://area-connector.areaconnect.pro',
  security:       process.env.SECURITY_URL  || 'https://area-guards.areaconnect.pro',
};

const escapeHtml = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const buildAlertEmailHtml = ({ name, estateName, alert, raisedBy, isBroadcast, url }) => {
  const sev    = alert.severity || 'high';
  const color  = ALERT_SEVERITY_COLOR[sev] || ALERT_SEVERITY_COLOR.high;
  const label  = ALERT_TYPE_LABEL[alert.type] || 'Alert';
  const title  = escapeHtml(alert.title || label);
  const rows = [
    ['Type', label],
    ['Severity', sev.charAt(0).toUpperCase() + sev.slice(1)],
    alert.location && ['Location', alert.location],
    raisedBy?.unit && ['Unit', raisedBy.unit],
    raisedBy?.name && [isBroadcast ? 'Sent by' : 'Raised by', `${raisedBy.name}${raisedBy.roleLabel ? ` (${raisedBy.roleLabel})` : ''}`],
    (alert.contactNumber || raisedBy?.phone) && ['Contact', alert.contactNumber || raisedBy.phone],
    ['Time', new Date(alert.createdAt || Date.now()).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' })],
  ].filter(Boolean);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;margin:0;padding:0;">
<div style="width:100%;max-width:100%;margin:0;background:#fff;border-radius:0;overflow:hidden;border:0;">
  <div style="background:${color};padding:22px 24px;color:#fff;">
    <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;opacity:.85;">
      ${isBroadcast ? 'Emergency broadcast' : 'Emergency alert'} &middot; ${escapeHtml(estateName)}
    </div>
    <div style="font-size:22px;font-weight:800;line-height:1.25;margin-top:6px;">${title}</div>
  </div>
  <div style="padding:22px 24px;">
    <p style="margin:0 0 14px;font-size:15px;color:#334155;">Hi ${escapeHtml((name || 'there').split(' ')[0])},</p>
    ${alert.note ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#0F172A;background:#F8FAFC;border-left:3px solid ${color};padding:12px 14px;border-radius:6px;">${escapeHtml(alert.note)}</p>` : ''}
    ${alert.actionRequired ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#92400E;background:#FFFBEB;border:1px solid #FDE68A;padding:10px 14px;border-radius:8px;"><strong>What to do:</strong> ${escapeHtml(alert.actionRequired)}</p>` : ''}
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
      ${rows.map(([k, v]) => `<tr><td style="padding:7px 0;color:#64748B;width:110px;vertical-align:top;">${k}</td><td style="padding:7px 0;color:#0F172A;font-weight:600;">${escapeHtml(v)}</td></tr>`).join('')}
    </table>
    <a href="${url}" style="display:block;text-align:center;background:#0F172A;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px;border-radius:10px;">Open alerts</a>
    <p style="margin:16px 0 0;font-size:12px;color:#94A3B8;line-height:1.5;">In immediate danger? Call 112 (Nigeria emergency line) first.</p>
  </div>
</div>
<p style="text-align:center;font-size:11px;color:#94A3B8;margin:0;padding:14px 16px 20px;">AreaConnect &middot; ${escapeHtml(estateName)}</p>
</body></html>`;
};

/**
 * recipients: [{ email, name, role }]
 * raisedBy:   { name, phone, unit, roleLabel }
 */
const sendEmergencyAlertEmails = async ({ recipients, alert, estateName, raisedBy, isBroadcast }) => {
  if (!process.env.RESEND_API_KEY || !recipients?.length) return { skipped: true, sent: 0 };
  const label   = ALERT_TYPE_LABEL[alert.type] || 'Alert';
  const subject = `🚨 ${isBroadcast ? 'Emergency broadcast' : label}: ${alert.title || label} — ${estateName}`;
  const emails  = recipients.map((r) => ({
    from: FROM(),
    to: r.email,
    subject,
    html: buildAlertEmailHtml({
      name: r.name, estateName, alert, raisedBy, isBroadcast,
      url: `${APP_URL_BY_ROLE[r.role] || APP_URL_BY_ROLE.resident}/alerts`,
    }),
  }));

  let sent = 0;
  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100);
    try {
      const { error } = await getResend().batch.send(chunk);
      if (error) console.error('[alert email] batch error', error.message || error);
      else sent += chunk.length;
    } catch (e) {
      console.error('[alert email] batch failed', e.message);
    }
    if (i + 100 < emails.length) await new Promise((r) => setTimeout(r, 600)); // stay under rate limit
  }
  return { sent };
};


// ── Neighbour buzz ──────────────────────────────────────────────────────────
const BUZZ_COPY = {
  checkin:         { emoji: '👋', headline: (n) => `${n} is checking up on you`, line: 'just wanted to see how you\'re doing.' },
  greeting:        { emoji: '😊', headline: (n) => `${n} says hello`, line: 'sent you a friendly hello.' },
  thinking_of_you: { emoji: '💛', headline: (n) => `${n} is thinking of you`, line: 'is thinking of you today.' },
};

const sendBuzzEmail = async ({ to, toName, fromName, fromPhotoUrl, fromUnit, estateName, kind = 'checkin', message, appUrl, fromIsManager = false }) => {
  if (!process.env.RESEND_API_KEY || !to) return { skipped: true };
  const copy = BUZZ_COPY[kind] || BUZZ_COPY.checkin;
  const first = (s) => escapeHtml((s || '').split(' ')[0] || 'there');
  const initials = escapeHtml((fromName || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase());
  const avatar = fromPhotoUrl
    ? `<img src="${fromPhotoUrl}" width="88" height="88" alt="${escapeHtml(fromName)}" style="display:block;width:88px;height:88px;border-radius:50%;object-fit:cover;border:4px solid #fff;box-shadow:0 6px 18px rgba(79,70,229,.25);margin:0 auto;">`
    : `<div style="width:88px;height:88px;border-radius:50%;background:#6366F1;color:#fff;font-size:32px;font-weight:800;line-height:88px;text-align:center;border:4px solid #fff;margin:0 auto;">${initials}</div>`;

  await getResend().emails.send({
    from: FROM(),
    to,
    subject: `${copy.emoji} ${copy.headline(fromName || 'A neighbour')}`,
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#EEF2FF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;margin:0;padding:0;">
<div style="width:100%;max-width:100%;margin:0;background:#fff;border-radius:0;overflow:hidden;border:0;">
  <div style="background:linear-gradient(135deg,#312E81,#4F46E5 60%,#818CF8);height:96px;"></div>
  <div style="margin-top:-52px;text-align:center;padding:0 24px;">
    ${avatar}
    <div style="font-size:12px;color:#6366F1;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-top:14px;">${fromIsManager ? 'Check-in from estate management' : 'Neighbour buzz'} · ${escapeHtml(estateName)}</div>
    <h1 style="font-size:22px;line-height:1.3;color:#0F172A;margin:6px 0 4px;">${copy.emoji} ${escapeHtml(copy.headline(fromName || 'A neighbour'))}</h1>
    <div style="font-size:14px;color:#64748B;">${escapeHtml(fromName || 'Your neighbour')}${fromUnit ? ` &middot; ${escapeHtml(fromUnit)}` : ''}</div>
  </div>
  <div style="padding:22px 28px 28px;">
    <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 14px;">Hi ${first(toName)}, ${escapeHtml((fromName || 'your neighbour').split(' ')[0])} ${copy.line}</p>
    ${message ? `<p style="font-size:15px;line-height:1.6;color:#0F172A;background:#F5F3FF;border-left:3px solid #6366F1;padding:12px 14px;border-radius:8px;margin:0 0 18px;">“${escapeHtml(message)}”</p>` : ''}
    <a href="${appUrl}" style="display:block;text-align:center;background:#4F46E5;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px;border-radius:12px;">${fromIsManager ? `Call ${first(fromName)} back (free)` : `Buzz back or call ${first(fromName)}`}</a>
    <p style="font-size:12px;color:#94A3B8;line-height:1.5;margin:16px 0 0;text-align:center;">${fromIsManager ? 'Sent by your estate management via AreaMates.' : 'You can hide yourself from the neighbours list in AreaMates → Settings → Privacy.'}</p>
  </div>
</div>
</body></html>`,
  });
  return { sent: true };
};


// ── Call-credit receipts (purchase or AreaConnect gift) ─────────────────────
const sendCreditReceiptEmail = async ({ to, name, inv, pdf }) => {
  if (!process.env.RESEND_API_KEY || !to) return { skipped: true };
  const { isGift, credits, balanceAfter, note } = inv.meta || {};
  const first = escapeHtml((name || 'there').split(' ')[0]);
  const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
  const value = Math.abs(inv.items[0]?.total || 0);
  const appUrl = `${process.env.RESIDENTS_URL || 'https://area-mates.areaconnect.pro'}/neighbours`;
  const headline = isGift ? `🎁 You've received ${credits} free call credits` : `Payment received — ${credits} call credits added`;
  const rows = [
    ['Credits', `${credits} (≈ ${credits} min of neighbour calls)`],
    isGift ? ['Value', `${naira(value)} — on us`] : ['Amount paid', naira(inv.total)],
    ['New balance', `${balanceAfter ?? '—'} credits`],
    ['Receipt no.', inv.invoiceNumber],
    ['Date', new Date(inv.date).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' })],
  ];

  await getResend().emails.send({
    from: FROM(),
    to,
    subject: isGift ? `🎁 ${credits} free call credits from AreaConnect` : `Receipt: ${credits} call credits — ${naira(inv.total)}`,
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#EEF2FF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;margin:0;padding:0;">
<div style="width:100%;max-width:100%;margin:0;background:#fff;border-radius:0;overflow:hidden;border:0;">
  <div style="background:linear-gradient(135deg,#312E81,#4F46E5 60%,#818CF8);padding:26px 28px;color:#fff;">
    <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;opacity:.85;">${isGift ? 'Gift credits' : 'Call credits receipt'} &middot; AreaMates</div>
    <div style="font-size:22px;font-weight:800;line-height:1.3;margin-top:6px;">${escapeHtml(headline)}</div>
  </div>
  <div style="padding:24px 28px;">
    <p style="font-size:15px;color:#334155;line-height:1.6;margin:0 0 16px;">Hi ${first}, ${isGift
      ? 'AreaConnect has added free call credits to your account. Use them to call your neighbours from AreaMates.'
      : 'thanks for your purchase. Your call credits are ready to use.'}</p>
    ${isGift && note ? `<p style="font-size:15px;line-height:1.6;color:#0F172A;background:#F5F3FF;border-left:3px solid #6366F1;padding:12px 14px;border-radius:8px;margin:0 0 16px;">“${escapeHtml(note)}”</p>` : ''}
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
      ${rows.map(([k, v]) => `<tr><td style="padding:7px 0;color:#64748B;width:120px;">${k}</td><td style="padding:7px 0;color:#0F172A;font-weight:600;">${escapeHtml(v)}</td></tr>`).join('')}
    </table>
    <a href="${appUrl}" style="display:block;text-align:center;background:#4F46E5;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px;border-radius:12px;">Call a neighbour</a>
    <p style="font-size:12px;color:#94A3B8;line-height:1.5;margin:16px 0 0;">Your ${isGift ? 'gift receipt' : 'invoice'} (${escapeHtml(inv.invoiceNumber)}.pdf) is attached. Credits never expire. Calls to security and estate management are always free.</p>
  </div>
</div>
<p style="text-align:center;font-size:11px;color:#94A3B8;margin:0;padding:14px 16px 20px;">Powered by Area Connector Technologies &middot; RC 9607864</p>
</body></html>`,
    attachments: pdf ? [{ filename: `${inv.invoiceNumber}.pdf`, content: pdf.toString('base64') }] : undefined,
  });
  return { sent: true };
};

module.exports = {
  sendCreditReceiptEmail,
  sendBuzzEmail,
  sendEmergencyAlertEmails,
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
  sendPasswordResetRequestEmail,
  generateInvoiceHtml,
  sendPitchEmail,
  sendCampaignEmail,
};
