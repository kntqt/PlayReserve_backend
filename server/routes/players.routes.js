const express = require('express');
const router = express.Router();
const playersController = require('../controllers/players.controller');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');

router.use(requireAuth);

router.get('/lookup', requireRole(['admin', 'staff']), playersController.lookupPlayerByEmail);
router.get('/', requireRole(['admin', 'staff']), playersController.getPlayers);

module.exports = router;
