// Streams uploaded files (images, PDFs) out of GridFS. Public read — the
// stored ObjectIds are opaque and already act as unguessable tokens.

const router = require('express').Router();
const mongoose = require('mongoose');
const { GridFSBucket, ObjectId } = require('mongodb');

const BUCKETS = ['uploads', 'constitutions'];

router.get('/:id', async (req, res) => {
  let id;
  try {
    id = new ObjectId(req.params.id);
  } catch {
    return res.status(400).send('Bad id');
  }

  const db = mongoose.connection?.db;
  if (!db) return res.status(503).send('DB not ready');

  for (const bucketName of BUCKETS) {
    try {
      const found = await db
        .collection(`${bucketName}.files`)
        .find({ _id: id })
        .limit(1)
        .toArray();

      if (found.length === 0) continue;
      const meta = found[0];

      res.setHeader('Content-Type',   meta.contentType || 'application/octet-stream');
      res.setHeader('Content-Length', meta.length);
      // Objects are content-addressed by GridFS id, so long cache is safe.
      res.setHeader('Cache-Control',  'public, max-age=31536000, immutable');

      const bucket = new GridFSBucket(db, { bucketName });
      const stream = bucket.openDownloadStream(id);
      stream.on('error', (err) => {
        console.error('[files] stream error', err?.message);
        if (!res.headersSent) res.status(500).end();
        else res.end();
      });
      return stream.pipe(res);
    } catch (err) {
      console.error('[files] lookup error', err?.message);
    }
  }

  res.status(404).send('Not found');
});

module.exports = router;
