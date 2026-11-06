// Visitor passes are valid from expectedDate for expectedDuration minutes
// (12h when unset). Once that window closes an unused pass is expired — the
// gate must refuse it and lists must stop showing it as valid.
const Visitor = require('../models/Visitor');

const DEFAULT_DURATION_MIN = 720;
const OPEN = ['active', 'pending']; // unused passes; checked-in visitors are left alone

const passExpiresAt = (v) => {
  const start = v?.expectedDate ? new Date(v.expectedDate) : null;
  if (!start || isNaN(start)) return null;
  return new Date(start.getTime() + (Number(v.expectedDuration) || DEFAULT_DURATION_MIN) * 60000);
};

const isPastExpiry = (v, now = new Date()) => {
  if (!OPEN.includes(v?.status)) return false;
  const end = passExpiresAt(v);
  return !!end && now > end;
};

// Mongo filter: open passes whose window has closed
const overdueFilter = (extra = {}, now = new Date()) => ({
  ...extra,
  status: { $in: OPEN },
  // Narrows the scan to the {status, expectedDate} index (duration is never negative)
  expectedDate: { $lt: now },
  $expr: {
    $lt: [
      { $add: ['$expectedDate', { $multiply: [{ $ifNull: ['$expectedDuration', DEFAULT_DURATION_MIN] }, 60000] }] },
      now,
    ],
  },
});

// Mark overdue passes expired; returns the expired docs (for socket updates)
async function expireOverdue(extra = {}, { limit = 500 } = {}) {
  const docs = await Visitor.find(overdueFilter(extra)).select('_id estateId').limit(limit).lean();
  if (!docs.length) return [];
  await Visitor.updateMany({ _id: { $in: docs.map(d => d._id) }, status: { $in: OPEN } }, { $set: { status: 'expired', awaitingApproval: false } });
  return docs;
}

// Every few minutes: expire passes everywhere and tell the gates
function startPassExpirySweeper(intervalMs = 5 * 60 * 1000) {
  const { emitVisitorUpdate } = require('../services/socketService');
  const run = async () => {
    try {
      const docs = await expireOverdue({}, { limit: 2000 });
      if (!docs.length) return;
      const full = await Visitor.find({ _id: { $in: docs.map(d => d._id) } }).lean();
      full.forEach(v => emitVisitorUpdate(String(v.estateId), v));
      console.log(`[pass expiry] expired ${docs.length} pass(es)`);
    } catch (e) { console.error('[pass expiry]', e.message); }
  };
  run();
  return setInterval(run, intervalMs);
}

module.exports = { passExpiresAt, isPastExpiry, overdueFilter, expireOverdue, startPassExpirySweeper, DEFAULT_DURATION_MIN };
