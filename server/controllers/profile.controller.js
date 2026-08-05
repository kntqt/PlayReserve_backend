const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { body, validationResult } = require('express-validator');

const BCRYPT_ROUNDS = 12;

/**
 * GET /api/profile
 * Get logged in user's profile details
 */
const getProfile = async (req, res) => {
  try {
    const [users] = await pool.query(
      `SELECT id, role, first_name, middle_name, last_name, email, contact_number, address, gender, profile_image, status, approval_status, created_at 
       FROM users WHERE id = ?`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User profile not found.' });
    }

    res.json({ user: users[0] });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Server error fetching profile.' });
  }
};

/**
 * PUT /api/profile
 * Update logged in user's profile info
 */
const updateProfile = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { first_name, middle_name, last_name, contact_number, address, gender } = req.body;

    await pool.query(
      `UPDATE users 
       SET first_name = ?, middle_name = ?, last_name = ?, contact_number = ?, address = ?, gender = ?
       WHERE id = ?`,
      [first_name, middle_name || null, last_name, contact_number || null, address || null, gender || null, req.user.id]
    );

    res.json({ message: 'Profile updated successfully.' });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Server error updating profile.' });
  }
};

/**
 * POST /api/profile/image
 * Upload profile image
 */
const uploadProfileImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded.' });
    }

    const filename = req.file.filename;

    await pool.query(
      'UPDATE users SET profile_image = ? WHERE id = ?',
      [filename, req.user.id]
    );

    res.json({
      message: 'Profile image uploaded successfully.',
      profile_image: filename,
    });
  } catch (err) {
    console.error('Upload profile image error:', err);
    res.status(500).json({ error: 'Server error uploading profile image.' });
  }
};

/**
 * PUT /api/profile/password
 * Change password (requires current password)
 */
const changePassword = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { current_password, new_password } = req.body;

    const [users] = await pool.query('SELECT password FROM users WHERE id = ?', [req.user.id]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const isMatch = await bcrypt.compare(current_password, users[0].password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Incorrect current password.' });
    }

    const newHashedPassword = await bcrypt.hash(new_password, BCRYPT_ROUNDS);

    await pool.query('UPDATE users SET password = ? WHERE id = ?', [newHashedPassword, req.user.id]);

    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Server error changing password.' });
  }
};

// Validation rules
const updateProfileValidation = [
  body('first_name').trim().notEmpty().withMessage('First name is required'),
  body('last_name').trim().notEmpty().withMessage('Last name is required'),
];

const changePasswordValidation = [
  body('current_password').notEmpty().withMessage('Current password is required'),
  body('new_password').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
];

module.exports = {
  getProfile,
  updateProfile,
  uploadProfileImage,
  changePassword,
  updateProfileValidation,
  changePasswordValidation,
};
