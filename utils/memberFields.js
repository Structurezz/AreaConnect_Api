// Sector fields managers can set on a member (resident) account: hotel stay
// dates, shift hours and profile bits (staff ID, title, class). Returns a
// partial update; unknown / invalid values are dropped.
const { validHHMM } = require('./siteClock');

function sectorFields(body = {}) {
  const out = {};
  const err = (message) => { const e = new Error(message); e.status = 400; throw e; };

  if (body.stay && typeof body.stay === 'object') {
    const checkIn = body.stay.checkIn ? new Date(body.stay.checkIn) : null;
    const checkOut = body.stay.checkOut ? new Date(body.stay.checkOut) : null;
    if (checkIn && isNaN(checkIn)) err('Check-in date is not valid');
    if (checkOut && isNaN(checkOut)) err('Check-out date is not valid');
    if (checkIn && checkOut && checkOut <= checkIn) err('Check-out must be after check-in');
    if (checkIn || checkOut) {
      const now = new Date();
      out['stay.checkIn'] = checkIn;
      out['stay.checkOut'] = checkOut;
      out['stay.status'] = checkOut && checkOut <= now ? 'checked_out' : checkIn && checkIn > now ? 'upcoming' : 'in_house';
    }
  }

  if (body.shift && typeof body.shift === 'object') {
    const { start = '', end = '' } = body.shift;
    if ((start || end) && !(validHHMM(start) && validHHMM(end))) err('Shift times must be HH:MM');
    out['shift.start'] = start;
    out['shift.end'] = end;
    out['shift.days'] = [...new Set((Array.isArray(body.shift.days) ? body.shift.days : []).map(Number).filter(d => d >= 0 && d <= 6))].sort();
  }

  if (body.memberProfile && typeof body.memberProfile === 'object') {
    for (const k of ['idNumber', 'title', 'className']) {
      if (typeof body.memberProfile[k] === 'string') out[`memberProfile.${k}`] = body.memberProfile[k].trim().slice(0, 80);
    }
  }
  return out;
}

module.exports = { sectorFields };
