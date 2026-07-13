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

// Super-admin CRUD
router.get('/', authorize('super_admin'), ctrl.listAll);
router.post('/', authorize('super_admin'), ctrl.create);
router.get('/:id', authorize('super_admin'), ctrl.getById);
router.patch('/:id', authorize('super_admin'), ctrl.update);
router.patch('/:id/status', authorize('super_admin'), ctrl.setStatus);
router.delete('/:id', authorize('super_admin'), ctrl.remove);
router.post('/:id/send-email', authorize('super_admin'), ctrl.sendEmailBlast);

module.exports = router;
