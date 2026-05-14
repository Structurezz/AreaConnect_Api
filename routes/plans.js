const router = require('express').Router();
const ctrl = require('../controllers/planController');
const { authenticate, authorize, scopeToEstate } = require('../middleware/auth');

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

module.exports = router;
