const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reports.controller');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');

router.use(requireAuth);

router.get('/admin', requireRole(['admin']), reportsController.getAdminDashboard);
router.get('/staff', requireRole(['admin', 'staff']), reportsController.getStaffDashboard);
router.get('/player', requireRole(['player']), reportsController.getPlayerDashboard);
router.get('/reports/revenue', requireRole(['admin']), reportsController.getRevenueReports);
router.get('/reports/utilization', requireRole(['admin']), reportsController.getUtilizationReports);

module.exports = router;
