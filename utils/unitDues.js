const Payment = require('../models/Payment');

// Real dues position for each unit, worked out from its current residents'
// payment records. Replaces the old manual `unit.duesStatus` field, which
// defaulted to 'paid' and was never updated by the payments system — so
// every unit showed "Dues paid" regardless of what anyone actually owed.
//
// Bills are issued per resident (one Payment per resident per schedule), so a
// unit's figures are the sum across the residents living in it now.
//
// status:
//   exempt       — manager marked the unit exempt (manual override, kept)
//   no_residents — nobody assigned, so nothing can be billed
//   no_bills     — residents, but no bills have been issued to them yet
//   overdue      — at least one unpaid bill is past its due date
//   owing        — unpaid bills, none overdue yet
//   clear        — every bill issued so far is paid or waived
async function computeUnitDues(units, estateId) {
  const residentToUnit = new Map();
  for (const u of units) {
    for (const r of u.residentIds || []) {
      const id = String(r?._id || r);
      if (id) residentToUnit.set(id, String(u._id));
    }
  }

  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const payments = residentToUnit.size
    ? await Payment.find({
        estateId,
        residentId: { $in: [...residentToUnit.keys()] },
        status: { $in: ['pending', 'overdue', 'paid', 'waived'] },
      })
        .select('residentId amount status paidAt scheduleId')
        .populate('scheduleId', 'title dueDate')
        .lean()
    : [];

  const byUnit = new Map();
  const blank = () => ({
    outstanding: 0, overdueAmount: 0, overdueCount: 0, owingCount: 0,
    paidThisYear: 0, paidCount: 0, billsIssued: 0, lastPaidAt: null, nextDue: null,
  });

  for (const p of payments) {
    const unitId = residentToUnit.get(String(p.residentId));
    if (!unitId) continue;
    const d = byUnit.get(unitId) || blank();
    byUnit.set(unitId, d);
    d.billsIssued += 1;

    if (p.status === 'paid') {
      d.paidCount += 1;
      if (p.paidAt && new Date(p.paidAt) >= yearStart) d.paidThisYear += p.amount;
      if (p.paidAt && (!d.lastPaidAt || new Date(p.paidAt) > new Date(d.lastPaidAt))) d.lastPaidAt = p.paidAt;
      continue;
    }
    if (p.status === 'waived') continue;

    // Unpaid. "Overdue" if flagged, or simply past the bill's due date — the
    // status flag isn't always flipped on time.
    const dueDate = p.scheduleId?.dueDate ? new Date(p.scheduleId.dueDate) : null;
    const isOverdue = p.status === 'overdue' || (dueDate && dueDate < now);
    d.outstanding += p.amount;
    if (isOverdue) { d.overdueAmount += p.amount; d.overdueCount += 1; }
    else d.owingCount += 1;
    if (dueDate && (!d.nextDue || dueDate < new Date(d.nextDue.dueDate))) {
      d.nextDue = { title: p.scheduleId?.title || 'Bill', dueDate, amount: p.amount };
    }
  }

  const result = new Map();
  for (const u of units) {
    const id = String(u._id);
    const d = byUnit.get(id) || blank();
    const residents = (u.residentIds || []).length;
    let status;
    if (u.duesStatus === 'exempt') status = 'exempt';
    else if (!residents) status = 'no_residents';
    else if (!d.billsIssued) status = 'no_bills';
    else if (d.overdueCount) status = 'overdue';
    else if (d.outstanding > 0) status = 'owing';
    else status = 'clear';
    result.set(id, { status, ...d });
  }
  return result;
}

// Convenience: returns plain unit objects with a `dues` field attached.
async function withUnitDues(units, estateId) {
  const dues = await computeUnitDues(units, estateId);
  return units.map((u) => {
    const obj = typeof u.toObject === 'function' ? u.toObject() : u;
    return { ...obj, dues: dues.get(String(obj._id)) };
  });
}

module.exports = { computeUnitDues, withUnitDues };
