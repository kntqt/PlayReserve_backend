const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directories exist
const courtUploadDir = path.join(__dirname, '../uploads/courts');
const profileUploadDir = path.join(__dirname, '../uploads/profiles');

if (!fs.existsSync(courtUploadDir)) {
  fs.mkdirSync(courtUploadDir, { recursive: true });
}
if (!fs.existsSync(profileUploadDir)) {
  fs.mkdirSync(profileUploadDir, { recursive: true });
}

// Storage for court images
const courtStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, courtUploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `court-${uniqueSuffix}${ext}`);
  },
});

// Storage for profile images
const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, profileUploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `profile-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPG, PNG, and WebP images are allowed.'), false);
  }
};

const uploadCourtImage = multer({
  storage: courtStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter,
});

const uploadProfileImage = multer({
  storage: profileStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter,
});

module.exports = {
  uploadCourtImage,
  uploadProfileImage,
};
