const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/marketplaceController');
const { authenticate, authorize, scopeToEstate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');

router.use(authenticate, scopeToEstate);

router.get('/', ctrl.getListings);
router.get('/:id', ctrl.viewListing);

router.post('/', upload.array('images', 5), [
  body('title').notEmpty(),
  body('price').isNumeric(),
  body('category').isIn(['food', 'services', 'skills', 'items_for_sale', 'rentals']),
], validate, ctrl.createListing);

router.patch('/:id', ctrl.updateListing);
router.delete('/:id', ctrl.deleteListing);

module.exports = router;
