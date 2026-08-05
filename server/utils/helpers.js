/**
 * PlayReserve — Helper Utilities
 */

/**
 * Calculate duration in hours from start_time and end_time strings.
 * @param {string} startTime - HH:MM or HH:MM:SS
 * @param {string} endTime - HH:MM or HH:MM:SS
 * @returns {number} Duration in hours (e.g. 1.5 for 1h30m)
 */
function calculateDurationHours(startTime, endTime) {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;
  return (endMinutes - startMinutes) / 60;
}

/**
 * Generate a reference number for billings/payments.
 * Format: #BK-00001, #PY-00001
 * @param {string} prefix - 'BK' for billing, 'PY' for payment
 * @param {number} id - The record ID
 * @returns {string}
 */
function generateReference(prefix, id) {
  return `#${prefix}-${String(id).padStart(5, '0')}`;
}

/**
 * Format time string for display (e.g., "08:00" → "8:00 AM")
 * @param {string} time - HH:MM or HH:MM:SS
 * @returns {string}
 */
function formatTime12h(time) {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

module.exports = {
  calculateDurationHours,
  generateReference,
  formatTime12h,
};
