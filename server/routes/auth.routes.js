const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth');

router.post('/login', authController.loginValidation, authController.login);
router.post('/register', authController.registerValidation, authController.register);
router.post('/logout', authController.logout);
router.post('/refresh', authController.refreshToken);
router.get('/me', requireAuth, authController.getMe);

module.exports = router;
