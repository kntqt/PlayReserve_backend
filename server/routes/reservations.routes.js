const express = require('express');
const router = express.Router();
const reservationsController = require('../controllers/reservations.controller');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');

router.use(requireAuth);

router.get('/', reservationsController.getReservations);
router.get('/pending', requireRole(['admin']), reservationsController.getPendingReservations);
router.post('/check-availability', reservationsController.checkAvailability);
router.post('/', reservationsController.createReservationValidation, reservationsController.createReservation);
router.patch('/:id/approve', requireRole(['admin']), reservationsController.approveReservation);
router.patch('/:id/reject', requireRole(['admin']), reservationsController.rejectReservation);
router.patch('/:id/cancel', reservationsController.cancelReservation);

module.exports = router;
