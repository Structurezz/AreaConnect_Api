// Podcast media (cover art + pre-recorded episode audio) for the admin hub.
// Streams to GridFS like other uploads, served from /files/<id>.
const multer = require('multer');
const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');

const MIME = /^(?:image\/(?:jpeg|png|webp)|audio\/(?:mpeg|mp3|wav|x-wav|webm|ogg|mp4|x-m4a|aac))$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 120 * 1024 * 1024, files: 1 }, // ~2h of 128kbps mp3
  fileFilter: (req, file, cb) => (MIME.test(file.mimetype || '') ? cb(null, true) : cb(new Error('Use a JPG/PNG/WebP image or an MP3/M4A/WAV/WebM/OGG audio file'))),
}).single('file');

async function persist(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const bucket = new GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
    const stream = bucket.openUploadStream(req.file.originalname || 'podcast-media', {
      contentType: req.file.mimetype, metadata: { uploadedBy: req.user?._id || null, purpose: 'podcast' },
    });
    const id = await new Promise((resolve, reject) => {
      stream.on('error', reject); stream.on('finish', () => resolve(stream.id)); stream.end(req.file.buffer);
    });
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
    return res.status(201).json({ success: true, data: { url: `${proto}://${req.get('host')}/files/${id}`, kind: req.file.mimetype.startsWith('audio/') ? 'audio' : 'image', size: req.file.size, name: req.file.originalname } });
  } catch (err) { return next(err); }
}

module.exports = (req, res, next) => upload(req, res, (err) => {
  if (err) return res.status(400).json({ success: false, message: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 120MB)' : err.message });
  return persist(req, res, next);
});
