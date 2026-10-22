// Landing-page "Book a demo" — 30-min video calls with the AreaConnect team.
// Meetings are created on Zoho Meeting when configured (host: michael@areaconnect.pro),
// otherwise Google Meet. Every booking is stored so taken slots disappear.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { Resend } = require('resend');
const { brandMark, withLogo } = require('../services/emailBrand');
const gcal = require('../services/googleCalendarService');
const zoho = require('../services/zohoMeetingService');
const DemoBooking = require('../models/DemoBooking');

const router = express.Router();

const HOST_EMAIL   = process.env.DEMO_HOST_EMAIL || 'michael@areaconnect.pro';
const SLOT_MINUTES = 30;
const DAY_START    = 9;       // 09:00 WAT
const DAY_END      = 17;      // last slot starts 16:30 WAT
const WINDOW_DAYS  = 21;
const LEAD_MINUTES = 120;     // no bookings less than 2h out
const WAT_OFFSET   = 60;      // Africa/Lagos is UTC+1 year-round (no DST)

const getResend = () => new Resend(process.env.RESEND_API_KEY);
const FROM = () => process.env.RESEND_FROM || 'AreaConnect <noreply@areaconnect.pro>';

const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// "2026-10-21" + "09:30" (WAT) → Date
const watToDate = (day, hhmm) => new Date(`${day}T${hhmm}:00+01:00`);

// Date → "YYYY-MM-DD" in WAT
const watDay = (d) => new Date(d.getTime() + WAT_OFFSET * 60_000).toISOString().slice(0, 10);

function candidateSlots() {
  const earliest = Date.now() + LEAD_MINUTES * 60_000;
  const days = {};
  const today = watDay(new Date());
  for (let i = 0; i <= WINDOW_DAYS; i++) {
    const day = new Date(new Date(`${today}T12:00:00+01:00`).getTime() + i * 86_400_000);
    const key = watDay(day);
    const dow = new Date(`${key}T12:00:00+01:00`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const slots = [];
    for (let m = DAY_START * 60; m < DAY_END * 60; m += SLOT_MINUTES) {
      const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      if (watToDate(key, hhmm).getTime() >= earliest) slots.push(hhmm);
    }
    if (slots.length) days[key] = slots;
  }
  return days;
}

const overlaps = (start, end, busy) => busy.some(b => start < b.end && end > b.start);

const provider = () => (zoho.isConfigured() ? 'zoho' : gcal.isConfigured() ? 'google' : 'none');

async function freeSlots() {
  const days = candidateSlots();
  const keys = Object.keys(days);
  if (!keys.length) return days;

  const from = watToDate(keys[0], '00:00');
  const to = watToDate(keys[keys.length - 1], '23:59');
  const booked = await DemoBooking.find({ status: 'booked', start: { $gte: from, $lte: to } }, 'start end').lean();
  const busy = booked.map(b => ({ start: b.start, end: b.end }));
  if (provider() === 'google') busy.push(...await gcal.getBusy(from, to));

  for (const day of keys) {
    days[day] = days[day].filter(hhmm => {
      const start = watToDate(day, hhmm);
      return !overlaps(start, new Date(start.getTime() + SLOT_MINUTES * 60_000), busy);
    });
    if (!days[day].length) delete days[day];
  }
  return days;
}

// ── Invite helpers ─────────────────────────────────────────────────────────
const icsDate = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s = '') => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function icsInvite({ uid, start, end, summary, description, location, organizer, attendee }) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AreaConnect//Demo booking//EN', 'CALSCALE:GREGORIAN', 'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(summary)}`,
    `DESCRIPTION:${icsText(description)}`,
    location ? `LOCATION:${icsText(location)}` : null,
    location ? `URL:${location}` : null,
    `ORGANIZER;CN=Michael at AreaConnect:mailto:${organizer}`,
    `ATTENDEE;CN=${icsText(attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${attendee.email}`,
    'BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'DESCRIPTION:AreaConnect demo in 15 minutes', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

