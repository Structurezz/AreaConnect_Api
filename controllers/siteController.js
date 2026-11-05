// Site type settings and the sector features built on them: hotel stays and
// the room board, staff shifts and the gate's staff check.
const User = require('../models/User');
const Unit = require('../models/Unit');
const Estate = require('../models/Estate');
const siteTypes = require('../utils/siteTypes');
const { shiftState, validHHMM } = require('../utils/siteClock');
const { stayState, checkOutGuest } = require('../utils/stays');
const { sectorFields } = require('../utils/memberFields');
const { roleFields } = require('../utils/roleFields');
const { emitNotification } = require('../services/socketService');

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });

// GET /api/site — resolved config for the signed-in user's site
exports.getSite = async (req, res) => {
  try {
    const estate = await Estate.findById(req.estateId).select('name site').lean();
    if (!estate) return fail(res, 404, 'Site not found');
    const data = { name: estate.name, ...siteTypes.siteConfig(estate) };
    if (['estate_manager', 'super_admin'].includes(req.user.role)) {
      data.catalog = {
        types: siteTypes.TYPES.map(t => ({ key: t, terms: siteTypes.TERMS[t], modules: siteTypes.DEFAULT_MODULES[t] })),
        modules: siteTypes.MODULES,
      };
      data.overrides = estate.site?.modules || {};
    }
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[getSite]', err);
    return fail(res, 500, 'Server error');
  }
};

// PATCH /api/site — manager: { type?, modules?: {key: bool|null}, inductionText?, visitingHours? }
// Changing the type resets module overrides unless modules are sent too.
exports.updateSite = async (req, res) => {
  try {
    const estate = await Estate.findById(req.estateId);
    if (!estate) return fail(res, 404, 'Site not found');
    const { type, modules, inductionText, visitingHours } = req.body;
    if (!estate.site) estate.site = {};

    if (type !== undefined) {
      if (!siteTypes.TYPES.includes(type)) return fail(res, 400, 'Unknown site type');
      if (type !== estate.site.type) estate.site.modules = {};
      estate.site.type = type;
    }
    if (modules && typeof modules === 'object') {
      const next = { ...(estate.site.modules || {}) };
      for (const [k, v] of Object.entries(modules)) {
        if (!siteTypes.MODULES[k]) continue;
        if (v === null) delete next[k];
        else next[k] = !!v;
      }
      // Store only real overrides of the type's defaults
      const defaults = siteTypes.DEFAULT_MODULES[siteTypes.normType(estate.site.type)];
      for (const k of Object.keys(next)) if (next[k] === defaults[k]) delete next[k];
      estate.site.modules = next;
      estate.markModified('site.modules');
    }
    if (typeof inductionText === 'string') estate.site.inductionText = inductionText.trim().slice(0, 4000);
    if (visitingHours && typeof visitingHours === 'object') {
      const { start, end, maxPerPatient } = visitingHours;
      if (start !== undefined && !validHHMM(start)) return fail(res, 400, 'Visiting hours must be HH:MM');
      if (end !== undefined && !validHHMM(end)) return fail(res, 400, 'Visiting hours must be HH:MM');
      if (start !== undefined) estate.site.visitingHours.start = start;
      if (end !== undefined) estate.site.visitingHours.end = end;
      if (maxPerPatient !== undefined) estate.site.visitingHours.maxPerPatient = Math.max(0, Math.min(50, Number(maxPerPatient) || 0));
    }
    await estate.save();
    siteTypes.invalidate(estate._id);
    try {
      require('../services/socketService').getIO?.()?.to(`estate:${estate._id}`).emit('site_update', siteTypes.siteConfig(estate));
    } catch {}
    return res.json({ success: true, message: 'Site settings saved', data: { name: estate.name, ...siteTypes.siteConfig(estate), overrides: estate.site.modules || {} } });
  } catch (err) {
    console.error('[updateSite]', err);
    return fail(res, 500, 'Server error');
  }
};

// PATCH /api/site/members/:id — manager: stay dates, shift, profile
exports.updateMember = async (req, res) => {
  try {
    let update;
    try { update = { ...sectorFields(req.body), ...(await roleFields(req.body, req.estateId)) }; } catch (e) { return fail(res, e.status || 400, e.message); }
    if (!Object.keys(update).length) return fail(res, 400, 'Nothing to update');
    const member = await User.findOne({ _id: req.params.id, estateId: req.estateId, role: { $in: ['resident', 'security', 'estate_manager'] } });
    if (!member) return fail(res, 404, 'Member not found');
    // A reopened stay (e.g. extended before the sweeper ran) brings the guest back
    if (update['stay.status'] && update['stay.status'] !== 'checked_out' && member.stay?.status === 'checked_out') {
      return fail(res, 409, 'This guest has checked out. Check them in again as a new stay.');
    }
    await User.updateOne({ _id: member._id }, { $set: update });
    // Party members share the head's stay dates
    if (member.householdRole !== 'member' && Object.keys(update).some(k => k.startsWith('stay.'))) {
      const stay = Object.fromEntries(Object.entries(update).filter(([k]) => k.startsWith('stay.')));
      await User.updateMany({ householdHead: member._id, householdRole: 'member' }, { $set: stay });
    }
    const fresh = await User.findById(member._id).select('name stay shift memberProfile siteRole roleInfo assignedTo').populate('assignedTo', 'name siteRole roleInfo profilePhoto').lean();
    return res.json({ success: true, message: 'Saved', data: fresh });
  } catch (err) {
    console.error('[updateMember]', err);
    return fail(res, 500, 'Server error');
  }
};

