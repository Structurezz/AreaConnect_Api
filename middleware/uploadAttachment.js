// Chat attachments: images, documents, spreadsheets, audio and short video,
// up to 15MB, stored in GridFS like every other upload (served at /files/:id).

const multer = require('multer');
const path = require('path');
const { persistToGridFS } = require('./upload');

const ALLOWED_EXT = /^\.(jpe?g|png|webp|gif|heic|pdf|docx?|xlsx?|pptx?|txt|csv|zip|mp3|m4a|wav|ogg|webm|mp4|mov)$/i;

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_EXT.test(path.extname(file.originalname || ''))) return cb(null, true);
    cb(new Error('That file type isn\'t supported'));
  },
});

// Accepts the legacy `image` field and the new `file` field.
module.exports = (req, res, next) => {
  memoryUpload.fields([{ name: 'image', maxCount: 1 }, { name: 'file', maxCount: 1 }])(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 15MB)' : err.message;
      return res.status(400).json({ success: false, message: msg });
    }
    const files = [...(req.files?.image || []), ...(req.files?.file || [])];
    req.files = files;
    persistToGridFS(req, res, () => {
      req.chatImage = (files.find((f) => f.fieldname === 'image')) || null;
      req.chatFile = (files.find((f) => f.fieldname === 'file')) || null;
      next();
    });
  });
};
