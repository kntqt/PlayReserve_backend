/**
 * PlayReserve — Court Availability / Conflict-Checking Utility
 * 
 * This is the CORE algorithm from spec §8.4.
 * 
 * A slot is bookable only if no existing 'pending' or 'confirmed' reservations
 * overlap with the requested time range on the same court and date.
 * 
 * Overlap condition: new_start < existing_end AND new_end > existing_start
 * 
 * This function is called:
 * 1. When rendering the schedule/calendar (to grey out taken slots)
 * 2. Inside the reservation-creation transaction (to prevent race-condition double-bookings)
 */

/**
 * Check if a time slot conflicts with existing reservations.
 * 
 * @param {object} connection - MySQL connection (from pool.getConnection() for transaction safety)
 * @param {number} courtId - The court ID
 * @param {string} date - The reservation date (YYYY-MM-DD)
 * @param {string} startTime - Start time (HH:MM:SS or HH:MM)
 * @param {string} endTime - End time (HH:MM:SS or HH:MM)
 * @param {number|null} excludeReservationId - Optional: exclude this reservation from the check (for edits)
 * @returns {Promise<{ hasConflict: boolean, conflictingReservations: Array }>}
 */
async function checkSlotConflict(connection, courtId, date, startTime, endTime, excludeReservationId = null) {
  let query = `
    SELECT r.id, r.start_time, r.end_time, r.status, 
           u.first_name, u.last_name
    FROM reservations r
    JOIN users u ON u.id = r.player_id
    WHERE r.court_id = ?
      AND r.reservation_date = ?
      AND r.status IN ('pending', 'confirmed')
      AND (? < r.end_time AND ? > r.start_time)
  `;
  const params = [courtId, date, startTime, endTime];

  if (excludeReservationId) {
    query += ' AND r.id != ?';
    params.push(excludeReservationId);
  }

  query += ' LIMIT 5';

  const [rows] = await connection.query(query, params);

  return {
    hasConflict: rows.length > 0,
    conflictingReservations: rows,
  };
}

/**
 * Get all booked slots for a court on a specific date.
 * Used to render the schedule/calendar and grey out taken slots.
 * 
 * @param {object} connection - MySQL connection
 * @param {number} courtId - The court ID
 * @param {string} date - The date (YYYY-MM-DD)
 * @returns {Promise<Array>} Array of booked slot objects
 */
async function getBookedSlots(connection, courtId, date) {
  const [rows] = await connection.query(
    `SELECT r.id, r.start_time, r.end_time, r.duration_hours, r.status,
            u.first_name, u.last_name, u.id as player_id
     FROM reservations r
     JOIN users u ON u.id = r.player_id
     WHERE r.court_id = ?
       AND r.reservation_date = ?
       AND r.status IN ('pending', 'confirmed')
     ORDER BY r.start_time ASC`,
    [courtId, date]
  );

  return rows;
}

/**
 * Check if a court is available at the facility level.
 * Courts with status 'maintenance' or 'closed' block ALL bookings.
 * 
 * @param {object} connection - MySQL connection
 * @param {number} courtId - The court ID
 * @returns {Promise<{ available: boolean, status: string, court: object|null }>}
 */
async function checkCourtFacilityStatus(connection, courtId) {
  const [rows] = await connection.query(
    'SELECT id, court_number, status, hourly_rate, sport_type FROM courts WHERE id = ?',
    [courtId]
  );

  if (rows.length === 0) {
    return { available: false, status: 'not_found', court: null };
  }

  const court = rows[0];
  return {
    available: court.status === 'available',
    status: court.status,
    court,
  };
}

module.exports = {
  checkSlotConflict,
  getBookedSlots,
  checkCourtFacilityStatus,
};