// POST /api/site/stays/:id/checkout — manager checks a guest out now
exports.checkOut = async (req, res) => {
  try {
    const guest = await User.findOne({ _id: req.params.id, estateId: req.estateId, role: 'resident' });
    if (!guest) return fail(res, 404, 'Guest not found');
    const headId = guest.householdRole === 'member' ? guest.householdHead : guest._id;
    await checkOutGuest(headId, { by: req.user._id });
    try {
      require('../services/socketService').getIO?.()?.to(`user:${headId}`).emit('stay_ended', { userId: String(headId) });
    } catch {}
    emitNotification(req.estateId, { type: 'stay_checkout', title: 'Guest checked out', body: `${guest.name} has checked out.`, meta: { userId: headId } });
    return res.json({ success: true, message: `${guest.name} checked out` });
  } catch (err) {
    console.error('[stay checkout]', err);
    return fail(res, 500, 'Server error');
  }
};

// GET /api/site/rooms — room board: every unit with who's in it and their stay
exports.roomBoard = async (req, res) => {
  try {
    const units = await Unit.find({ estateId: req.estateId }).select('unitNumber block type status residentIds').sort({ block: 1, unitNumber: 1 }).lean();
    const ids = units.flatMap(u => u.residentIds || []);
    const people = await User.find({ _id: { $in: ids }, role: 'resident', householdRole: { $ne: 'member' } })
      .select('name phone email profilePhoto stay isActive householdRole').lean();
    const byId = new Map(people.map(p => [String(p._id), p]));
    const now = new Date();
    const soon = new Date(now.getTime() + 24 * 3600 * 1000);
    let occupied = 0, arriving = 0, departing = 0;
    const rows = units.map(u => {
      const guests = (u.residentIds || []).map(id => byId.get(String(id))).filter(Boolean).map(g => ({
        _id: g._id, name: g.name, phone: g.phone, email: g.email, profilePhoto: g.profilePhoto,
        stay: g.stay, state: stayState(g, now),
      }));
      const inHouse = guests.filter(g => g.state === 'in_house' || g.state === 'none');
      const state = inHouse.length ? 'occupied' : guests.some(g => g.state === 'upcoming') ? 'reserved' : 'vacant';
      if (state === 'occupied') occupied++;
      if (guests.some(g => g.state === 'upcoming' && g.stay?.checkIn && new Date(g.stay.checkIn) <= soon)) arriving++;
      if (inHouse.some(g => g.stay?.checkOut && new Date(g.stay.checkOut) <= soon)) departing++;
      return { _id: u._id, unitNumber: u.unitNumber, block: u.block, type: u.type, state, guests };
    });
    return res.json({ success: true, data: rows, summary: { total: units.length, occupied, vacant: rows.filter(r => r.state === 'vacant').length, reserved: rows.filter(r => r.state === 'reserved').length, arriving, departing } });
  } catch (err) {
    console.error('[roomBoard]', err);
    return fail(res, 500, 'Server error');
  }
};

// GET /api/site/staff-check?q= — gate: find a member and see if they're on shift
exports.staffCheck = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ success: true, data: [] });
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const people = await User.find({
      estateId: req.estateId, role: { $in: ['resident', 'estate_manager'] }, householdStatus: { $ne: 'pending' },
      $or: [{ name: rx }, { phone: rx }, { email: rx }, { 'memberProfile.idNumber': rx }],
    }).select('name phone profilePhoto unitId shift memberProfile isActive stay householdRole siteRole roleInfo').populate('unitId', 'unitNumber block').limit(12).lean();
    const type = (await siteTypes.siteFor(req.estateId))?.site?.type;
    const { roleDef } = require('../utils/siteRoles');
    const now = new Date();
    const data = people.map(p => ({
      _id: p._id, name: p.name, phone: p.phone, profilePhoto: p.profilePhoto, isActive: p.isActive,
      unit: p.unitId ? [p.unitId.block, p.unitId.unitNumber].filter(Boolean).join(' · ') : '',
      memberProfile: p.memberProfile || {}, shift: shiftState(p.shift, now),
      role: roleDef(type, p.siteRole).key, roleLabel: roleDef(type, p.siteRole).label, staff: roleDef(type, p.siteRole).staff,
      specialty: p.roleInfo?.specialty || '', onCall: !!p.roleInfo?.onCall,
      stay: p.stay?.checkIn || p.stay?.checkOut ? { ...p.stay, state: stayState(p, now) } : null,
    }));
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[staffCheck]', err);
    return fail(res, 500, 'Server error');
  }
};
