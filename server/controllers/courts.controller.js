const pool = require('../config/db');
const { body, validationResult } = require('express-validator');
const { getBookedSlots } = require('../utils/conflictCheck');

/**
 * GET /api/courts
 * List courts with optional filters and pagination
 */
const getCourts = async (req, res) => {
  try {
    const { sport_type, status, search, page = 1, limit = 8 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let query = 'SELECT * FROM courts WHERE 1=1';
    const params = [];

    if (sport_type) {
      query += ' AND sport_type = ?';
      params.push(sport_type);
    }

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    if (search) {
      query += ' AND (court_number LIKE ? OR location LIKE ? OR description LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // Count total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    // Get paginated results
    query += ' ORDER BY court_number ASC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const [courts] = await pool.query(query, params);

    res.json({
      courts,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('Get courts error:', err);
    res.status(500).json({ error: 'Server error fetching courts.' });
  }
};

/**
 * GET /api/courts/public
 * Public listing for landing page (no auth required)
 */
const getPublicCourts = async (req, res) => {
  try {
    const { page = 1, limit = 8 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [countResult] = await pool.query(
      "SELECT COUNT(*) as total FROM courts WHERE status != 'closed'"
    );
    const total = countResult[0].total;

    const [courts] = await pool.query(
      "SELECT id, court_number, sport_type, location, size_sqm, hourly_rate, image, status, description FROM courts WHERE status != 'closed' ORDER BY court_number ASC LIMIT ? OFFSET ?",
      [parseInt(limit), offset]
    );

    // Get sport type counts
    const [sportCounts] = await pool.query(
      'SELECT sport_type, COUNT(*) as count FROM courts GROUP BY sport_type'
    );

    res.json({
      courts,
      sportCounts,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('Get public courts error:', err);
    res.status(500).json({ error: 'Server error fetching courts.' });
  }
};

/**
 * GET /api/courts/:id
 * Get court detail
 */
const getCourtById = async (req, res) => {
  try {
    const { id } = req.params;
    const [courts] = await pool.query('SELECT * FROM courts WHERE id = ?', [id]);

    if (courts.length === 0) {
      return res.status(404).json({ error: 'Court not found.' });
    }

    res.json({ court: courts[0] });
  } catch (err) {
    console.error('Get court error:', err);
    res.status(500).json({ error: 'Server error fetching court.' });
  }
};

/**
 * GET /api/courts/:id/schedule?date=YYYY-MM-DD
 * Get booked slots for a court on a specific date
 */
const getCourtSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'Date parameter is required (YYYY-MM-DD).' });
    }

    // Verify court exists
    const [courts] = await pool.query('SELECT * FROM courts WHERE id = ?', [id]);
    if (courts.length === 0) {
      return res.status(404).json({ error: 'Court not found.' });
    }

    const connection = await pool.getConnection();
    try {
      const bookedSlots = await getBookedSlots(connection, id, date);
      res.json({
        court: courts[0],
        date,
        bookedSlots,
        operatingHours: {
          start: process.env.OPERATING_HOURS_START || '06:00',
          end: process.env.OPERATING_HOURS_END || '22:00',
        },
      });
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('Get court schedule error:', err);
    res.status(500).json({ error: 'Server error fetching schedule.' });
  }
};

/**
 * POST /api/courts
 * Create a new court (Admin only)
 */
const createCourt = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { court_number, sport_type, location, size_sqm, hourly_rate, description } = req.body;
    const image = req.file ? req.file.filename : null;

    // Check duplicate court_number
    const [existing] = await pool.query('SELECT id FROM courts WHERE court_number = ?', [court_number]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Court number already exists.' });
    }

    const [result] = await pool.query(
      `INSERT INTO courts (court_number, sport_type, location, size_sqm, hourly_rate, image, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [court_number, sport_type, location || null, size_sqm || null, hourly_rate, image, description || null]
    );

    res.status(201).json({
      message: 'Court created successfully.',
      courtId: result.insertId,
    });
  } catch (err) {
    console.error('Create court error:', err);
    res.status(500).json({ error: 'Server error creating court.' });
  }
};

/**
 * PUT /api/courts/:id
 * Update court details (Admin/Staff)
 */
const updateCourt = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { court_number, sport_type, location, size_sqm, hourly_rate, description } = req.body;
    const image = req.file ? req.file.filename : undefined;

    // Check court exists
    const [existing] = await pool.query('SELECT id FROM courts WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Court not found.' });
    }

    // Check court_number uniqueness (exclude current)
    if (court_number) {
      const [dupCheck] = await pool.query('SELECT id FROM courts WHERE court_number = ? AND id != ?', [court_number, id]);
      if (dupCheck.length > 0) {
        return res.status(409).json({ error: 'Court number already in use.' });
      }
    }

    let query = 'UPDATE courts SET court_number = ?, sport_type = ?, location = ?, size_sqm = ?, hourly_rate = ?, description = ?';
    const params = [court_number, sport_type, location || null, size_sqm || null, hourly_rate, description || null];

    if (image !== undefined) {
      query += ', image = ?';
      params.push(image);
    }

    query += ' WHERE id = ?';
    params.push(id);

    await pool.query(query, params);

    res.json({ message: 'Court updated successfully.' });
  } catch (err) {
    console.error('Update court error:', err);
    res.status(500).json({ error: 'Server error updating court.' });
  }
};

/**
 * PATCH /api/courts/:id/status
 * Update facility status (available/maintenance/closed)
 */
const updateCourtStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['available', 'maintenance', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be available, maintenance, or closed.' });
    }

    const [existing] = await pool.query('SELECT id FROM courts WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Court not found.' });
    }

    await pool.query('UPDATE courts SET status = ? WHERE id = ?', [status, id]);

    res.json({ message: `Court status updated to ${status}.` });
  } catch (err) {
    console.error('Update court status error:', err);
    res.status(500).json({ error: 'Server error updating court status.' });
  }
};

// Validation rules
const createCourtValidation = [
  body('court_number').trim().notEmpty().withMessage('Court number is required'),
  body('sport_type').isIn(['basketball', 'tennis', 'badminton', 'volleyball', 'futsal', 'multi-purpose']).withMessage('Invalid sport type'),
  body('hourly_rate').isFloat({ min: 0 }).withMessage('Hourly rate must be a positive number'),
];

const updateCourtValidation = [
  body('court_number').trim().notEmpty().withMessage('Court number is required'),
  body('sport_type').isIn(['basketball', 'tennis', 'badminton', 'volleyball', 'futsal', 'multi-purpose']).withMessage('Invalid sport type'),
  body('hourly_rate').isFloat({ min: 0 }).withMessage('Hourly rate must be a positive number'),
];

module.exports = {
  getCourts,
  getPublicCourts,
  getCourtById,
  getCourtSchedule,
  createCourt,
  updateCourt,
  updateCourtStatus,
  createCourtValidation,
  updateCourtValidation,
};