function guestEmailHtml({ name, when, joinLink, meetingName, start, end }) {
  const gcalStamp = (d) => d.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const addGoogle = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
    action: 'TEMPLATE', text: 'AreaConnect demo call', dates: `${gcalStamp(start)}/${gcalStamp(end)}`,
    details: joinLink ? `Join: ${joinLink}` : 'AreaConnect demo', location: joinLink || '',
  });
  const addOutlook = 'https://outlook.live.com/calendar/0/deeplink/compose?' + new URLSearchParams({
    subject: 'AreaConnect demo call', startdt: start.toISOString(), enddt: end.toISOString(),
    body: joinLink ? `Join: ${joinLink}` : 'AreaConnect demo', location: joinLink || '', path: '/calendar/action/compose', rru: 'addevent',
  });
  const btn = (href, label, primary) => `<a href="${esc(href)}" style="display:inline-block;margin:4px 6px 4px 0;padding:11px 20px;border-radius:999px;font-size:14px;font-weight:600;text-decoration:none;${primary ? 'background:#10B981;color:#fff;' : 'background:#F1F5F9;color:#0F172A;'}">${label}</a>`;
  return `
  <div style="background:#F8FAFC;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:20px;overflow:hidden;border:1px solid #E2E8F0;">
      <div style="background:#0F172A;padding:24px 28px;">
        ${brandMark({ dark: true, size: 16 })}
      </div>
      <div style="padding:28px;">
        <h1 style="margin:0 0 8px;font-size:22px;color:#0F172A;">You're booked, ${esc(name.split(' ')[0])}!</h1>
        <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">Thanks for booking a demo. I'll walk you through AreaConnect and answer any questions about your estate.</p>
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:14px;padding:16px 18px;margin-bottom:20px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#10B981;">When</div>
          <div style="font-size:16px;font-weight:700;color:#0F172A;margin-top:4px;">${esc(when)} WAT</div>
          <div style="font-size:13px;color:#64748B;margin-top:2px;">30 minutes · ${esc(meetingName)}</div>
        </div>
        ${joinLink ? btn(joinLink, `Join ${esc(meetingName)}`, true) : '<p style="color:#475569;font-size:14px;">Your meeting link will follow shortly.</p>'}
        <div style="margin-top:8px;">${btn(addGoogle, 'Add to Google Calendar')}${btn(addOutlook, 'Add to Outlook')}</div>
        <p style="margin:24px 0 0;color:#64748B;font-size:13px;line-height:1.6;">A calendar invite is attached. Need to reschedule? Just reply to this email.</p>
        <p style="margin:20px 0 0;color:#0F172A;font-size:14px;">— Michael Orizu<br><span style="color:#64748B;">Founder, AreaConnect</span></p>
      </div>
    </div>
    <p style="text-align:center;font-size:12px;color:#94A3B8;margin-top:16px;">Powered by Area Connector Technologies · RC 9607864</p>
  </div>`;
}

router.get('/slots', async (req, res) => {
  try {
    res.json({ timezone: 'Africa/Lagos', slotMinutes: SLOT_MINUTES, days: await freeSlots() });
  } catch (err) {
    console.error('Demo slots error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Could not load availability. Please try again.' });
  }
});

const bookLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });

