const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { body, validationResult } = require('express-validator');

const BCRYPT_ROUNDS = 12;

/**
 * GET /api/users
 * List users with optional role filter and search
 */
const getUsers = async (req, res) => {
  try {
    const { role, search, page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let query = 'SELECT id, role, first_name, middle_name, last_name, email, contact_number, address, gender, profile_image, status, approval_status, created_at FROM users WHERE 1=1';
    const params = [];

    if (role) {
      query += ' AND role = ?';
      params.push(role);
    }

    if (search) {
      query += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // Count total
    const countQuery = query.replace(/SELECT .+ FROM/, 'SELECT COUNT(*) as total FROM');
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    // Get paginated results
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const [users] = await pool.query(query, params);

    res.json({
      users,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Server error fetching users.' });
  }
};

/**
 * POST /api/users
 * Create a new user (admin creates staff/player directly)
 */
const createUser = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { role, first_name, middle_name, last_name, email, password, contact_number, address, gender } = req.body;

    // Check duplicate email
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const [result] = await pool.query(
      `INSERT INTO users (role, first_name, middle_name, last_name, email, password, contact_number, address, gender, status, approval_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'approved')`,
      [role, first_name, middle_name || null, last_name, email, hashedPassword, contact_number || null, address || null, gender || null]
    );

    res.status(201).json({
      message: 'User created successfully.',
      userId: result.insertId,
    });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Server error creating user.' });
  }
};

/**
 * PUT /api/users/:id
 * Update user details
 */
const updateUser = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { first_name, middle_name, last_name, email, contact_number, address, gender, role } = req.body;

    // Check user exists
    const [existing] = await pool.query('SELECT id FROM users WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Check email uniqueness (exclude current user)
    if (email) {
      const [emailCheck] = await pool.query('SELECT id FROM users WHERE email = ? AND id != ?', [email, id]);
      if (emailCheck.length > 0) {
        return res.status(409).json({ error: 'Email already in use by another user.' });
      }
    }

    await pool.query(
      `UPDATE users SET first_name = ?, middle_name = ?, last_name = ?, email = ?, contact_number = ?, address = ?, gender = ?, role = ?
       WHERE id = ?`,
      [first_name, middle_name || null, last_name, email, contact_number || null, address || null, gender || null, role, id]
    );

    res.json({ message: 'User updated successfully.' });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Server error updating user.' });
  }
};

/**
 * PATCH /api/users/:id/status
 * Toggle user active/inactive
 */
const toggleStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const [users] = await pool.query('SELECT id, status FROM users WHERE id = ?', [id]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const newStatus = users[0].status === 'active' ? 'inactive' : 'active';
    await pool.query('UPDATE users SET status = ? WHERE id = ?', [newStatus, id]);

    res.json({ message: `User status changed to ${newStatus}.`, status: newStatus });
  } catch (err) {
    console.error('Toggle status error:', err);
    res.status(500).json({ error: 'Server error toggling status.' });
  }
};

/**
 * PATCH /api/users/:id/approve
 * Approve a pending player
 */
const approvePlayer = async (req, res) => {
  try {
    const { id } = req.params;

    const [users] = await pool.query('SELECT id, role, approval_status FROM users WHERE id = ?', [id]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (users[0].approval_status !== 'pending') {
      return res.status(400).json({ error: 'User is not in pending state.' });
    }

    await pool.query(
      "UPDATE users SET approval_status = 'approved', status = 'active' WHERE id = ?",
      [id]
    );

    res.json({ message: 'Player approved successfully.' });
  } catch (err) {
    console.error('Approve player error:', err);
    res.status(500).json({ error: 'Server error approving player.' });
  }
};

/**
 * PATCH /api/users/:id/reject
 * Reject a pending player
 */
const rejectPlayer = async (req, res) => {
  try {
    const { id } = req.params;

    const [users] = await pool.query('SELECT id, approval_status FROM users WHERE id = ?', [id]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (users[0].approval_status !== 'pending') {
      return res.status(400).json({ error: 'User is not in pending state.' });
    }

    await pool.query(
      "UPDATE users SET approval_status = 'rejected', status = 'inactive' WHERE id = ?",
      [id]
    );

    res.json({ message: 'Player rejected.' });
  } catch (err) {
    console.error('Reject player error:', err);
    res.status(500).json({ error: 'Server error rejecting player.' });
  }
};

/**
 * DELETE /api/users/:id
 * Delete a user
 */
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const [users] = await pool.query('SELECT id FROM users WHERE id = ?', [id]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Prevent deleting yourself
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account.' });
    }

    await pool.query('DELETE FROM users WHERE id = ?', [id]);
    res.json({ message: 'User deleted successfully.' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Server error deleting user.' });
  }
};

// Validation rules
const createUserValidation = [
  body('role').isIn(['admin', 'staff', 'player']).withMessage('Role must be admin, staff, or player'),
  body('first_name').trim().notEmpty().withMessage('First name is required'),
  body('last_name').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
];

const updateUserValidation = [
  body('first_name').trim().notEmpty().withMessage('First name is required'),
  body('last_name').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
];

module.exports = {
  getUsers,
  createUser,
  updateUser,
  toggleStatus,
  approvePlayer,
  rejectPlayer,
  deleteUser,
  createUserValidation,
  updateUserValidation,
};
