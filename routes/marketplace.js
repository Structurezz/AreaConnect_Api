const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/marketplaceController');
const { authenticate, authorize, scopeToEstate, requireEstate, requireActiveSubscription } = require('../middleware/auth');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');

const CATEGORIES = ['food', 'services', 'skills', 'items_for_sale', 'rentals'];

router.use(authenticate, scopeToEstate, requireEstate, requireActiveSubscription);

// ── Estate management: moderation, consumer protection, rules ──
const mgr = authorize('estate_manager', 'super_admin');
router.get('/admin/stats', mgr, ctrl.adminStats);
router.get('/admin/listings', mgr, ctrl.adminListings);
router.post('/admin/listings/:id/approve', mgr, ctrl.approve);
router.post('/admin/listings/:id/reject', mgr, ctrl.reject);
router.post('/admin/listings/:id/remove', mgr, ctrl.remove);
router.post('/admin/listings/:id/restore', mgr, ctrl.restore);
router.get('/admin/reports', mgr, ctrl.adminReports);
router.post('/admin/reports/:id/resolve', mgr, ctrl.resolveReport);
router.get('/admin/sellers', mgr, ctrl.adminSellers);
router.post('/admin/sellers/:id/suspend', mgr, ctrl.suspendSeller);
router.post('/admin/sellers/:id/unsuspend', mgr, ctrl.unsuspendSeller);
router.get('/admin/settings', mgr, ctrl.getSettings);
router.put('/admin/settings', mgr, ctrl.updateSettings);

// ── Residents ──
router.get('/rules', ctrl.getRules);
router.get('/mine', ctrl.getMyListings);
router.get('/saved', ctrl.getSaved);
router.get('/', ctrl.getListings);
router.get('/:id', ctrl.viewListing);

router.post('/', upload.array('images', 5), [
  body('title').trim().notEmpty().isLength({ max: 120 }),
  body('description').trim().notEmpty().isLength({ max: 2000 }),
  body('price').isFloat({ min: 0 }),
  body('category').isIn(CATEGORIES),
], validate, ctrl.createListing);

router.post('/:id/save', ctrl.toggleSave);
router.post('/:id/report', [
  body('reason').isIn(['scam', 'overpriced', 'misleading', 'unsafe', 'not_delivered', 'other']),
], validate, ctrl.reportListing);
router.post('/:id/review', [body('rating').isInt({ min: 1, max: 5 })], validate, ctrl.reviewSeller);
router.patch('/:id', [
  body('price').optional().isFloat({ min: 0 }),
  body('category').optional().isIn(CATEGORIES),
], validate, ctrl.updateListing);
router.delete('/:id', ctrl.deleteListing);

module.exports = router;
