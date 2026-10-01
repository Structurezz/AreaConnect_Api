// Image uploads land in GridFS instead of the local disk, so they survive
// Railway redeploys (ephemeral filesystem) and don't need a mounted volume.
//
// Shape: controllers consume `req.file.url` / `req.files[i].url`, which look
// like `/files/<objectId>`. The /files/:id route streams them back.

const multer = require('multer');
const path = require('path');
const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');

const BUCKET_NAME = 'uploads';

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per image
  fileFilter: (req, file, cb) => {
    const extOk  = /jpeg|jpg|png|webp|gif/.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = /^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype);
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error('Only image files are allowed'));
  },
});

async function persistToGridFS(req, res, next) {
  try {
    const files = req.files || (req.file ? [req.file] : []);
    if (files.length === 0) return next();

    const db = mongoose.connection?.db;
    if (!db) return next(new Error('Database not ready'));

    const bucket = new GridFSBucket(db, { bucketName: BUCKET_NAME });

    for (const file of files) {
      const uploadStream = bucket.openUploadStream(file.originalname || 'upload', {
        contentType: file.mimetype,
        metadata: {
          uploadedBy: req.user?._id || null,
          estateId:   req.estateId || null,
          size:       file.size,
        },
      });

      await new Promise((resolve, reject) => {
        uploadStream.once('error',  reject);
        uploadStream.once('finish', resolve);
        uploadStream.end(file.buffer);
      });

      file.gridfsId = uploadStream.id.toString();
      file.url      = `/files/${file.gridfsId}`;
      // Keep .filename populated for any legacy code that still reads it.
      file.filename = file.gridfsId;
    }

    next();
  } catch (err) {
    next(err);
  }
}

// Wrap the multer middleware so controllers can keep using
// `upload.single(field)` / `upload.array(field, max)` without changes
// to the route signatures.
module.exports = {
  single: (field) => (req, res, next) => {
    memoryUpload.single(field)(req, res, (err) => {
      if (err) return next(err);
      persistToGridFS(req, res, next);
    });
  },
  array: (field, max) => (req, res, next) => {
    memoryUpload.array(field, max)(req, res, (err) => {
      if (err) return next(err);
      persistToGridFS(req, res, next);
    });
  },
};
