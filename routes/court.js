const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/courtController');
const { authenticate, authorize, scopeToEstate } = require('../middleware/auth');

router.use(authenticate, scopeToEstate);

router.get('/stats', ctrl.getPublicStats);
router.get('/members', ctrl.getMembers);
router.get('/', ctrl.listCases);
router.post('/', ctrl.fileCase);
router.get('/:id', ctrl.getCase);
router.patch('/:id/open', authorize('estate_manager','super_admin'), ctrl.openCase);
router.post('/:id/lawyer', ctrl.hireLawyer);
router.post('/:id/argument', ctrl.submitArgument);
router.post('/:id/evidence', ctrl.submitEvidence);
router.post('/:id/jury-vote', ctrl.castJuryVote);
router.post('/:id/verdict', authorize('estate_manager','super_admin'), ctrl.deliverVerdict);
router.post('/:id/settle', ctrl.proposeSettlement);
router.post('/:id/appeal', ctrl.fileAppeal);
router.post('/:id/pay-fine', ctrl.payFine);

module.exports = router;
