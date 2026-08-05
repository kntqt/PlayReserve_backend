/**
 * PlayReserve — Database Seed Script
 * 
 * Creates demo data:
 * - 1 Admin, 1 Staff, 2 Players (1 approved, 1 pending)
 * - 6 Courts across all sport types
 * - 3 Demo reservations with billings and payments
 * 
 * Usage: node database/seed.js
 * 
 * Credential pattern (from spec §12):
 *   Email:    {firstname}{lastname}@playreserve.com  (lowercase)
 *   Password: {Firstname}1234
 */

const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const BCRYPT_ROUNDS = 12;

async function seed() {
  // Connect without specifying database first (to create it if needed)
  const rootConnection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
    charset: 'utf8mb4',
  });

  try {
    console.log('🔄 Creating database and tables...');

    // Read and execute schema
    const fs = require('fs');
    const path = require('path');
    const schemaSQL = fs.readFileSync(
      path.join(__dirname, 'schema.sql'),
      'utf8'
    );
    await rootConnection.query(schemaSQL);
    console.log('✅ Database schema created successfully');
  } catch (err) {
    console.error('❌ Schema creation failed:', err.message);
    throw err;
  } finally {
    await rootConnection.end();
  }

  // Now connect to the created database
  const pool = await mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'playreserve_db',
    charset: 'utf8mb4',
    decimalNumbers: true,
  });

  const connection = await pool.getConnection();

  try {
    // Clear existing data (in reverse FK order)
    console.log('🔄 Clearing existing data...');
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    await connection.query('TRUNCATE TABLE payments');
    await connection.query('TRUNCATE TABLE billings');
    await connection.query('TRUNCATE TABLE reservations');
    await connection.query('TRUNCATE TABLE courts');
    await connection.query('TRUNCATE TABLE users');
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    // ========================================
    // SEED USERS
    // ========================================
    console.log('🔄 Seeding users...');

    const users = [
      {
        role: 'admin',
        first_name: 'Admin',
        middle_name: null,
        last_name: 'User',
        email: 'adminuser@playreserve.com',
        password: 'Admin1234',
        contact_number: '09171234567',
        address: 'PlayReserve Admin Office, Manila',
        gender: 'Male',
        status: 'active',
        approval_status: 'approved',
      },
      {
        role: 'staff',
        first_name: 'Juan',
        middle_name: 'Santos',
        last_name: 'Dela Cruz',
        email: 'juandelacruz@playreserve.com',
        password: 'Juan1234',
        contact_number: '09181234567',
        address: '123 Court St, Quezon City',
        gender: 'Male',
        status: 'active',
        approval_status: 'approved',
      },
      {
        role: 'player',
        first_name: 'Mark',
        middle_name: null,
        last_name: 'Cruz',
        email: 'markcruz@playreserve.com',
        password: 'Mark1234',
        contact_number: '09191234567',
        address: '456 Hoop Ave, Makati',
        gender: 'Male',
        status: 'active',
        approval_status: 'approved',
      },
      {
        role: 'player',
        first_name: 'Anna',
        middle_name: 'Marie',
        last_name: 'Santos',
        email: 'annasantos@playreserve.com',
        password: 'Anna1234',
        contact_number: '09201234567',
        address: '789 Net Blvd, Pasig',
        gender: 'Female',
        status: 'inactive',
        approval_status: 'pending',
      },
    ];

    for (const user of users) {
      const hashedPassword = await bcrypt.hash(user.password, BCRYPT_ROUNDS);
      await connection.query(
        `INSERT INTO users (role, first_name, middle_name, last_name, email, password, contact_number, address, gender, status, approval_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.role,
          user.first_name,
          user.middle_name,
          user.last_name,
          user.email,
          hashedPassword,
          user.contact_number,
          user.address,
          user.gender,
          user.status,
          user.approval_status,
        ]
      );
    }
    console.log(`✅ Seeded ${users.length} users`);

    // ========================================
    // SEED COURTS
    // ========================================
    console.log('🔄 Seeding courts...');

    const courts = [
      {
        court_number: 'COURT-01',
        sport_type: 'basketball',
        location: 'Outdoor Field A',
        size_sqm: 420.00,
        hourly_rate: 500.00,
        status: 'available',
        description: 'Full-size outdoor basketball court with LED lights for night games. Hardwood-quality concrete flooring.',
      },
      {
        court_number: 'COURT-02',
        sport_type: 'tennis',
        location: 'Outdoor Field B',
        size_sqm: 260.00,
        hourly_rate: 400.00,
        status: 'available',
        description: 'Standard tennis court with synthetic grass surface. Complete with net and line markings.',
      },
      {
        court_number: 'COURT-03',
        sport_type: 'badminton',
        location: 'Covered Area A',
        size_sqm: 81.74,
        hourly_rate: 300.00,
        status: 'available',
        description: 'Covered badminton court with professional-grade vinyl flooring and proper ceiling height.',
      },
      {
        court_number: 'COURT-04',
        sport_type: 'volleyball',
        location: 'Outdoor Field C',
        size_sqm: 162.00,
        hourly_rate: 450.00,
        status: 'available',
        description: 'Sand volleyball court perfect for beach volleyball enthusiasts. Professional net system included.',
      },
      {
        court_number: 'COURT-05',
        sport_type: 'futsal',
        location: 'Outdoor Field D',
        size_sqm: 800.00,
        hourly_rate: 600.00,
        status: 'available',
        description: 'Full-size futsal pitch with artificial turf. Includes goals and boundary markings.',
      },
      {
        court_number: 'COURT-06',
        sport_type: 'multi-purpose',
        location: 'Covered Area B',
        size_sqm: 500.00,
        hourly_rate: 550.00,
        status: 'maintenance',
        description: 'Large multi-purpose court that can be configured for basketball, volleyball, or badminton. Currently under maintenance.',
      },
    ];

    for (const court of courts) {
      await connection.query(
        `INSERT INTO courts (court_number, sport_type, location, size_sqm, hourly_rate, status, description)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          court.court_number,
          court.sport_type,
          court.location,
          court.size_sqm,
          court.hourly_rate,
          court.status,
          court.description,
        ]
      );
    }
    console.log(`✅ Seeded ${courts.length} courts`);

    // ========================================
    // SEED DEMO RESERVATIONS + BILLINGS + PAYMENTS
    // ========================================
    console.log('🔄 Seeding demo reservations, billings, and payments...');

    // Get player Mark's ID (id=3) and staff Juan's ID (id=2)
    const [playerRows] = await connection.query(
      "SELECT id FROM users WHERE email = 'markcruz@playreserve.com'"
    );
    const playerId = playerRows[0].id;

    const [staffRows] = await connection.query(
      "SELECT id FROM users WHERE email = 'juandelacruz@playreserve.com'"
    );
    const staffId = staffRows[0].id;

    // Use future dates relative to "today"
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfterTomorrow = new Date(today);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    const formatDate = (d) => d.toISOString().split('T')[0];

    // Reservation 1: Confirmed basketball booking (tomorrow, paid in full)
    const [res1] = await connection.query(
      `INSERT INTO reservations (player_id, court_id, reservation_date, start_time, end_time, duration_hours, status, notes)
       VALUES (?, 1, ?, '08:00:00', '10:00:00', 2.00, 'confirmed', 'Regular morning basketball session')`,
      [playerId, formatDate(tomorrow)]
    );
    const reservation1Id = res1.insertId;

    await connection.query(
      `INSERT INTO billings (player_id, reservation_id, amount_due, downpayment, balance, due_date, status)
       VALUES (?, ?, 1000.00, 500.00, 0.00, ?, 'paid')`,
      [playerId, reservation1Id, formatDate(tomorrow)]
    );
    const [billing1] = await connection.query('SELECT LAST_INSERT_ID() as id');
    const billing1Id = billing1[0].id;

    // Deposit payment
    await connection.query(
      `INSERT INTO payments (billing_id, player_id, amount_paid, payment_type, balance_after, payment_date, payment_method, received_by_staff_id)
       VALUES (?, ?, 500.00, 'deposit', 500.00, NOW(), 'Cash', ?)`,
      [billing1Id, playerId, staffId]
    );

    // Balance settlement payment
    await connection.query(
      `INSERT INTO payments (billing_id, player_id, amount_paid, payment_type, balance_after, payment_date, payment_method, received_by_staff_id)
       VALUES (?, ?, 500.00, 'balance_settlement', 0.00, NOW(), 'Cash', ?)`,
      [billing1Id, playerId, staffId]
    );

    // Reservation 2: Pending tennis booking (day after tomorrow, deposit paid)
    const [res2] = await connection.query(
      `INSERT INTO reservations (player_id, court_id, reservation_date, start_time, end_time, duration_hours, status, notes)
       VALUES (?, 2, ?, '14:00:00', '16:00:00', 2.00, 'pending', 'Tennis practice with friends')`,
      [playerId, formatDate(dayAfterTomorrow)]
    );
    const reservation2Id = res2.insertId;

    await connection.query(
      `INSERT INTO billings (player_id, reservation_id, amount_due, downpayment, balance, due_date, status)
       VALUES (?, ?, 800.00, 400.00, 400.00, ?, 'unpaid')`,
      [playerId, reservation2Id, formatDate(dayAfterTomorrow)]
    );
    const [billing2] = await connection.query('SELECT LAST_INSERT_ID() as id');
    const billing2Id = billing2[0].id;

    await connection.query(
      `INSERT INTO payments (billing_id, player_id, amount_paid, payment_type, balance_after, payment_date, payment_method, received_by_staff_id)
       VALUES (?, ?, 400.00, 'deposit', 400.00, NOW(), 'GCash', ?)`,
      [billing2Id, playerId, staffId]
    );

    // Reservation 3: Walk-in badminton booking (next week, created by staff, pending payment)
    const [res3] = await connection.query(
      `INSERT INTO reservations (player_id, court_id, reservation_date, start_time, end_time, duration_hours, status, created_by_staff_id, notes)
       VALUES (?, 3, ?, '10:00:00', '11:30:00', 1.50, 'pending', ?, 'Walk-in booking for badminton doubles')`,
      [playerId, formatDate(nextWeek), staffId]
    );
    const reservation3Id = res3.insertId;

    await connection.query(
      `INSERT INTO billings (player_id, reservation_id, amount_due, downpayment, balance, due_date, status)
       VALUES (?, ?, 450.00, 0.00, 450.00, ?, 'unpaid')`,
      [playerId, reservation3Id, formatDate(nextWeek)]
    );

    console.log('✅ Seeded 3 demo reservations with billings and payments');

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n========================================');
    console.log('🎉 PlayReserve database seeded successfully!');
    console.log('========================================');
    console.log('\n📋 Seeded accounts:');
    console.log('┌──────────┬─────────────────────────────────────┬──────────────┐');
    console.log('│ Role     │ Email                               │ Password     │');
    console.log('├──────────┼─────────────────────────────────────┼──────────────┤');
    console.log('│ Admin    │ adminuser@playreserve.com           │ Admin1234    │');
    console.log('│ Staff    │ juandelacruz@playreserve.com        │ Juan1234     │');
    console.log('│ Player   │ markcruz@playreserve.com            │ Mark1234     │');
    console.log('│ Player*  │ annasantos@playreserve.com          │ Anna1234     │');
    console.log('└──────────┴─────────────────────────────────────┴──────────────┘');
    console.log('  * = pending approval (cannot log in yet)\n');
    console.log(`📋 Seeded ${courts.length} courts across all sport types`);
    console.log('📋 Seeded 3 demo reservations (1 confirmed, 2 pending)');
    console.log('📋 Seeded 3 payments\n');
  } catch (err) {
    console.error('❌ Seeding failed:', err.message);
    console.error(err);
    throw err;
  } finally {
    connection.release();
    await pool.end();
  }
}

seed()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
