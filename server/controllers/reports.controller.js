const pool = require('../config/db');

/**
 * GET /api/dashboard/admin
 * Admin KPIs + revenue chart data
 */
const getAdminDashboard = async (req, res) => {
  try {
    // Total Collections
    const [collections] = await pool.query('SELECT COALESCE(SUM(amount_paid), 0) as total FROM payments');

    // Registered Users (staff + player)
    const [userCount] = await pool.query(
      "SELECT COUNT(*) as total FROM users WHERE role IN ('staff', 'player')"
    );

    // Court Utilization (today)
    const today = new Date().toISOString().split('T')[0];
    const [bookedHours] = await pool.query(
      `SELECT COALESCE(SUM(duration_hours), 0) as total 
       FROM reservations 
       WHERE reservation_date = ? AND status IN ('confirmed', 'completed')`,
      [today]
    );

    const [totalCourts] = await pool.query(
      "SELECT COUNT(*) as total FROM courts WHERE status = 'available'"
    );

    const operatingStart = parseInt((process.env.OPERATING_HOURS_START || '06:00').split(':')[0]);
    const operatingEnd = parseInt((process.env.OPERATING_HOURS_END || '22:00').split(':')[0]);
    const operatingHoursPerCourt = operatingEnd - operatingStart;
    const totalBookableHours = totalCourts[0].total * operatingHoursPerCourt;
    const utilization = totalBookableHours > 0 
      ? Math.round((bookedHours[0].total / totalBookableHours) * 100) 
      : 0;

    // Pending Approvals
    const [pendingUsers] = await pool.query(
      "SELECT COUNT(*) as total FROM users WHERE approval_status = 'pending'"
    );
    const [pendingReservations] = await pool.query(
      "SELECT COUNT(*) as total FROM reservations WHERE status = 'pending'"
    );
    const pendingApprovals = pendingUsers[0].total + pendingReservations[0].total;

    // Revenue Chart (last 6 months)
    const [revenueData] = await pool.query(
      `SELECT DATE_FORMAT(payment_date, '%b') as month, 
              DATE_FORMAT(payment_date, '%Y-%m') as month_key,
              SUM(amount_paid) as total
       FROM payments
       WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
       GROUP BY YEAR(payment_date), MONTH(payment_date), month, month_key
       ORDER BY month_key ASC`
    );

    // Recent Activities (last 5 payments)
    const [recentActivities] = await pool.query(
      `SELECT p.amount_paid, p.payment_date, p.payment_method,
              u.first_name, u.last_name,
              c.court_number, c.sport_type,
              r.reservation_date
       FROM payments p
       JOIN users u ON u.id = p.player_id
       JOIN billings b ON b.id = p.billing_id
       JOIN reservations r ON r.id = b.reservation_id
       JOIN courts c ON c.id = r.court_id
       ORDER BY p.payment_date DESC
       LIMIT 5`
    );

    res.json({
      kpis: {
        totalCollections: collections[0].total,
        registeredUsers: userCount[0].total,
        courtUtilization: utilization,
        pendingApprovals,
      },
      revenueChart: revenueData,
      recentActivities,
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).json({ error: 'Server error fetching admin dashboard.' });
  }
};

/**
 * GET /api/dashboard/staff
 * Staff KPIs
 */
const getStaffDashboard = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Today's bookings
    const [todayBookings] = await pool.query(
      `SELECT COUNT(*) as total FROM reservations 
       WHERE reservation_date = ? AND status IN ('confirmed', 'pending')`,
      [today]
    );

    // Today's expected collections
    const [expectedCollections] = await pool.query(
      `SELECT COALESCE(SUM(b.balance), 0) as total 
       FROM billings b
       JOIN reservations r ON r.id = b.reservation_id
       WHERE r.reservation_date = ? AND b.status IN ('unpaid', 'overdue')`,
      [today]
    );

    // Courts currently in use
    const now = new Date().toTimeString().split(' ')[0];
    const [courtsInUse] = await pool.query(
      `SELECT COUNT(DISTINCT court_id) as total FROM reservations
       WHERE reservation_date = ? AND status = 'confirmed'
       AND start_time <= ? AND end_time > ?`,
      [today, now, now]
    );

    // No-shows today
    const [noShows] = await pool.query(
      `SELECT COUNT(*) as total FROM reservations
       WHERE reservation_date = ? AND status = 'no_show'`,
      [today]
    );

    // Today's reservations list
    const [todayReservations] = await pool.query(
      `SELECT r.*, u.first_name, u.last_name, c.court_number, c.sport_type,
              b.amount_due, b.balance, b.status as billing_status
       FROM reservations r
       JOIN users u ON u.id = r.player_id
       JOIN courts c ON c.id = r.court_id
       LEFT JOIN billings b ON b.reservation_id = r.id
       WHERE r.reservation_date = ?
       ORDER BY r.start_time ASC`,
      [today]
    );

    res.json({
      kpis: {
        todayBookings: todayBookings[0].total,
        expectedCollections: expectedCollections[0].total,
        courtsInUse: courtsInUse[0].total,
        noShows: noShows[0].total,
      },
      todayReservations,
    });
  } catch (err) {
    console.error('Staff dashboard error:', err);
    res.status(500).json({ error: 'Server error fetching staff dashboard.' });
  }
};

