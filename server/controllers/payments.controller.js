const pool = require('../config/db');
const { body, validationResult } = require('express-validator');

/**
 * GET /api/payments
 * List recent payments (limit 30)
 */
const getPayments = async (req, res) => {
  try {
    const { search, page = 1, limit = 30 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT p.*,
             u.first_name, u.last_name, u.email as player_email,
             b.amount_due, b.reservation_id,
             r.reservation_date, r.start_time, r.end_time,
             c.court_number, c.sport_type,
             s.first_name as staff_first_name, s.last_name as staff_last_name
      FROM payments p
      JOIN users u ON u.id = p.player_id
      JOIN billings b ON b.id = p.billing_id
      JOIN reservations r ON r.id = b.reservation_id
      JOIN courts c ON c.id = r.court_id
      LEFT JOIN users s ON s.id = p.received_by_staff_id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      query += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR c.court_number LIKE ? OR p.reference_number LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    const countQuery = query.replace(/SELECT .+ FROM/s, 'SELECT COUNT(*) as total FROM');
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    query += ' ORDER BY p.payment_date DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const [payments] = await pool.query(query, params);

    res.json({
      payments,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('Get payments error:', err);
    res.status(500).json({ error: 'Server error fetching payments.' });
  }
};

/**
 * GET /api/payments/player/:id
 * Get a player's payment history
 */
const getPlayerPayments = async (req, res) => {
  try {
    const { id } = req.params;

    // Players can only view their own payments
    if (req.user.role === 'player' && req.user.id !== parseInt(id)) {
      return res.status(403).json({ error: 'You can only view your own payments.' });
    }

    const [payments] = await pool.query(
      `SELECT p.*,
              b.amount_due, b.reservation_id,
              r.reservation_date, r.start_time, r.end_time,
              c.court_number, c.sport_type
       FROM payments p
       JOIN billings b ON b.id = p.billing_id
       JOIN reservations r ON r.id = b.reservation_id
       JOIN courts c ON c.id = r.court_id
       WHERE p.player_id = ?
       ORDER BY p.payment_date DESC`,
      [id]
    );

    res.json({ payments });
  } catch (err) {
    console.error('Get player payments error:', err);
    res.status(500).json({ error: 'Server error fetching player payments.' });
  }
};

/**
 * POST /api/payments
 * Record payment with FIFO logic (§8.3)
 * 
 * Pseudocode from spec:
 * 1. Fetch all unpaid billings for the player, ordered oldest reservation_date first
 * 2. Apply payment amount across billings sequentially
 * 3. Update each billing's balance and status
 * 4. If a billing reaches balance=0, promote its reservation to 'confirmed'
 * 5. Insert payment record with balance_after snapshot
 * 6. All steps in a single transaction
 */
const recordPayment = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      connection.release();
      return res.status(400).json({ errors: errors.array() });
    }

    const { player_id, billing_id, amount, payment_type = 'deposit', payment_method = 'Cash', reference_number } = req.body;

    let amountToApply = parseFloat(amount);

    if (amountToApply <= 0) {
      connection.release();
      return res.status(400).json({ error: 'Payment amount must be greater than zero.' });
    }

    await connection.beginTransaction();

    try {
      // If a specific billing_id is provided, apply to that billing
      // Otherwise, use FIFO (oldest unpaid billing first)
      let billings;

      if (billing_id) {
        [billings] = await connection.query(
          `SELECT b.*, r.reservation_date, r.id as res_id
           FROM billings b
           JOIN reservations r ON r.id = b.reservation_id
           WHERE b.id = ? AND b.player_id = ? AND b.status IN ('unpaid', 'overdue')
           ORDER BY r.reservation_date ASC`,
          [billing_id, player_id]
        );
      } else {
        [billings] = await connection.query(
          `SELECT b.*, r.reservation_date, r.id as res_id
           FROM billings b
           JOIN reservations r ON r.id = b.reservation_id
           WHERE b.player_id = ? AND b.status IN ('unpaid', 'overdue')
           ORDER BY r.reservation_date ASC`,
          [player_id]
        );
      }

      if (billings.length === 0) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({ error: 'No unpaid billings found for this player.' });
      }

      // Validate amount doesn't exceed total unpaid balance
      const totalUnpaid = billings.reduce((sum, b) => sum + b.balance, 0);
      if (amountToApply > totalUnpaid) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          error: `Payment amount (${amountToApply}) exceeds total unpaid balance (${totalUnpaid}).`,
        });
      }

      // Apply payment across billings (FIFO)
      const paymentRecords = [];
      let remainingAmount = amountToApply;

      for (const billing of billings) {
        if (remainingAmount <= 0) break;

        const applyAmount = Math.min(remainingAmount, billing.balance);
        const newBalance = billing.balance - applyAmount;
        const newStatus = newBalance <= 0 ? 'paid' : billing.status;

        // Update billing
        await connection.query(
          'UPDATE billings SET balance = ?, status = ? WHERE id = ?',
          [Math.max(newBalance, 0), newStatus, billing.id]
        );

        // Insert payment record
        const [paymentResult] = await connection.query(
          `INSERT INTO payments (billing_id, player_id, amount_paid, payment_type, balance_after, payment_date, payment_method, reference_number, received_by_staff_id)
           VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?)`,
          [billing.id, player_id, applyAmount, payment_type, Math.max(newBalance, 0), payment_method, reference_number || null, req.user.role !== 'player' ? req.user.id : null]
        );

        // If billing is fully paid, auto-confirm the reservation
        if (newBalance <= 0) {
          await connection.query(
            "UPDATE reservations SET status = 'confirmed' WHERE id = ? AND status = 'pending'",
            [billing.res_id]
          );
        }

        paymentRecords.push({
          paymentId: paymentResult.insertId,
          billingId: billing.id,
          amountApplied: applyAmount,
          balanceAfter: Math.max(newBalance, 0),
          billingStatus: newStatus,
        });

        remainingAmount -= applyAmount;
      }

      await connection.commit();

      res.status(201).json({
        message: 'Payment recorded successfully.',
        totalPaid: amountToApply,
        paymentRecords,
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    }
  } catch (err) {
    console.error('Record payment error:', err);
    res.status(500).json({ error: 'Server error recording payment.' });
  } finally {
    connection.release();
  }
};

// Validation rules
const recordPaymentValidation = [
  body('player_id').isInt({ min: 1 }).withMessage('Valid player ID is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Payment amount must be greater than zero'),
  body('payment_type').optional().isIn(['deposit', 'full', 'balance_settlement']).withMessage('Invalid payment type'),
  body('payment_method').optional().trim(),
];

module.exports = {
  getPayments,
  getPlayerPayments,
  recordPayment,
  recordPaymentValidation,
};
