// Hotel guest stays (site module 'stays'). A guest can use the apps from
// stay.checkIn until stay.checkOut. At check-out the guest (and their party)
// are signed out, their room freed and their open visitor passes cancelled.
const User = require('../models/User');
const Unit = require('../models/Unit');
const Visitor = require('../models/Visitor');

const hasStay = (u) => !!(u?.stay?.checkIn || u?.stay?.checkOut);

function stayState(u, now = new Date()) {
  if (!hasStay(u)) return 'none';
  if (u.stay.status === 'checked_out') return 'checked_out';
  if (u.stay.checkOut && now >= new Date(u.stay.checkOut)) return 'checked_out';
  if (u.stay.checkIn && now < new Date(u.stay.checkIn)) return 'upcoming';
  return 'in_house';
}

const fmt = (d) => new Date(d).toLocaleString('en-GB', { timeZone: process.env.SITE_TZ || 'Africa/Lagos', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// null when access is fine, otherwise { status, code, message }.
function stayBlock(u, now = new Date()) {
  const s = stayState(u, now);
  if (s === 'upcoming') return { status: 403, code: 'STAY_NOT_STARTED', message: `Your stay starts ${fmt(u.stay.checkIn)}. You can sign in from then.` };
  if (s === 'checked_out') return { status: 401, code: 'STAY_ENDED', message: 'Your stay has ended. Thank you for staying with us.' };
  return null;
}

// Check a guest (the party head) out: party members go with them.
async function checkOutGuest(guestId, { by = null } = {}) {
  const guest = await User.findById(guestId);
  if (!guest) return null;
  const party = await User.find({ householdHead: guest._id, householdRole: 'member' }).select('_id');
  const ids = [guest._id, ...party.map(p => p._id)];
  const roomId = guest.unitId || guest.stay?.roomId || null;
  await User.updateMany({ _id: { $in: ids } }, {
    $set: { 'stay.status': 'checked_out', 'stay.roomId': roomId, 'stay.checkOut': guest.stay?.checkOut && guest.stay.checkOut < new Date() ? guest.stay.checkOut : new Date(), unitId: null, isActive: false, refreshToken: null },
  });
  if (roomId) {
    const room = await Unit.findByIdAndUpdate(roomId, { $pull: { residentIds: { $in: ids } } }, { new: true });
    if (room && !room.residentIds.length) { room.status = 'vacant'; await room.save(); }
  }
  await Visitor.updateMany(
    { hostResidentId: { $in: ids }, status: { $in: ['active', 'pending'] } },
    { $set: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: by, awaitingApproval: false } },
  );
  return guest;
}

// Every few minutes: check out guests whose check-out time has passed.
function startStaySweeper(intervalMs = 5 * 60 * 1000) {
  const run = async () => {
    try {
      const due = await User.find({
        role: 'resident', householdRole: { $ne: 'member' },
        'stay.status': { $in: ['upcoming', 'in_house'] }, 'stay.checkOut': { $lte: new Date() },
      }).select('_id').limit(500).lean();
      for (const g of due) await checkOutGuest(g._id);
      // Upcoming guests whose check-in has arrived
      await User.updateMany({ 'stay.status': 'upcoming', 'stay.checkIn': { $lte: new Date() } }, { $set: { 'stay.status': 'in_house' } });
      if (due.length) console.log(`[stays] checked out ${due.length} guest(s)`);
    } catch (e) { console.error('[stays]', e.message); }
  };
  run();
  return setInterval(run, intervalMs);
}

module.exports = { hasStay, stayState, stayBlock, checkOutGuest, startStaySweeper };
