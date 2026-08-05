const pool = require('../config/db');

/**
 * GET /api/players/lookup?email=...
 * AJAX player lookup by email for staff walk-in bookings
 */
const lookupPlayerByEmail = async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: 'Email parameter is required.' });
    }

    const [players] = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.contact_number, u.status, u.approval_status,
              COALESCE(SUM(b.balance), 0) as unpaid_balance
       FROM users u
       LEFT JOIN billings b ON b.player_id = u.id AND b.status IN ('unpaid', 'overdue')
       WHERE u.email = ? AND u.role = 'player'
       GROUP BY u.id`,
      [email]
    );

    if (players.length === 0) {
      return res.status(404).json({ error: 'Player not found.' });
    }

    res.json({ player: players[0] });
  } catch (err) {
    console.error('Player lookup error:', err);
    res.status(500).json({ error: 'Server error looking up player.' });
  }
};

/**
 * GET /api/players
 * List players with booking history & outstanding balance summary
 */
const getPlayers = async (req, res) => {
  try {
    const { search, page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT u.id, u.first_name, u.middle_name, u.last_name, u.email, u.contact_number, u.status, u.approval_status, u.created_at,
             COUNT(DISTINCT r.id) as total_reservations,
             COALESCE(SUM(b.balance), 0) as unpaid_balance
      FROM users u
      LEFT JOIN reservations r ON r.player_id = u.id
      LEFT JOIN billings b ON b.player_id = u.id AND b.status IN ('unpaid', 'overdue')
      WHERE u.role = 'player'
    `;
    const params = [];

    if (search) {
      query += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    query += ' GROUP BY u.id';

    // Count total
    const countQuery = `SELECT COUNT(DISTINCT id) as total FROM users WHERE role = 'player' ${search ? 'AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)' : ''}`;
    const countParams = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [];
    const [countResult] = await pool.query(countQuery, countParams);
    const total = countResult[0].total;

    query += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const [players] = await pool.query(query, params);

    res.json({
      players,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('Get players error:', err);
    res.status(500).json({ error: 'Server error fetching players.' });
  }
};

module.exports = {
  lookupPlayerByEmail,
  getPlayers,
};
