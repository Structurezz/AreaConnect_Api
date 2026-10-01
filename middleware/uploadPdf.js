// PDFs (currently just the estate constitution) also go to GridFS. Separate
// bucket so we never have to care about imaging vs documents elsewhere.

const multer = require('multer');
const path = require('path');
const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');

const BUCKET_NAME = 'constitutions';

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (req, file, cb) => {
    const extOk  = path.extname(file.originalname).toLowerCase() === '.pdf';
    const mimeOk = file.mimetype === 'application/pdf';
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error('Only PDF files are allowed for the estate constitution'));
  },
});

async function persistPdfToGridFS(req, res, next) {
  try {
    if (!req.file) return next();

    const db = mongoose.connection?.db;
    if (!db) return next(new Error('Database not ready'));

    const bucket = new GridFSBucket(db, { bucketName: BUCKET_NAME });
    const uploadStream = bucket.openUploadStream(req.file.originalname || 'constitution.pdf', {
      contentType: 'application/pdf',
      metadata: {
        uploadedBy: req.user?._id || null,
        estateId:   req.estateId || null,
        size:       req.file.size,
      },
    });

    await new Promise((resolve, reject) => {
      uploadStream.once('error',  reject);
      uploadStream.once('finish', resolve);
      uploadStream.end(req.file.buffer);
    });

    req.file.gridfsId = uploadStream.id.toString();
    req.file.url      = `/files/${req.file.gridfsId}`;
    req.file.filename = req.file.gridfsId;

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  single: (field) => (req, res, next) => {
    memoryUpload.single(field)(req, res, (err) => {
      if (err) return next(err);
      persistPdfToGridFS(req, res, next);
    });
  },
};
