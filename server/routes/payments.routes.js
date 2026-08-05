const express = require('express');
const router = express.Router();
const paymentsController = require('../controllers/payments.controller');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');

router.use(requireAuth);

router.get('/', requireRole(['admin', 'staff']), paymentsController.getPayments);
router.get('/player/:id', paymentsController.getPlayerPayments);
router.post('/', requireRole(['admin', 'staff']), paymentsController.recordPaymentValidation, paymentsController.recordPayment);

module.exports = router;
