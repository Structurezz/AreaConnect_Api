// Helpers for cleaning up GridFS files when the referencing document is
// deleted. Safe to call with any URL — we no-op if the string doesn't look
// like a /files/<id> reference, so a legacy /uploads/* path won't throw.

const mongoose = require('mongoose');
const { GridFSBucket, ObjectId } = require('mongodb');

const BUCKETS = ['uploads', 'constitutions'];

function extractGridFSId(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/\/files\/([a-f0-9]{24})(?:$|[?#])/i);
  return m ? m[1] : null;
}

async function deleteGridFSFile(url) {
  const id = extractGridFSId(url);
  if (!id) return false;

  const db = mongoose.connection?.db;
  if (!db) return false;

  let oid;
  try { oid = new ObjectId(id); } catch { return false; }

  for (const bucketName of BUCKETS) {
    try {
      const found = await db
        .collection(`${bucketName}.files`)
        .find({ _id: oid })
        .limit(1)
        .toArray();
      if (found.length === 0) continue;
      const bucket = new GridFSBucket(db, { bucketName });
      await bucket.delete(oid);
      return true;
    } catch (err) {
      // Already gone or unreachable — don't throw, just log
      console.warn('[gridfs] delete failed for', url, err?.message);
    }
  }
  return false;
}

async function deleteGridFSFiles(urls = []) {
  for (const url of urls) {
    try { await deleteGridFSFile(url); } catch { /* best effort */ }
  }
}

module.exports = { extractGridFSId, deleteGridFSFile, deleteGridFSFiles };
