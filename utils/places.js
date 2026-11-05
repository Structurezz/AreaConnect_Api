// Helpers for site places (models/SitePlace): find a unit's place and build
// Google Maps links (no API key needed for links).
const SitePlace = require('../models/SitePlace');
const Unit = require('../models/Unit');

const directionsUrl = (p) => p && typeof p.lat === 'number'
  ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}${p.googlePlaceId ? `&destination_place_id=${encodeURIComponent(p.googlePlaceId)}` : ''}`
  : '';

// The place for a unit: explicit unit.placeId, else a place whose block matches.
async function placeForUnit(unitOrId) {
  if (!unitOrId) return null;
  const unit = unitOrId.estateId ? unitOrId : await Unit.findById(unitOrId).select('estateId block placeId').lean();
  if (!unit) return null;
  if (unit.placeId) {
    const p = await SitePlace.findById(unit.placeId).lean();
    if (p) return p;
  }
  if (unit.block) {
    const rx = new RegExp(`^${String(unit.block).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    return SitePlace.findOne({ estateId: unit.estateId, block: rx }).lean();
  }
  return null;
}

const publicPlace = (p) => p && ({ _id: p._id, name: p.name, kind: p.kind, lat: p.lat, lng: p.lng, address: p.address, directionsUrl: directionsUrl(p) });

module.exports = { directionsUrl, placeForUnit, publicPlace };
