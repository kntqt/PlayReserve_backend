const express = require('express');
const router = express.Router();
const courtsController = require('../controllers/courts.controller');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { uploadCourtImage } = require('../middleware/upload');

// Public route for landing page
router.get('/public', courtsController.getPublicCourts);

// Authenticated routes
router.get('/', requireAuth, courtsController.getCourts);
router.get('/:id', requireAuth, courtsController.getCourtById);
router.get('/:id/schedule', requireAuth, courtsController.getCourtSchedule);

// Admin/Staff routes
router.post(
  '/',
  requireAuth,
  requireRole(['admin']),
  uploadCourtImage.single('image'),
  courtsController.createCourtValidation,
  courtsController.createCourt
);

router.put(
  '/:id',
  requireAuth,
  requireRole(['admin', 'staff']),
  uploadCourtImage.single('image'),
  courtsController.updateCourtValidation,
  courtsController.updateCourt
);

router.patch(
  '/:id/status',
  requireAuth,
  requireRole(['admin', 'staff']),
  courtsController.updateCourtStatus
);

module.exports = router;
