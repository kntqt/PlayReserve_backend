const pool = require('../config/db');
const { body, validationResult } = require('express-validator');

/**
 * GET /api/billings
 * List billings with search
 */
const getBillings = async (req, res) => {
  try {
    const { search, status, page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT b.*, 
             u.first_name, u.last_name, u.email as player_email,
             r.reservation_date, r.start_time, r.end_time, r.duration_hours, r.status as reservation_status,
             c.court_number, c.sport_type
      FROM billings b
      JOIN users u ON u.id = b.player_id
      JOIN reservations r ON r.id = b.reservation_id
      JOIN courts c ON c.id = r.court_id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      query += ' AND b.status = ?';
      params.push(status);
    }

    if (search) {
      query += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR c.court_number LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // If player, only show their own
    if (req.user && req.user.role === 'player') {
      query += ' AND b.player_id = ?';
      params.push(req.user.id);
    }

    const countQuery = query.replace(/SELECT .+ FROM/s, 'SELECT COUNT(*) as total FROM');
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    query += ' ORDER BY b.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const [billings] = await pool.query(query, params);

    res.json({
      billings,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('Get billings error:', err);
    res.status(500).json({ error: 'Server error fetching billings.' });
  }
};

/**
 * POST /api/billings/setup
 * Staff creates billing for a reservation + optional deposit payment
 * Implements the Booking Setup logic from spec §7.3
 */
const setupBilling = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      connection.release();
      return res.status(400).json({ errors: errors.array() });
    }

    const { reservation_id, down_payment = 0, due_date, payment_method = 'Cash', reference_number } = req.body;

    await connection.beginTransaction();

    // 1. Get reservation with court details
    const [reservations] = await connection.query(
      `SELECT r.*, c.hourly_rate, c.court_number
       FROM reservations r
       JOIN courts c ON c.id = r.court_id
       WHERE r.id = ?`,
      [reservation_id]
    );

    if (reservations.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: 'Reservation not found.' });
    }

    const reservation = reservations[0];

    // 2. Check if billing already exists for this reservation
    const [existingBilling] = await connection.query(
      'SELECT id FROM billings WHERE reservation_id = ?',
      [reservation_id]
    );

    if (existingBilling.length > 0) {
      await connection.rollback();
      connection.release();
      return res.status(409).json({ error: 'Billing already exists for this reservation.' });
    }

    // 3. Calculate amount_due = hourly_rate * duration_hours
    const amountDue = reservation.hourly_rate * reservation.duration_hours;
    const downPayment = parseFloat(down_payment);
    const balance = amountDue - downPayment;
    const billingStatus = balance <= 0 ? 'paid' : 'unpaid';
    const billingDueDate = due_date || reservation.reservation_date;

    // 4. Insert billing record
    const [billingResult] = await connection.query(
      `INSERT INTO billings (player_id, reservation_id, amount_due, downpayment, balance, due_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [reservation.player_id, reservation_id, amountDue, downPayment, Math.max(balance, 0), billingDueDate, billingStatus]
    );
    const billingId = billingResult.insertId;

    // 5. If down_payment > 0, insert payment record
    if (downPayment > 0) {
      const paymentType = balance <= 0 ? 'full' : 'deposit';
      await connection.query(
        `INSERT INTO payments (billing_id, player_id, amount_paid, payment_type, balance_after, payment_date, payment_method, reference_number, received_by_staff_id)
         VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?)`,
        [billingId, reservation.player_id, downPayment, paymentType, Math.max(balance, 0), payment_method, reference_number || null, req.user.id]
      );
    }

    // 6. If fully paid, auto-confirm the reservation
    if (billingStatus === 'paid') {
      await connection.query(
        "UPDATE reservations SET status = 'confirmed' WHERE id = ?",
        [reservation_id]
      );
    }

    await connection.commit();

    res.status(201).json({
      message: `Billing created successfully.${billingStatus === 'paid' ? ' Reservation auto-confirmed (fully paid).' : ''}`,
      billingId,
      amountDue,
      downPayment,
      balance: Math.max(balance, 0),
      status: billingStatus,
    });
  } catch (err) {
    await connection.rollback();
    console.error('Setup billing error:', err);
    res.status(500).json({ error: 'Server error setting up billing.' });
  } finally {
    connection.release();
  }
};

/**
 * PATCH /api/billings/:id/status
 * Update billing status
 */
const updateBillingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['unpaid', 'paid', 'overdue', 'waived', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid billing status.' });
    }

    const [existing] = await pool.query('SELECT id FROM billings WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Billing not found.' });
    }

    await pool.query('UPDATE billings SET status = ? WHERE id = ?', [status, id]);

    res.json({ message: `Billing status updated to ${status}.` });
  } catch (err) {
    console.error('Update billing status error:', err);
    res.status(500).json({ error: 'Server error updating billing status.' });
  }
};

/**
 * DELETE /api/billings/:id
 * Delete billing (only if unpaid)
 */
const deleteBilling = async (req, res) => {
  try {
    const { id } = req.params;

    const [billings] = await pool.query('SELECT id, status FROM billings WHERE id = ?', [id]);
    if (billings.length === 0) {
      return res.status(404).json({ error: 'Billing not found.' });
    }

    if (billings[0].status !== 'unpaid') {
      return res.status(400).json({ error: 'Only unpaid billings can be deleted.' });
    }

    await pool.query('DELETE FROM billings WHERE id = ?', [id]);

    res.json({ message: 'Billing deleted successfully.' });
  } catch (err) {
    console.error('Delete billing error:', err);
    res.status(500).json({ error: 'Server error deleting billing.' });
  }
};

// Validation rules
const setupBillingValidation = [
  body('reservation_id').isInt({ min: 1 }).withMessage('Valid reservation ID is required'),
  body('down_payment').optional().isFloat({ min: 0 }).withMessage('Down payment must be a positive number'),
];

module.exports = {
  getBillings,
  setupBilling,
  updateBillingStatus,
  deleteBilling,
  setupBillingValidation,
};