router.post('/book', bookLimiter, async (req, res) => {
  const { name, email, company, phone, notes, date, time } = req.body || {};

  if (!name || !email || !date || !time) return res.status(400).json({ error: 'Missing required fields' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: 'Invalid time slot' });

  try {
    // Re-check against live availability so two people can't grab the same slot.
    const days = await freeSlots();
    if (!days[date]?.includes(time)) {
      return res.status(409).json({ error: 'That slot was just taken — please pick another time.' });
    }

    const start = watToDate(date, time);
    const end   = new Date(start.getTime() + SLOT_MINUTES * 60_000);
    const when  = start.toLocaleString('en-GB', {
      timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: true,
    });

    const topic = `AreaConnect demo — ${name}${company ? ` (${company})` : ''}`;
    const details = [
      'A 30-minute walkthrough of the AreaConnect estate management platform.',
      '',
      `Name: ${name}`,
      `Email: ${email}`,
      company ? `Estate / company: ${company}` : null,
      phone ? `Phone: ${phone}` : null,
      notes ? `\nNotes:\n${notes}` : null,
    ].filter(v => v !== null).join('\n');

    // Claim the slot first — the unique index stops two people booking it at once.
    let booking;
    try {
      booking = await DemoBooking.create({ start, end, name, email, company, phone, notes, provider: provider() });
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ error: 'That slot was just taken — please pick another time.' });
      throw e;
    }

    let joinLink = null;
    let startLink = null;
    try {
      if (provider() === 'zoho') {
        const m = await zoho.createMeeting({ start, minutes: SLOT_MINUTES, topic, agenda: details, guestEmail: email });
        joinLink = m.joinLink; startLink = m.startLink;
        Object.assign(booking, { meetingKey: m.key, joinLink, startLink });
      } else if (provider() === 'google') {
        const event = await gcal.createMeetEvent({
          start, end, summary: topic, description: details,
          attendees: [{ email: HOST_EMAIL, responseStatus: 'accepted' }, { email, displayName: name }],
        });
        joinLink = event.meetLink;
        Object.assign(booking, { meetingKey: event.id, joinLink });
      }
      await booking.save();
    } catch (e) {
      // Free the slot again if the meeting couldn't be created.
      await DemoBooking.deleteOne({ _id: booking._id });
      throw e;
    }

    const meetingName = provider() === 'zoho' ? 'Zoho Meeting' : 'Google Meet';

    if (process.env.RESEND_API_KEY) {
      const resend = getResend();
      const row = (k, v) => v ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:130px;">${k}</td><td style="padding:6px 0;font-weight:600;color:#111;">${esc(v)}</td></tr>` : '';
      const ics = icsInvite({ uid: `${booking._id}@areaconnect.pro`, start, end, summary: 'AreaConnect demo call', description: `${details}\n\nJoin: ${joinLink || 'link to follow'}`, location: joinLink || '', organizer: HOST_EMAIL, attendee: { email, name } });

      // To the customer — branded invite from the host, with a calendar file.
      resend.emails.send(withLogo({
        from: `Michael at AreaConnect <${HOST_EMAIL}>`,
        to: email,
        replyTo: HOST_EMAIL,
        subject: `Your AreaConnect demo — ${when} WAT`,
        html: guestEmailHtml({ name, when, joinLink, meetingName, start, end }),
        attachments: [{ filename: 'areaconnect-demo.ics', content: Buffer.from(ics).toString('base64') }],
      })).catch(err => console.error('Demo guest email error:', err));

      // To the host.
      resend.emails.send(withLogo({
        from: FROM(),
        to: HOST_EMAIL,
        replyTo: email,
        subject: `[Demo booked] ${when} — ${name}`,
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#fff;">
            <div style="margin:0 0 22px;">${brandMark({ size: 16 })}</div>
            <h2 style="font-size:20px;font-weight:800;color:#111;margin:0 0 20px;">New demo call booked</h2>
            <table style="width:100%;border-collapse:collapse;">
              ${row('When', `${when} WAT`)}${row('Name', name)}${row('Email', email)}${row('Estate / company', company)}${row('Phone', phone)}
              ${startLink ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Start meeting</td><td style="padding:6px 0;"><a href="${esc(startLink)}" style="color:#10B981;font-weight:600;">Start as host</a></td></tr>` : ''}
              ${joinLink ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">${meetingName}</td><td style="padding:6px 0;"><a href="${esc(joinLink)}" style="color:#10B981;font-weight:600;">${esc(joinLink)}</a></td></tr>` : ''}
            </table>
            ${notes ? `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;"><p style="color:#374151;font-size:14px;line-height:1.7;white-space:pre-wrap;">${esc(notes)}</p>` : ''}
            ${joinLink ? '' : '<p style="color:#b45309;font-size:13px;margin-top:20px;">No meeting provider is connected — send the guest a meeting link manually.</p>'}
          </div>`,
        attachments: [{ filename: 'areaconnect-demo.ics', content: Buffer.from(ics).toString('base64') }],
      })).catch(err => console.error('Demo host email error:', err));
    }

    res.json({ ok: true, start: start.toISOString(), when, meetLink: joinLink, provider: provider(), invited: !!joinLink });
  } catch (err) {
    console.error('Demo booking error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Could not book the call. Please try again.' });
  }
});

module.exports = router;
