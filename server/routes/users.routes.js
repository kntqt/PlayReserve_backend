const express = require('express');
const router = express.Router();
const usersController = require('../controllers/users.controller');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');

// All users management routes are restricted to Admin
router.use(requireAuth, requireRole(['admin']));

router.get('/', usersController.getUsers);
router.post('/', usersController.createUserValidation, usersController.createUser);
router.put('/:id', usersController.updateUserValidation, usersController.updateUser);
router.patch('/:id/status', usersController.toggleStatus);
router.patch('/:id/approve', usersController.approvePlayer);
router.patch('/:id/reject', usersController.rejectPlayer);
router.delete('/:id', usersController.deleteUser);

module.exports = router;
