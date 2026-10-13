require('dotenv').config();
const mongoose = require('mongoose');
const Estate = require('../models/Estate');
const { geocodeAddress } = require('../services/geocoding');

const FORCE = process.argv.includes('--force');
const SLEEP_MS = 250; // stay well under Google's 50 req/sec limit

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.error('✗ GOOGLE_MAPS_API_KEY not set in environment');
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.error('✗ MONGODB_URI not set in environment');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');
  console.log(FORCE ? 'Mode: FORCE (re-geocode every estate)' : 'Mode: fill-in-missing only (use --force to re-geocode all)');

  const query = FORCE
    ? { address: { $exists: true, $ne: '' } }
    : { address: { $exists: true, $ne: '' }, $or: [
        { 'location.lat': { $exists: false } },
        { 'location.lat': null },
      ] };

  const estates = await Estate.find(query).select('_id name address location');
  console.log(`Found ${estates.length} estate(s) to geocode`);

  let ok = 0, skipped = 0, failed = 0;
  for (const e of estates) {
    process.stdout.write(`  · ${e.name || e._id.toString()} — "${e.address}" … `);
    const geo = await geocodeAddress(e.address);
    if (!geo) { console.log('FAILED'); failed++; await sleep(SLEEP_MS); continue; }

    e.location = { ...geo, geocodedAt: new Date() };
    await e.save();
    console.log(`ok (${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)})`);
    ok++;
    await sleep(SLEEP_MS);
  }

  console.log('');
  console.log(`Done. Geocoded ${ok}, failed ${failed}, skipped ${skipped}.`);
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Script error:', err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
