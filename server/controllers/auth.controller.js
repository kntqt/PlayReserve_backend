const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { body, validationResult } = require('express-validator');
require('dotenv').config();

const BCRYPT_ROUNDS = 12;

/**
 * POST /api/auth/login
 * Login with email + password, return JWT
 */
const login = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find user by email
    const [users] = await pool.query(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials or inactive account.' });
    }

    const user = users[0];

    // Check if account is active
    if (user.status !== 'active') {
      return res.status(401).json({ error: 'Invalid credentials or inactive account.' });
    }

    // For players, check approval status
    if (user.role === 'player' && user.approval_status !== 'approved') {
      return res.status(401).json({ 
        error: 'Your account is pending approval. Please wait for admin confirmation.' 
      });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials or inactive account.' });
    }

    // Generate access token
    const accessToken = jwt.sign(
      { id: user.id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );

    // Generate refresh token
    const refreshToken = jwt.sign(
      { id: user.id, role: user.role, email: user.email },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
    );

    // Set refresh token as httpOnly cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Return user data (without password) + access token
    const { password: _, ...userData } = user;

    res.json({
      message: 'Login successful',
      user: userData,
      accessToken,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login.' });
  }
};

/**
 * POST /api/auth/register
 * Player self-registration (status=inactive, approval_status=pending)
 */
const register = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { first_name, middle_name, last_name, email, password, contact_number, address, gender } = req.body;

    // Check if email already exists
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email already registered.' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Insert player with inactive/pending status
    const [result] = await pool.query(
      `INSERT INTO users (role, first_name, middle_name, last_name, email, password, contact_number, address, gender, status, approval_status)
       VALUES ('player', ?, ?, ?, ?, ?, ?, ?, ?, 'inactive', 'pending')`,
      [first_name, middle_name || null, last_name, email, hashedPassword, contact_number || null, address || null, gender || null]
    );

    res.status(201).json({
      message: 'Registration successful. Your account is pending admin approval.',
      userId: result.insertId,
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Server error during registration.' });
  }
};

/**
 * POST /api/auth/logout
 * Clear refresh token cookie
 */
const logout = (req, res) => {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
  });
  res.json({ message: 'Logged out successfully.' });
};

/**
 * GET /api/auth/me
 * Get current user profile from JWT
 */
const getMe = async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, role, first_name, middle_name, last_name, email, contact_number, address, gender, profile_image, status, approval_status, created_at FROM users WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ user: users[0] });
  } catch (err) {
    console.error('Get me error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token cookie
 */
const refreshToken = async (req, res) => {
  try {
    const token = req.cookies.refreshToken;

    if (!token) {
      return res.status(401).json({ error: 'No refresh token provided.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);

    // Verify user still exists and is active
    const [users] = await pool.query(
      'SELECT id, role, email, status FROM users WHERE id = ?',
      [decoded.id]
    );

    if (users.length === 0 || users[0].status !== 'active') {
      return res.status(401).json({ error: 'Invalid refresh token.' });
    }

    const user = users[0];

    // Issue new access token
    const accessToken = jwt.sign(
      { id: user.id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );

    res.json({ accessToken });
  } catch (err) {
    console.error('Refresh token error:', err);
    res.status(401).json({ error: 'Invalid or expired refresh token.' });
  }
};

// Validation rules
const loginValidation = [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

const registerValidation = [
  body('first_name').trim().notEmpty().withMessage('First name is required'),
  body('last_name').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('contact_number').optional().trim(),
  body('address').optional().trim(),
  body('gender').optional().trim(),
];

module.exports = {
  login,
  register,
  logout,
  getMe,
  refreshToken,
  loginValidation,
  registerValidation,
};
