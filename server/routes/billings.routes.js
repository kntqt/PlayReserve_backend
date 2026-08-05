const express = require('express');
const router = express.Router();
const billingsController = require('../controllers/billings.controller');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');

router.use(requireAuth);

router.get('/', billingsController.getBillings);
router.post('/setup', requireRole(['admin', 'staff']), billingsController.setupBillingValidation, billingsController.setupBilling);
router.patch('/:id/status', requireRole(['admin', 'staff']), billingsController.updateBillingStatus);
router.delete('/:id', requireRole(['admin', 'staff']), billingsController.deleteBilling);

module.exports = router;
