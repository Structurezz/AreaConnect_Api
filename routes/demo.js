// Landing-page "Book a demo" — 30-min Google Meet calls with the AreaConnect team.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { Resend } = require('resend');
const gcal = require('../services/googleCalendarService');

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

async function freeSlots() {
  const days = candidateSlots();
  const keys = Object.keys(days);
  if (!keys.length || !gcal.isConfigured()) return days;

  const busy = await gcal.getBusy(watToDate(keys[0], '00:00'), watToDate(keys[keys.length - 1], '23:59'));
  for (const day of keys) {
    days[day] = days[day].filter(hhmm => {
      const start = watToDate(day, hhmm);
      return !overlaps(start, new Date(start.getTime() + SLOT_MINUTES * 60_000), busy);
    });
    if (!days[day].length) delete days[day];
  }
  return days;
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

    let meetLink = null;
    if (gcal.isConfigured()) {
      const event = await gcal.createMeetEvent({
        start, end,
        summary: `AreaConnect demo — ${name}${company ? ` (${company})` : ''}`,
        description: [
          'A 30-minute walkthrough of the AreaConnect estate management platform.',
          '',
          `Name: ${name}`,
          `Email: ${email}`,
          company ? `Estate / company: ${company}` : null,
          phone ? `Phone: ${phone}` : null,
          notes ? `\nNotes:\n${notes}` : null,
        ].filter(v => v !== null).join('\n'),
        attendees: [{ email: HOST_EMAIL, organizer: true, responseStatus: 'accepted' }, { email, displayName: name }],
      });
      meetLink = event.meetLink;
    }

    if (process.env.RESEND_API_KEY) {
      const row = (k, v) => v ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:130px;">${k}</td><td style="padding:6px 0;font-weight:600;color:#111;">${esc(v)}</td></tr>` : '';
      getResend().emails.send({
        from: FROM(),
        to: HOST_EMAIL,
        replyTo: email,
        subject: `[Demo booked] ${when} — ${name}`,
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#fff;">
            <h2 style="font-size:20px;font-weight:800;color:#111;margin:0 0 20px;">New demo call booked</h2>
            <table style="width:100%;border-collapse:collapse;">
              ${row('When', `${when} WAT`)}${row('Name', name)}${row('Email', email)}${row('Estate / company', company)}${row('Phone', phone)}
              ${meetLink ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Google Meet</td><td style="padding:6px 0;"><a href="${esc(meetLink)}" style="color:#10B981;font-weight:600;">${esc(meetLink)}</a></td></tr>` : ''}
            </table>
            ${notes ? `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;"><p style="color:#374151;font-size:14px;line-height:1.7;white-space:pre-wrap;">${esc(notes)}</p>` : ''}
            ${meetLink ? '' : '<p style="color:#b45309;font-size:13px;margin-top:20px;">Google Calendar isn\'t connected — send the guest a Meet invite manually.</p>'}
          </div>`,
      }).catch(err => console.error('Demo host email error:', err));
    }

    res.json({ ok: true, start: start.toISOString(), when, meetLink, invited: gcal.isConfigured() });
  } catch (err) {
    console.error('Demo booking error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Could not book the call. Please try again.' });
  }
});

module.exports = router;
