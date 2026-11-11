// Cover photos for blog articles. Gemini suggests a stock-photo search, a
// free stock library finds a matching landscape photo, and the image is
// downloaded into GridFS (bucket "uploads", served by /files/:id) like every
// other image in the system. Each article stores the /files URL plus the
// photographer credit.
// Providers: Pixabay (PIXABAY_API_KEY — preferred; its terms ask you to store
// images on your own server) or Pexels (PEXELS_API_KEY). Without either,
// articles keep the landing page's fallback cover.
const axios = require('axios');
const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const provider = () => (process.env.PIXABAY_API_KEY ? 'pixabay' : process.env.PEXELS_API_KEY ? 'pexels' : null);
const isConfigured = () => !!provider();
const SECTOR_HINT = {
  estate: 'gated residential estate', university: 'university campus', school: 'school',
  hotel: 'hotel', industrial: 'factory or office', hospital: 'hospital',
};
// Safe, on-topic searches tried when the article-specific ones find nothing that fits
const SECTOR_FALLBACK = {
  estate: ['security guard gate', 'modern residential estate', 'apartment building entrance'],
  university: ['university campus students', 'students walking campus', 'university building'],
  school: ['school building entrance', 'students classroom teacher', 'parents children school'],
  hotel: ['hotel reception desk', 'hotel lobby', 'hotel room'],
  industrial: ['factory workers safety helmet', 'warehouse workers', 'modern office reception'],
  hospital: ['hospital corridor', 'hospital reception', 'doctor nurse hospital'],
};

/** 2–5 word stock-photo search that fits the article (no people's names, no text). */
async function imageQuery({ title, excerpt, sector = 'estate' }) {
  const fallback = `${SECTOR_HINT[sector] || ''} security`.trim();
  if (!process.env.GEMINI_API_KEY) return fallback;
  try {
    const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({
      model: process.env.BLOG_MODEL || 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
    });
    const prompt = `Suggest a stock-photo search for the cover image of this blog article for a ${SECTOR_HINT[sector] || 'residential'} audience in Nigeria.
Title: "${title}"
Summary: "${excerpt || ''}"
Rules: 2–5 plain words describing a realistic, positive, professional scene (e.g. "hospital corridor visitors", "school entrance parents", "hotel reception desk", "security guard gate", "factory workers safety helmet"). No brand names, no text, no abstract concepts.
Return ONLY JSON: {"query": string}`;
    const res = await model.generateContent(prompt);
    const q = String(JSON.parse(res.response.text().trim().replace(/^```json\s*|```$/g, '')).query || '').trim();
    return q.split(/\s+/).slice(0, 6).join(' ') || fallback;
  } catch {
    return fallback;
  }
}

// Both providers normalised to { id, src, alt, photographer, photographerUrl, sourceUrl }
async function search(query) {
  if (provider() === 'pixabay') {
    const { data } = await axios.get('https://pixabay.com/api/', {
      params: { key: process.env.PIXABAY_API_KEY, q: query.slice(0, 100), image_type: 'photo', orientation: 'horizontal', safesearch: true, per_page: 30, min_width: 1200 },
      timeout: 15000,
    });
    return (data.hits || []).map((h) => ({
      id: `pixabay-${h.id}`, src: h.largeImageURL || h.webformatURL, thumb: h.webformatURL || h.previewURL, alt: h.tags || '',
      photographer: h.user || '', photographerUrl: h.user ? `https://pixabay.com/users/${h.user}-${h.user_id}/` : '', sourceUrl: h.pageURL || '',
    }));
  }
  const { data } = await axios.get('https://api.pexels.com/v1/search', {
    headers: { Authorization: process.env.PEXELS_API_KEY },
    params: { query, orientation: 'landscape', per_page: 30 },
    timeout: 15000,
  });
  return (data.photos || []).map((p) => ({
    id: `pexels-${p.id}`, src: p.src?.landscape || p.src?.large2x || p.src?.large, thumb: p.src?.medium || p.src?.small, alt: p.alt || '',
    photographer: p.photographer || '', photographerUrl: p.photographer_url || '', sourceUrl: p.url || '',
  }));
}


