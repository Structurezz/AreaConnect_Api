const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/planController');
const { authenticate, authorize, scopeToEstate } = require('../middleware/auth');

// Paystack webhook — needs the raw body for HMAC verification, so this route
// uses express.raw() instead of the global JSON parser. Must be declared
// before any router.use(express.json()) higher up — it is (plans router is
// mounted after global JSON parsing, so we parse here manually).
router.post(
  '/webhook',
  express.raw({ type: 'application/json', limit: '2mb' }),
  (req, res, next) => {
    try {
      // Expose raw body for the controller's HMAC check, then parse into req.body
      req.rawBody = req.body?.toString('utf8') || '';
      req.body = req.rawBody ? JSON.parse(req.rawBody) : {};
      next();
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Invalid JSON' });
    }
  },
  ctrl.paystackWebhook
);

// Public — pricing page (no auth)
router.get('/public', ctrl.getPlans);

// Estate manager — view own subscription + self-serve upgrade
router.get('/my-subscription', authenticate, scopeToEstate, ctrl.getMySubscription);
router.post('/upgrade/initialize', authenticate, scopeToEstate, ctrl.initializeUpgrade);
router.get('/upgrade/verify/:reference', authenticate, scopeToEstate, ctrl.verifyUpgrade);

// Admin only
const adminOnly = [authenticate, authorize('super_admin')];

router.get('/', ...adminOnly, ctrl.getAllPlans);
router.post('/', ...adminOnly, ctrl.createPlan);
router.put('/:id', ...adminOnly, ctrl.updatePlan);
router.delete('/:id', ...adminOnly, ctrl.deletePlan);

router.get('/subscriptions/stats', ...adminOnly, ctrl.getSubscriptionStats);
router.get('/subscriptions', ...adminOnly, ctrl.getSubscriptions);
router.post('/subscriptions', ...adminOnly, ctrl.assignSubscription);
router.patch('/subscriptions/:id', ...adminOnly, ctrl.updateSubscription);

// Comp / promo overrides — grant a free premium (or any plan) override to an estate
router.post('/subscriptions/comp', ...adminOnly, ctrl.grantComp);
router.delete('/subscriptions/comp/:estateId', ...adminOnly, ctrl.revokeComp);

module.exports = router;
