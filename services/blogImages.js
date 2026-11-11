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
Rules: 2–5 plain words describing a realistic scene or object (e.g. "hospital corridor visitors", "school gate parents", "hotel reception desk", "security guard gate"). No brand names, no text, no abstract concepts.
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
      id: `pixabay-${h.id}`, src: h.largeImageURL || h.webformatURL, alt: h.tags || '',
      photographer: h.user || '', photographerUrl: h.user ? `https://pixabay.com/users/${h.user}-${h.user_id}/` : '', sourceUrl: h.pageURL || '',
    }));
  }
  const { data } = await axios.get('https://api.pexels.com/v1/search', {
    headers: { Authorization: process.env.PEXELS_API_KEY },
    params: { query, orientation: 'landscape', per_page: 30 },
    timeout: 15000,
  });
  return (data.photos || []).map((p) => ({
    id: `pexels-${p.id}`, src: p.src?.landscape || p.src?.large2x || p.src?.large, alt: p.alt || '',
    photographer: p.photographer || '', photographerUrl: p.photographer_url || '', sourceUrl: p.url || '',
  }));
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
  for (const q of [`${query} Nigeria`, `${query} Africa`, query, SECTOR_HINT[sector] || 'community']) {
    const photos = await search(q);
    photo = photos.find((p) => !usedIds.has(String(p.id)));
    if (photo) break;
  }
  if (!photo) return null;

  const img = await axios.get(photo.src, { responseType: 'arraybuffer', timeout: 30000 });
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
