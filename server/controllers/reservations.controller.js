const pool = require('../config/db');
const { body, validationResult } = require('express-validator');
const { checkSlotConflict, checkCourtFacilityStatus, getBookedSlots } = require('../utils/conflictCheck');
const { calculateDurationHours } = require('../utils/helpers');

/**
 * GET /api/reservations
 * List reservations with filters
 */
const getReservations = async (req, res) => {
  try {
    const { player_id, court_id, status, date_from, date_to, page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT r.*, 
             u.first_name, u.last_name, u.email as player_email,
             c.court_number, c.sport_type, c.hourly_rate, c.location,
             b.id as billing_id, b.amount_due, b.balance, b.status as billing_status
      FROM reservations r
      JOIN users u ON u.id = r.player_id
      JOIN courts c ON c.id = r.court_id
      LEFT JOIN billings b ON b.reservation_id = r.id
      WHERE 1=1
    `;
    const params = [];

    // Players can only see their own reservations
    if (req.user.role === 'player') {
      query += ' AND r.player_id = ?';
      params.push(req.user.id);
    } else if (player_id) {
      query += ' AND r.player_id = ?';
      params.push(player_id);
    }

    if (court_id) {
      query += ' AND r.court_id = ?';
      params.push(court_id);
    }

    if (status) {
      query += ' AND r.status = ?';
      params.push(status);
    }

    if (date_from) {
      query += ' AND r.reservation_date >= ?';
      params.push(date_from);
    }

    if (date_to) {
      query += ' AND r.reservation_date <= ?';
      params.push(date_to);
    }

    // Count total
    const countQuery = query.replace(/SELECT .+ FROM/s, 'SELECT COUNT(*) as total FROM');
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    // Get paginated results
    query += ' ORDER BY r.reservation_date DESC, r.start_time DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const [reservations] = await pool.query(query, params);

    res.json({
      reservations,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('Get reservations error:', err);
    res.status(500).json({ error: 'Server error fetching reservations.' });
  }
};

/**
 * GET /api/reservations/pending
 * List pending reservations for admin approval
 */
const getPendingReservations = async (req, res) => {
  try {
    const [reservations] = await pool.query(
      `SELECT r.*, 
              u.first_name, u.last_name, u.email as player_email,
              c.court_number, c.sport_type, c.hourly_rate,
              b.id as billing_id, b.amount_due, b.balance, b.status as billing_status
       FROM reservations r
       JOIN users u ON u.id = r.player_id
       JOIN courts c ON c.id = r.court_id
       LEFT JOIN billings b ON b.reservation_id = r.id
       WHERE r.status = 'pending'
       ORDER BY r.reservation_date ASC, r.start_time ASC`
    );

    res.json({ reservations });
  } catch (err) {
    console.error('Get pending reservations error:', err);
    res.status(500).json({ error: 'Server error fetching pending reservations.' });
  }
};

/**
 * POST /api/reservations/check-availability
 * Run the conflict-check query and return availability
 */
const checkAvailability = async (req, res) => {
  try {
    const { court_id, reservation_date, start_time, end_time } = req.body;

    if (!court_id || !reservation_date || !start_time || !end_time) {
      return res.status(400).json({ error: 'court_id, reservation_date, start_time, and end_time are required.' });
    }

    const connection = await pool.getConnection();
    try {
      // Check facility status first
      const facilityStatus = await checkCourtFacilityStatus(connection, court_id);
      if (!facilityStatus.available) {
        return res.json({
          available: false,
          reason: `Court is currently ${facilityStatus.status}.`,
        });
      }

      // Check time-slot conflict
      const conflict = await checkSlotConflict(connection, court_id, reservation_date, start_time, end_time);

      if (conflict.hasConflict) {
        return res.json({
          available: false,
          reason: 'Time slot conflicts with an existing reservation.',
          conflictingReservations: conflict.conflictingReservations,
        });
      }

      // Calculate cost preview
      const durationHours = calculateDurationHours(start_time, end_time);
      const estimatedCost = facilityStatus.court.hourly_rate * durationHours;

      res.json({
        available: true,
        court: facilityStatus.court,
        durationHours,
        estimatedCost,
      });
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('Check availability error:', err);
    res.status(500).json({ error: 'Server error checking availability.' });
  }
};

/**
 * POST /api/reservations
 * Create reservation + auto-create billing (inside a DB transaction)
 * This re-checks the conflict under the transaction to prevent race-condition double-bookings.
 */
const createReservation = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      connection.release();
      return res.status(400).json({ errors: errors.array() });
    }

    const { court_id, reservation_date, start_time, end_time, notes, player_id: requestedPlayerId } = req.body;

    // Determine player_id: for staff/admin walk-ins, use the provided player_id
    let playerId = req.user.id;
    let createdByStaffId = null;

    if (req.user.role === 'staff' || req.user.role === 'admin') {
      if (requestedPlayerId) {
        playerId = requestedPlayerId;
        createdByStaffId = req.user.id;
      }
    }

    await connection.beginTransaction();

    try {
      // 1. Check facility status
      const facilityStatus = await checkCourtFacilityStatus(connection, court_id);
      if (!facilityStatus.available) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({ error: `Court is currently ${facilityStatus.status}. Cannot book.` });
      }

      // 2. Re-check conflict within the transaction (race-condition protection)
      const conflict = await checkSlotConflict(connection, court_id, reservation_date, start_time, end_time);
      if (conflict.hasConflict) {
        await connection.rollback();
        connection.release();
        return res.status(409).json({
          error: 'Slot no longer available. Another booking was just made.',
          conflictingReservations: conflict.conflictingReservations,
        });
      }

      // 3. Verify player exists and is active/approved
      const [playerCheck] = await connection.query(
        "SELECT id, status, approval_status FROM users WHERE id = ? AND role = 'player'",
        [playerId]
      );
      if (playerCheck.length === 0) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({ error: 'Player not found.' });
      }
      if (playerCheck[0].status !== 'active' || playerCheck[0].approval_status !== 'approved') {
        await connection.rollback();
        connection.release();
        return res.status(400).json({ error: 'Player account is not active or not approved.' });
      }

      // 4. Calculate duration and amount
      const durationHours = calculateDurationHours(start_time, end_time);
      if (durationHours <= 0) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({ error: 'End time must be after start time.' });
      }

      const amountDue = facilityStatus.court.hourly_rate * durationHours;

      // 5. Create reservation
      const [reservationResult] = await connection.query(
        `INSERT INTO reservations (player_id, court_id, reservation_date, start_time, end_time, duration_hours, status, created_by_staff_id, notes)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [playerId, court_id, reservation_date, start_time, end_time, durationHours, createdByStaffId, notes || null]
      );
      const reservationId = reservationResult.insertId;

      // 6. Auto-create billing
      await connection.query(
        `INSERT INTO billings (player_id, reservation_id, amount_due, downpayment, balance, due_date, status)
         VALUES (?, ?, ?, 0, ?, ?, 'unpaid')`,
        [playerId, reservationId, amountDue, amountDue, reservation_date]
      );

      await connection.commit();

      res.status(201).json({
        message: 'Reservation created successfully. Payment required to confirm.',
        reservationId,
        amountDue,
        durationHours,
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    }
  } catch (err) {
    console.error('Create reservation error:', err);
    res.status(500).json({ error: 'Server error creating reservation.' });
  } finally {
    connection.release();
  }
};

/**
 * PATCH /api/reservations/:id/approve
 * Admin approves a pending reservation (re-verify no conflict)
 */
const approveReservation = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { id } = req.params;

    await connection.beginTransaction();

    // Get reservation details
    const [reservations] = await connection.query(
      'SELECT * FROM reservations WHERE id = ? AND status = ?',
      [id, 'pending']
    );

    if (reservations.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: 'Pending reservation not found.' });
    }

    const reservation = reservations[0];

    // Re-verify no conflict (exclude this reservation)
    const conflict = await checkSlotConflict(
      connection,
      reservation.court_id,
      reservation.reservation_date,
      reservation.start_time,
      reservation.end_time,
      reservation.id
    );

    if (conflict.hasConflict) {
      await connection.rollback();
      connection.release();
      return res.status(409).json({
        error: 'Cannot approve — another reservation now conflicts with this slot.',
        conflictingReservations: conflict.conflictingReservations,
      });
    }

    // Approve: set reservation to confirmed
    await connection.query(
      "UPDATE reservations SET status = 'confirmed' WHERE id = ?",
      [id]
    );

    await connection.commit();

    res.json({ message: 'Reservation approved and confirmed.' });
  } catch (err) {
    await connection.rollback();
    console.error('Approve reservation error:', err);
    res.status(500).json({ error: 'Server error approving reservation.' });
  } finally {
    connection.release();
  }
};

