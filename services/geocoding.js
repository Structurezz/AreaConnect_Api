// Thin wrapper around the Google Geocoding API.
// Returns null on any failure so callers can degrade gracefully.

async function geocodeAddress(address) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || !address) return null;

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (json.status !== 'OK' || !json.results?.length) {
      if (json.status && json.status !== 'ZERO_RESULTS') {
        console.warn('geocoding:', json.status, json.error_message || '');
      }
      return null;
    }
    const top = json.results[0];
    return {
      lat: top.geometry.location.lat,
      lng: top.geometry.location.lng,
      formattedAddress: top.formatted_address || address,
      placeId: top.place_id || '',
    };
  } catch (err) {
    console.error('geocodeAddress error:', err.message);
    return null;
  }
}

module.exports = { geocodeAddress };
