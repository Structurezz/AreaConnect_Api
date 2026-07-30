const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/estateController');
const { authenticate, authorize, scopeToEstate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const uploadPdf = require('../middleware/uploadPdf');

router.use(authenticate);

router.post('/', authorize('super_admin'), [
  body('name').notEmpty(),
  body('address').notEmpty(),
], validate, ctrl.createEstate);

router.get('/', authorize('super_admin'), ctrl.getAllEstates);

router.get('/platform-stats', authorize('super_admin'), ctrl.getPlatformStats);
router.get('/stats', scopeToEstate, ctrl.getEstateStats);

// Multi-estate management for estate_managers
router.get('/mine', authorize('estate_manager'), ctrl.getMyEstates);
router.post('/add', authorize('estate_manager'), [
  body('name').notEmpty(),
  body('address').notEmpty(),
], validate, ctrl.addEstate);

router.get('/:estateId/detail', authorize('super_admin'), ctrl.getEstateDetail);
router.get('/:estateId', ctrl.getEstate);

router.patch('/:estateId', authorize('estate_manager', 'super_admin'), [
  body('name').optional().notEmpty(),
], validate, ctrl.updateEstate);

router.post('/:estateId/geocode', authorize('estate_manager', 'super_admin'), ctrl.geocodeEstate);

// ── Constitution PDF ──────────────────────────────────────────────────────────
router.post(
  '/:estateId/constitution',
  authorize('estate_manager', 'super_admin'),
  uploadPdf.single('file'),
  ctrl.uploadConstitution,
);
router.get('/:estateId/constitution/meta', ctrl.getConstitutionMeta);
router.get('/:estateId/constitution/file', ctrl.downloadConstitution);
router.delete(
  '/:estateId/constitution',
  authorize('estate_manager', 'super_admin'),
  ctrl.deleteConstitution,
);

module.exports = router;
