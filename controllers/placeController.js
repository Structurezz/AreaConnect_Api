// Site places on Google Maps: halls / hostels, buildings, gates, clinic…
const SitePlace = require('../models/SitePlace');
const Unit = require('../models/Unit');
const Estate = require('../models/Estate');
const { directionsUrl, placeForUnit, publicPlace } = require('../utils/places');

const isManager = (u) => ['estate_manager', 'super_admin'].includes(u.role);
const FIELDS = ['name', 'kind', 'block', 'description', 'googlePlaceId', 'address', 'isPublic'];

function read(body) {
  const out = {};
  for (const f of FIELDS) if (body[f] !== undefined) out[f] = f === 'isPublic' ? !!body[f] : String(body[f]).trim();
  if (out.kind && !SitePlace.KINDS.includes(out.kind)) out.kind = 'other';
  for (const k of ['lat', 'lng']) {
    if (body[k] !== undefined) {
      const n = Number(body[k]);
      if (!Number.isFinite(n)) { const e = new Error('Pick the place on the map'); e.status = 400; throw e; }
      out[k] = n;
    }
  }
  return out;
}

// GET /api/site/places → { places, center, myPlace }
exports.list = async (req, res) => {
  try {
    const filter = { estateId: req.estateId };
    if (!isManager(req.user) && req.user.role !== 'security') filter.isPublic = true;
    const [places, estate, unitCounts] = await Promise.all([
      SitePlace.find(filter).sort({ kind: 1, name: 1 }).lean(),
      Estate.findById(req.estateId).select('name address location').lean(),
      isManager(req.user)
        ? Unit.aggregate([{ $match: { estateId: req.estateId } }, { $group: { _id: { placeId: '$placeId', block: { $toLower: '$block' } }, units: { $sum: 1 }, occupied: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$residentIds', []] } }, 0] }, 1, 0] } }, people: { $sum: { $size: { $ifNull: ['$residentIds', []] } } } } }])
        : [],
    ]);
    // Occupancy per place (manager): explicit placeId first, else block name
    const stats = (p) => {
      const rows = unitCounts.filter(r => (r._id.placeId && String(r._id.placeId) === String(p._id)) || (!r._id.placeId && p.block && r._id.block === p.block.toLowerCase()));
      if (!rows.length) return undefined;
      return rows.reduce((a, r) => ({ units: a.units + r.units, occupied: a.occupied + r.occupied, people: a.people + r.people }), { units: 0, occupied: 0, people: 0 });
    };
    let myPlace = null;
    if (req.user.unitId) myPlace = publicPlace(await placeForUnit(req.user.unitId));
    return res.json({
      success: true,
      data: places.map(p => ({ ...p, directionsUrl: directionsUrl(p), ...(isManager(req.user) && { stats: stats(p) }) })),
      center: estate?.location?.lat ? { lat: estate.location.lat, lng: estate.location.lng } : null,
      site: { name: estate?.name, address: estate?.address },
      myPlace,
      kinds: SitePlace.KINDS,
    });
  } catch (err) {
    console.error('[places list]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/site/places
exports.create = async (req, res) => {
  try {
    const data = read(req.body);
    if (!data.name) return res.status(400).json({ success: false, message: 'Give the place a name' });
    if (data.lat === undefined || data.lng === undefined) return res.status(400).json({ success: false, message: 'Pick the place on the map' });
    const place = await SitePlace.create({ ...data, estateId: req.estateId, createdBy: req.user._id });
    return res.status(201).json({ success: true, message: 'Place added', data: { ...place.toObject(), directionsUrl: directionsUrl(place) } });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    console.error('[places create]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PATCH /api/site/places/:id
exports.update = async (req, res) => {
  try {
    const data = read(req.body);
    const place = await SitePlace.findOneAndUpdate({ _id: req.params.id, estateId: req.estateId }, { $set: data }, { new: true, runValidators: true });
    if (!place) return res.status(404).json({ success: false, message: 'Place not found' });
    return res.json({ success: true, message: 'Place saved', data: { ...place.toObject(), directionsUrl: directionsUrl(place) } });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    console.error('[places update]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// DELETE /api/site/places/:id — units pointing at it fall back to block matching
exports.remove = async (req, res) => {
  try {
    const place = await SitePlace.findOneAndDelete({ _id: req.params.id, estateId: req.estateId });
    if (!place) return res.status(404).json({ success: false, message: 'Place not found' });
    await Unit.updateMany({ estateId: req.estateId, placeId: place._id }, { $set: { placeId: null } });
    return res.json({ success: true, message: 'Place removed' });
  } catch (err) {
    console.error('[places remove]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PATCH /api/site/places/:id/units { unitIds: [...] } — link units to a place
// (or { block } to link every unit in that block).
exports.linkUnits = async (req, res) => {
  try {
    const place = await SitePlace.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!place) return res.status(404).json({ success: false, message: 'Place not found' });
    let filter;
    if (Array.isArray(req.body.unitIds)) filter = { _id: { $in: req.body.unitIds }, estateId: req.estateId };
    else if (req.body.block) filter = { estateId: req.estateId, block: req.body.block };
    else return res.status(400).json({ success: false, message: 'Choose the units' });
    const r = await Unit.updateMany(filter, { $set: { placeId: place._id } });
    return res.json({ success: true, message: `${r.modifiedCount} linked to ${place.name}`, modified: r.modifiedCount });
  } catch (err) {
    console.error('[places link]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
