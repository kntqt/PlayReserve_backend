const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profile.controller');
const { requireAuth } = require('../middleware/auth');
const { uploadProfileImage } = require('../middleware/upload');

router.use(requireAuth);

router.get('/', profileController.getProfile);
router.put('/', profileController.updateProfileValidation, profileController.updateProfile);
router.post('/image', uploadProfileImage.single('image'), profileController.uploadProfileImage);
router.put('/password', profileController.changePasswordValidation, profileController.changePassword);

module.exports = router;
