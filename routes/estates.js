const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/estateController');
const { authenticate, authorize, scopeToEstate } = require('../middleware/auth');
const validate = require('../middleware/validate');

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

module.exports = router;