// GET with a couple of retries (stock CDNs occasionally reset connections)
async function fetchBytes(url, timeout = 30000) {
  let last;
  for (let i = 0; i < 3; i++) {
    try { return await axios.get(url, { responseType: 'arraybuffer', timeout }); }
    catch (e) { last = e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
  throw last;
}

// Gemini looks at the candidate thumbnails and picks the one that best fits
// the article (or none). Returns an index into `cands`, or -1.
async function pickBest(cands, { title, excerpt, sector }) {
  if (!process.env.GEMINI_API_KEY || !cands.length) return cands.length ? 0 : -1;
  const parts = [];
  const shown = [];
  for (const c of cands) {
    try {
      const r = await fetchBytes(c.thumb, 15000);
      parts.push({ text: `Photo ${shown.length}:` }, { inlineData: { mimeType: String(r.headers['content-type'] || 'image/jpeg').split(';')[0], data: Buffer.from(r.data).toString('base64') } });
      shown.push(c);
    } catch { /* skip unreachable thumbnails */ }
  }
  if (!shown.length) return -1;
  const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({
    model: process.env.BLOG_MODEL || 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  });
  const prompt = `Choose the best cover photo for a blog article read by people running ${SECTOR_HINT[sector] || 'residential estates'} in Nigeria.
Title: "${title}"
Summary: "${excerpt || ''}"
This is a professional software company's blog, so the photo must look modern, positive and trustworthy.
Pick a photo ONLY if it clearly shows the place, people or activity the article is about (e.g. a front desk, a gate with a guard, a school entrance, a hospital ward or corridor, a campus, a factory floor with workers in safety gear, an estate entrance).
Ideally African or Nigerian context, but relevance and a professional look matter more.
REJECT: poverty, hardship, slums, pollution, smoke, disasters, accidents, crime, weapons, sad or distressed people, children in poor conditions, abstract art, illustrations, anything with visible text, logos or watermarks, and anything only loosely related.
If no photo clearly fits, answer -1.
Return ONLY JSON: {"best": number (photo number) or -1 if none fit}`;
  try {
    const res = await model.generateContent([{ text: prompt }, ...parts]);
    const best = Number(JSON.parse(res.response.text().trim().replace(/^```json\s*|```$/g, '')).best);
    return Number.isInteger(best) && best >= 0 && best < shown.length ? cands.indexOf(shown[best]) : -1;
  } catch { return 0; }
}

/**
 * Finds a photo for the query that no other article uses yet, preferring
 * Nigerian / African results, and stores it in GridFS.
 * Returns { url, alt, photographer, photographerUrl, sourceUrl, provider, photoId, query } or null.
 */
async function coverFor({ title, excerpt, sector, usedIds = new Set(), slug }) {
  if (!isConfigured()) return null;
  const query = await imageQuery({ title, excerpt, sector });
  let photo = null;
  const seen = new Set();
  for (const q of [`${query} Nigeria`, `${query} Africa`, query, ...(SECTOR_FALLBACK[sector] || SECTOR_FALLBACK.estate)]) {
    const cands = (await search(q)).filter((p) => !usedIds.has(String(p.id)) && !seen.has(p.id) && p.thumb).slice(0, 8);
    cands.forEach((c) => seen.add(c.id));
    if (!cands.length) continue;
    const i = await pickBest(cands, { title, excerpt, sector });
    if (i >= 0) { photo = cands[i]; break; }
  }
  if (!photo) return null;

  const img = await fetchBytes(photo.src);
  const contentType = String(img.headers['content-type'] || 'image/jpeg').split(';')[0];
  if (!/^image\/(jpeg|png|webp)$/.test(contentType)) return null;

  const db = mongoose.connection?.db;
  if (!db) throw new Error('Database not ready');
  const bucket = new GridFSBucket(db, { bucketName: 'uploads' });
  const upload = bucket.openUploadStream(`blog-${slug || photo.id}.jpg`, {
    contentType,
    metadata: { source: provider(), photoId: photo.id, articleSlug: slug || null, size: img.data.byteLength },
  });
  await new Promise((resolve, reject) => {
    upload.once('error', reject);
    upload.once('finish', resolve);
    upload.end(Buffer.from(img.data));
  });

  return {
    url: `/files/${upload.id.toString()}`,
    alt: String(title || photo.alt || '').slice(0, 200),
    photographer: photo.photographer,
    photographerUrl: photo.photographerUrl,
    sourceUrl: photo.sourceUrl,
    provider: provider(),
    photoId: photo.id,
    query,
  };
}

module.exports = { isConfigured, provider, coverFor, imageQuery };