/**
 * GET /api/dashboard/player
 * Player personal KPIs
 */
const getPlayerDashboard = async (req, res) => {
  try {
    const playerId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    // Upcoming Reservations
    const [upcoming] = await pool.query(
      `SELECT COUNT(*) as total FROM reservations
       WHERE player_id = ? AND status = 'confirmed' AND reservation_date >= ?`,
      [playerId, today]
    );

    // Outstanding Balance
    const [balance] = await pool.query(
      `SELECT COALESCE(SUM(balance), 0) as total FROM billings
       WHERE player_id = ? AND status NOT IN ('paid', 'cancelled')`,
      [playerId]
    );

    // Next Booking
    const [nextBooking] = await pool.query(
      `SELECT r.reservation_date, r.start_time, r.end_time, c.court_number, c.sport_type
       FROM reservations r
       JOIN courts c ON c.id = r.court_id
       WHERE r.player_id = ? AND r.status = 'confirmed' AND r.reservation_date >= ?
       ORDER BY r.reservation_date ASC, r.start_time ASC
       LIMIT 1`,
      [playerId, today]
    );

    // Total Paid
    const [totalPaid] = await pool.query(
      'SELECT COALESCE(SUM(amount_paid), 0) as total FROM payments WHERE player_id = ?',
      [playerId]
    );

    // Recent Payments (last 5)
    const [recentPayments] = await pool.query(
      `SELECT p.amount_paid, p.payment_date, p.payment_method,
              c.court_number, r.reservation_date
       FROM payments p
       JOIN billings b ON b.id = p.billing_id
       JOIN reservations r ON r.id = b.reservation_id
       JOIN courts c ON c.id = r.court_id
       WHERE p.player_id = ?
       ORDER BY p.payment_date DESC
       LIMIT 5`,
      [playerId]
    );

    res.json({
      kpis: {
        upcomingReservations: upcoming[0].total,
        outstandingBalance: balance[0].total,
        nextBooking: nextBooking.length > 0 ? nextBooking[0] : null,
        totalPaid: totalPaid[0].total,
      },
      recentPayments,
    });
  } catch (err) {
    console.error('Player dashboard error:', err);
    res.status(500).json({ error: 'Server error fetching player dashboard.' });
  }
};

/**
 * GET /api/reports/revenue
 * Revenue reports
 */
