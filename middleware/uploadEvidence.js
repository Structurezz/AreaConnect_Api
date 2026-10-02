// Evidence uploads for the Courtroom. Accepts images, PDFs/docs, audio,
// short video. Streams to GridFS so Railway's ephemeral FS doesn't matter.
// Controllers consume req.files[i].url (/files/<objectId>), the same shape
// as the image upload middleware so callers don't care about the backend.

const multer   = require('multer');
const path     = require('path');
const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');

const BUCKET_NAME = 'uploads';

const EVIDENCE_MIME = /^(?:image\/(?:jpeg|png|webp|gif)|application\/pdf|application\/(?:msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)|audio\/(?:mpeg|mp3|wav|webm|ogg|mp4|x-m4a)|video\/(?:mp4|webm|quicktime))$/i;
const EVIDENCE_EXT  = /^\.(?:jpe?g|png|webp|gif|pdf|docx?|mp3|wav|m4a|ogg|mp4|mov|webm)$/i;

const MAX_SIZE = 25 * 1024 * 1024; // 25MB — enough for a short clip or scan

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_SIZE, files: 6 },
  fileFilter: (req, file, cb) => {
    const extOk  = EVIDENCE_EXT.test(path.extname(file.originalname || '').toLowerCase());
    const mimeOk = EVIDENCE_MIME.test(file.mimetype || '');
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error('Unsupported file type. Images, PDFs, DOCs, audio or short video only.'));
  },
});

function kindFromMime(mime = '') {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  return 'document';
}

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
          purpose:    'court_evidence',
        },
      });

      const id = await new Promise((resolve, reject) => {
        uploadStream.on('error', reject);
        uploadStream.on('finish', () => resolve(uploadStream.id));
        uploadStream.end(file.buffer);
      });

      file.url  = `/files/${id}`;
      file.id   = String(id);
      file.kind = kindFromMime(file.mimetype);
    }
    next();
  } catch (err) { next(err); }
}

module.exports = {
  single: (field) => [memoryUpload.single(field), persistToGridFS],
  array:  (field, max = 6) => [memoryUpload.array(field, max), persistToGridFS],
};
