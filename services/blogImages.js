// Cover photos for blog articles. Gemini suggests a stock-photo search, Pexels
// finds a matching landscape photo, and the image is downloaded into GridFS
// (bucket "uploads", served by /files/:id) like every other image in the
// system. Each article stores the /files URL plus the photographer credit
// Pexels asks for. Needs PEXELS_API_KEY; without it articles keep the
// landing page's fallback cover.
const axios = require('axios');
const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const isConfigured = () => !!process.env.PEXELS_API_KEY;
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

async function search(query) {
  const { data } = await axios.get('https://api.pexels.com/v1/search', {
    headers: { Authorization: process.env.PEXELS_API_KEY },
    params: { query, orientation: 'landscape', per_page: 30 },
    timeout: 15000,
  });
  return data.photos || [];
}

/**
 * Finds a photo for the query that no other article uses yet, preferring
 * Nigerian / African results, and stores it in GridFS.
 * Returns { url, alt, photographer, photographerUrl, sourceUrl, pexelsId, query } or null.
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

  const src = photo.src?.landscape || photo.src?.large2x || photo.src?.large;
  const img = await axios.get(src, { responseType: 'arraybuffer', timeout: 30000 });
  const contentType = String(img.headers['content-type'] || 'image/jpeg').split(';')[0];
  if (!/^image\/(jpeg|png|webp)$/.test(contentType)) return null;

  const db = mongoose.connection?.db;
  if (!db) throw new Error('Database not ready');
  const bucket = new GridFSBucket(db, { bucketName: 'uploads' });
  const upload = bucket.openUploadStream(`blog-${slug || photo.id}.jpg`, {
    contentType,
    metadata: { source: 'pexels', pexelsId: photo.id, articleSlug: slug || null, size: img.data.byteLength },
  });
  await new Promise((resolve, reject) => {
    upload.once('error', reject);
    upload.once('finish', resolve);
    upload.end(Buffer.from(img.data));
  });

  return {
    url: `/files/${upload.id.toString()}`,
    alt: String(photo.alt || title || '').slice(0, 200),
    photographer: photo.photographer || '',
    photographerUrl: photo.photographer_url || '',
    sourceUrl: photo.url || '',
    pexelsId: String(photo.id),
    query,
  };
}

module.exports = { isConfigured, coverFor, imageQuery };