const getRevenueReports = async (req, res) => {
  try {
    const { period = '6months' } = req.query;

    let interval;
    switch (period) {
      case '1month': interval = 'INTERVAL 1 MONTH'; break;
      case '3months': interval = 'INTERVAL 3 MONTH'; break;
      case '1year': interval = 'INTERVAL 1 YEAR'; break;
      default: interval = 'INTERVAL 6 MONTH';
    }

    // Revenue by month
    const [monthlyRevenue] = await pool.query(
      `SELECT DATE_FORMAT(payment_date, '%Y-%m') as month,
              DATE_FORMAT(payment_date, '%b %Y') as label,
              SUM(amount_paid) as total,
              COUNT(*) as transaction_count
       FROM payments
       WHERE payment_date >= DATE_SUB(CURDATE(), ${interval})
       GROUP BY month, label
       ORDER BY month ASC`
    );

    // Revenue by sport type
    const [sportRevenue] = await pool.query(
      `SELECT c.sport_type, SUM(p.amount_paid) as total
       FROM payments p
       JOIN billings b ON b.id = p.billing_id
       JOIN reservations r ON r.id = b.reservation_id
       JOIN courts c ON c.id = r.court_id
       WHERE p.payment_date >= DATE_SUB(CURDATE(), ${interval})
       GROUP BY c.sport_type
       ORDER BY total DESC`
    );

    // Revenue by payment method
    const [methodRevenue] = await pool.query(
      `SELECT payment_method, SUM(amount_paid) as total, COUNT(*) as count
       FROM payments
       WHERE payment_date >= DATE_SUB(CURDATE(), ${interval})
       GROUP BY payment_method
       ORDER BY total DESC`
    );

    // Total revenue
    const totalRevenue = monthlyRevenue.reduce((sum, m) => sum + m.total, 0);

    res.json({
      totalRevenue,
      monthlyRevenue,
      sportRevenue,
      methodRevenue,
    });
  } catch (err) {
    console.error('Revenue reports error:', err);
    res.status(500).json({ error: 'Server error fetching revenue reports.' });
  }
};

/**
 * GET /api/reports/utilization
 * Court utilization and peak-hour reports
 */
const getUtilizationReports = async (req, res) => {
  try {
    const { period = '30days' } = req.query;

    let daysBack;
    switch (period) {
      case '7days': daysBack = 7; break;
      case '14days': daysBack = 14; break;
      case '90days': daysBack = 90; break;
      default: daysBack = 30;
    }

    // Utilization by court
    const [courtUtilization] = await pool.query(
      `SELECT c.court_number, c.sport_type,
              COALESCE(SUM(r.duration_hours), 0) as booked_hours,
              COUNT(r.id) as total_bookings
       FROM courts c
       LEFT JOIN reservations r ON r.court_id = c.id 
         AND r.reservation_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         AND r.status IN ('confirmed', 'completed')
       WHERE c.status = 'available'
       GROUP BY c.id, c.court_number, c.sport_type
       ORDER BY booked_hours DESC`,
      [daysBack]
    );

    // Peak hours (which hours have the most bookings)
    const [peakHours] = await pool.query(
      `SELECT HOUR(start_time) as hour, COUNT(*) as booking_count
       FROM reservations
       WHERE reservation_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         AND status IN ('confirmed', 'completed')
       GROUP BY HOUR(start_time)
       ORDER BY hour ASC`,
      [daysBack]
    );

    // Utilization by sport type
    const [sportUtilization] = await pool.query(
      `SELECT c.sport_type,
              COALESCE(SUM(r.duration_hours), 0) as booked_hours,
              COUNT(r.id) as total_bookings
       FROM courts c
       LEFT JOIN reservations r ON r.court_id = c.id
         AND r.reservation_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         AND r.status IN ('confirmed', 'completed')
       GROUP BY c.sport_type
       ORDER BY booked_hours DESC`,
      [daysBack]
    );

    // Top players by bookings
    const [topPlayers] = await pool.query(
      `SELECT u.first_name, u.last_name, u.email,
              COUNT(r.id) as total_bookings,
              COALESCE(SUM(r.duration_hours), 0) as total_hours,
              COALESCE(SUM(p_totals.total_paid), 0) as total_spent
       FROM users u
       JOIN reservations r ON r.player_id = u.id
         AND r.reservation_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         AND r.status IN ('confirmed', 'completed')
       LEFT JOIN (
         SELECT player_id, SUM(amount_paid) as total_paid
         FROM payments
         WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         GROUP BY player_id
       ) p_totals ON p_totals.player_id = u.id
       WHERE u.role = 'player'
       GROUP BY u.id, u.first_name, u.last_name, u.email
       ORDER BY total_bookings DESC
       LIMIT 10`,
      [daysBack, daysBack]
    );

    res.json({
      courtUtilization,
      peakHours,
      sportUtilization,
      topPlayers,
      period: `${daysBack} days`,
    });
  } catch (err) {
    console.error('Utilization reports error:', err);
    res.status(500).json({ error: 'Server error fetching utilization reports.' });
  }
};

module.exports = {
  getAdminDashboard,
  getStaffDashboard,
  getPlayerDashboard,
  getRevenueReports,
  getUtilizationReports,
};
