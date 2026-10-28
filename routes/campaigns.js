const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/campaignController');

const router = express.Router();

router.use(authenticate);

// End-user reads
router.get('/active', ctrl.getActiveForUser);
router.post('/:id/seen', ctrl.markSeen);
router.post('/:id/dismiss', ctrl.dismiss);
router.post('/:id/click', ctrl.click);

// Super-admin
const admin = authorize('super_admin');
router.get('/overview', admin, ctrl.overview);
router.post('/estimate', admin, ctrl.estimate);
router.post('/generate-email', admin, ctrl.generateEmailContent);
router.get('/', admin, ctrl.listAll);
router.post('/', admin, ctrl.create);
router.get('/:id', admin, ctrl.getById);
router.get('/:id/stats', admin, ctrl.stats);
router.patch('/:id', admin, ctrl.update);
router.patch('/:id/status', admin, ctrl.setStatus);
router.delete('/:id', admin, ctrl.remove);
router.post('/:id/duplicate', admin, ctrl.duplicate);
router.post('/:id/send-email', admin, ctrl.sendEmailBlast);
router.post('/:id/test-email', admin, ctrl.sendTestEmail);
router.post('/:id/send-push', admin, ctrl.sendPush);

module.exports = router;
