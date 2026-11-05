// Local wall-clock helpers for site rules (visiting hours, shifts). Sites are
// in Nigeria today; SITE_TZ overrides it.
const TZ = process.env.SITE_TZ || 'Africa/Lagos';

function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(date);
  const get = (t) => parts.find(p => p.type === t)?.value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const minutes = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
  return { day, minutes };
}

const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const validHHMM = (v) => toMin(v) !== null && toMin(v) < 24 * 60;

// Is `minutes` within start–end? Handles windows past midnight (22:00–06:00).
function inWindow(start, end, minutes) {
  const a = toMin(start), b = toMin(end);
  if (a === null || b === null) return true;
  if (a === b) return true;
  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

// Shift check for a user's shift { start, end, days }. null = no shift set.
function shiftState(shift, date = new Date()) {
  if (!shift || !validHHMM(shift.start) || !validHHMM(shift.end)) return null;
  const { day, minutes } = localParts(date);
  const a = toMin(shift.start), b = toMin(shift.end);
  // An overnight shift that started yesterday counts against yesterday's day.
  const shiftDay = a > b && minutes < b ? (day + 6) % 7 : day;
  const dayOk = !shift.days?.length || shift.days.includes(shiftDay);
  return { onShift: dayOk && inWindow(shift.start, shift.end, minutes), start: shift.start, end: shift.end, days: shift.days || [] };
}

function withinVisitingHours(vh, date = new Date()) {
  return inWindow(vh?.start || '10:00', vh?.end || '20:00', localParts(date).minutes);
}

module.exports = { TZ, localParts, toMin, validHHMM, inWindow, shiftState, withinVisitingHours };
