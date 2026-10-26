// Thin wrapper around the Google Geocoding API.
// Returns null on any failure so callers can degrade gracefully.

// Results this coarse would drop the pin in the middle of the country/state — treat as "not found"
const TOO_VAGUE = new Set(['country', 'administrative_area_level_1']);

async function lookup(query, key, region, country) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=${region}&components=country:${country}&key=${key}`;
  const json = await fetch(url).then((r) => r.json());
  if (json.status !== 'OK' || !json.results?.length) {
    if (json.status && json.status !== 'ZERO_RESULTS') console.warn('geocoding:', json.status, json.error_message || '');
    return null;
  }
  const top = json.results[0];
  if ((top.types || []).every((t) => TOO_VAGUE.has(t) || t === 'political')) return null;
  return {
    lat: top.geometry.location.lat,
    lng: top.geometry.location.lng,
    formattedAddress: top.formatted_address || query,
    placeId: top.place_id || '',
  };
}

// hint: { city, state } from the estate profile — appended when the address alone doesn't resolve
async function geocodeAddress(address, hint = {}) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || !address) return null;

  // Bias results to Nigeria (override with GEOCODING_REGION env if you serve other countries).
  const region  = process.env.GEOCODING_REGION  || 'ng';
  const country = process.env.GEOCODING_COUNTRY || 'NG';
  const extra = [hint.city, hint.state].filter((p) => p && !address.toLowerCase().includes(String(p).toLowerCase()));
  const queries = [...new Set([
    extra.length ? `${address}, ${extra.join(', ')}` : null,
    address,
  ].filter(Boolean))];
  try {
    for (const q of queries) {
      const geo = await lookup(q, key, region, country);
      if (geo) return geo;
    }
    return null;
  } catch (err) {
    console.error('geocodeAddress error:', err.message);
    return null;
  }
}

module.exports = { geocodeAddress };