/**
 * PATCH /api/reservations/:id/reject
 * Admin rejects a reservation (reservation→cancelled, billing→cancelled)
 */
const rejectReservation = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { id } = req.params;

    await connection.beginTransaction();

    const [reservations] = await connection.query(
      "SELECT * FROM reservations WHERE id = ? AND status IN ('pending','confirmed')",
      [id]
    );

    if (reservations.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: 'Reservation not found or already cancelled/completed.' });
    }

    // Cancel reservation and billing
    await connection.query("UPDATE reservations SET status = 'cancelled' WHERE id = ?", [id]);
    await connection.query("UPDATE billings SET status = 'cancelled' WHERE reservation_id = ?", [id]);

    await connection.commit();

    res.json({ message: 'Reservation rejected and cancelled.' });
  } catch (err) {
    await connection.rollback();
    console.error('Reject reservation error:', err);
    res.status(500).json({ error: 'Server error rejecting reservation.' });
  } finally {
    connection.release();
  }
};

/**
 * PATCH /api/reservations/:id/cancel
 * Cancel reservation with cutoff logic (§8.5):
 * - If ≥ cutoff hours before start → full refund, billing→cancelled
 * - If < cutoff hours → deposit forfeited, billing→cancelled
 */
const cancelReservation = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { id } = req.params;

    await connection.beginTransaction();

    const [reservations] = await connection.query(
      "SELECT * FROM reservations WHERE id = ? AND status IN ('pending','confirmed')",
      [id]
    );

    if (reservations.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: 'Reservation not found or already cancelled/completed.' });
    }

    const reservation = reservations[0];

    // Check if the user is allowed to cancel (own reservation or admin/staff)
    if (req.user.role === 'player' && reservation.player_id !== req.user.id) {
      await connection.rollback();
      connection.release();
      return res.status(403).json({ error: 'You can only cancel your own reservations.' });
    }

    // Check cancellation cutoff
    const cutoffHours = parseInt(process.env.CANCELLATION_CUTOFF_HOURS || '2');
    const reservationStart = new Date(`${reservation.reservation_date}T${reservation.start_time}`);
    const now = new Date();
    const hoursUntilStart = (reservationStart - now) / (1000 * 60 * 60);

    let refundMessage = '';

    if (hoursUntilStart >= cutoffHours) {
      // Full refund eligible
      refundMessage = 'Full refund will be processed.';
    } else {
      // Late cancellation — deposit forfeited
      refundMessage = 'Late cancellation — deposit is forfeited per cancellation policy.';
    }

    // Cancel reservation and billing
    await connection.query("UPDATE reservations SET status = 'cancelled' WHERE id = ?", [id]);
    await connection.query("UPDATE billings SET status = 'cancelled' WHERE reservation_id = ?", [id]);

    await connection.commit();

    res.json({
      message: `Reservation cancelled. ${refundMessage}`,
      hoursUntilStart: Math.round(hoursUntilStart * 100) / 100,
      cutoffHours,
    });
  } catch (err) {
    await connection.rollback();
    console.error('Cancel reservation error:', err);
    res.status(500).json({ error: 'Server error cancelling reservation.' });
  } finally {
    connection.release();
  }
};

// Validation rules
const createReservationValidation = [
  body('court_id').isInt({ min: 1 }).withMessage('Valid court ID is required'),
  body('reservation_date').isDate().withMessage('Valid date (YYYY-MM-DD) is required'),
  body('start_time').matches(/^\d{2}:\d{2}(:\d{2})?$/).withMessage('Valid start time (HH:MM) is required'),
  body('end_time').matches(/^\d{2}:\d{2}(:\d{2})?$/).withMessage('Valid end time (HH:MM) is required'),
];

module.exports = {
  getReservations,
  getPendingReservations,
  checkAvailability,
  createReservation,
  approveReservation,
  rejectReservation,
  cancelReservation,
  createReservationValidation,
};
