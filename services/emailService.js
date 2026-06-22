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

  <p style="text-align:center;font-size:12px;color:#9CA3AF;margin-top:20px;">Powered by AreaConnect &nbsp;&middot;&nbsp; areaconnect.pro</p>
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
  <p style="text-align:center;font-size:12px;color:#9CA3AF;margin-top:20px;">Powered by AreaConnect &nbsp;&middot;&nbsp; areaconnect.pro</p>
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
    Powered by AreaConnect &nbsp;&middot;&nbsp; areaconnect.pro
  </p>
</div>
</body></html>`,
  });

  return { sent: true };
};

// ── Pitch / intro email (to prospects) ───────────────────────────────────────
const sendPitchEmail = async ({ to, name, title, company, city }) => {
  if (!process.env.RESEND_API_KEY) return { skipped: true };

  const firstName = (name || '').split(' ')[0] || 'there';
  const greeting = title ? `${title} ${(name || '').split(' ').slice(-1)[0]}` : firstName;

  await getResend().emails.send({
    from: FROM(),
    reply_to: 'michael@areaconnect.pro',
    to,
    subject: `Transform How You Manage ${company || 'Your Estate'} — AreaConnect`,
    html: `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box;margin:0;padding:0;}</style></head>
<body style="background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;padding:32px 16px;margin:0;">
<div style="max-width:600px;margin:0 auto;">

  <!-- Logo -->
  <div style="text-align:center;margin-bottom:24px;">
    <span style="font-size:26px;font-weight:900;letter-spacing:-0.04em;color:#0F172A;">Area<span style="color:#10B981;">Connect</span></span>
    <div style="font-size:11px;color:#94A3B8;letter-spacing:0.08em;text-transform:uppercase;margin-top:4px;">Smart Estate Management Platform</div>
  </div>

  <!-- Hero card -->
  <div style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.12);">

    <!-- Header gradient -->
    <div style="background:linear-gradient(135deg,#0F172A 0%,#1E3A5F 60%,#10B981 100%);padding:40px 32px;text-align:center;">
      <div style="display:inline-block;background:rgba(16,185,129,0.2);border:1px solid rgba(16,185,129,0.4);color:#34D399;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:5px 14px;border-radius:20px;margin-bottom:16px;">
        Estate Management Revolution
      </div>
      <h1 style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-0.03em;line-height:1.2;margin-bottom:8px;">
        Your Estate Deserves<br>Better Technology
      </h1>
      <p style="font-size:15px;color:rgba(255,255,255,0.7);line-height:1.6;">
        Join hundreds of Nigerian estates already running on AreaConnect
      </p>
    </div>

    <!-- Body -->
    <div style="padding:36px 32px;">

      <!-- Greeting -->
      <p style="font-size:16px;color:#374151;line-height:1.7;margin-bottom:24px;">
        Hi <strong style="color:#0F172A;">${greeting}</strong>,
      </p>
      <p style="font-size:15px;color:#4B5563;line-height:1.8;margin-bottom:28px;">
        Managing <strong>${company}</strong>${city ? ` in <strong>${city}</strong>` : ''} comes with real challenges —
        tracking residents, managing security, collecting levies, and keeping everyone informed.
        <strong style="color:#0F172A;">AreaConnect</strong> was built specifically for estates like yours.
      </p>

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
        <p style="font-size:11px;font-weight:800;color:#059669;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:10px;">Transparent Pricing</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          ${[
            ['Starter',    '&#8358;20,000/mo',  'Up to 50 residents &middot; security, announcements, visitor mgmt'],
            ['Growth',     '&#8358;47,000/mo',  'Up to 150 residents &middot; payments, AI, community chat, events'],
            ['Premium',    '&#8358;80,000/mo',  'Up to 300 residents &middot; marketplace, lounge, white-label'],
            ['Enterprise', '&#8358;100,000/mo', 'Up to 500 residents &middot; full suite, API access, priority support'],
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
          ['500+',   'Active Estates'],
          ['50,000+','Residents Managed'],
          ['99.9%',  'Platform Uptime'],
          ['Free','To Get Started'],
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
          Get Started &rarr;
        </a>
        <p style="font-size:12px;color:#94A3B8;margin-top:10px;">No credit card required &nbsp;·&nbsp; Setup in under 10 minutes</p>
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
                I built AreaConnect because I've seen first-hand how much time Nigerian estate managers lose to manual processes — WhatsApp dues reminders, handwritten visitor logs, security gaps. I'd love to show you what we've built and hear what's most painful for <strong>${company}</strong>.
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
  <p style="text-align:center;font-size:12px;color:#9CA3AF;margin-top:20px;">Powered by AreaConnect &nbsp;&middot;&nbsp; areaconnect.pro</p>
</div>
</body></html>`,
    attachments: [{
      filename: `withdrawal-${reference}.pdf`,
      content: pdfBuffer.toString('base64'),
    }],
  });

  return { sent: true };
};

module.exports = {
  sendVisitorPass,
  sendInviteEmail,
  sendManagerNotificationEmail,
  sendPaymentReceiptEmail,
  sendWithdrawalReceiptEmail,
  sendSubscriptionReminderEmail,
  generateInvoiceHtml,
  sendPitchEmail,
};
