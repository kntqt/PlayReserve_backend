-- ============================================
-- PlayReserve — Full Database Schema
-- Database: playreserve_db
-- Charset: utf8mb4_unicode_ci
-- ============================================

CREATE DATABASE IF NOT EXISTS playreserve_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE playreserve_db;

-- ============================================
-- 1. users
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  role            ENUM('admin','staff','player') NOT NULL,
  first_name      VARCHAR(50) NOT NULL,
  middle_name     VARCHAR(50),
  last_name       VARCHAR(50) NOT NULL,
  email           VARCHAR(100) UNIQUE NOT NULL,
  password        VARCHAR(255) NOT NULL,
  contact_number  VARCHAR(20),
  address         TEXT,
  gender          VARCHAR(20),
  profile_image   VARCHAR(255),
  status          ENUM('active','inactive') DEFAULT 'active',
  approval_status ENUM('pending','approved','rejected') DEFAULT 'approved',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 2. courts
-- ============================================
CREATE TABLE IF NOT EXISTS courts (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  court_number  VARCHAR(20) UNIQUE NOT NULL,
  sport_type    ENUM('basketball','tennis','badminton','volleyball','futsal','multi-purpose') NOT NULL,
  location      VARCHAR(100),
  size_sqm      DECIMAL(10,2),
  hourly_rate   DECIMAL(10,2) NOT NULL,
  image         VARCHAR(255),
  status        ENUM('available','maintenance','closed') DEFAULT 'available',
  description   TEXT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_status (status),
  KEY idx_sport_type (sport_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 3. reservations
-- ============================================
CREATE TABLE IF NOT EXISTS reservations (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  player_id            INT NOT NULL,
  court_id             INT NOT NULL,
  reservation_date     DATE NOT NULL,
  start_time           TIME NOT NULL,
  end_time             TIME NOT NULL,
  duration_hours       DECIMAL(4,2) NOT NULL,
  status               ENUM('pending','confirmed','cancelled','completed','no_show') DEFAULT 'pending',
  created_by_staff_id  INT,
  notes                TEXT,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_player_status (player_id, status),
  KEY idx_court_date (court_id, reservation_date, status),
  CONSTRAINT fk_reservations_player FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_reservations_court FOREIGN KEY (court_id) REFERENCES courts(id) ON DELETE CASCADE,
  CONSTRAINT fk_reservations_staff FOREIGN KEY (created_by_staff_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 4. billings
-- ============================================
CREATE TABLE IF NOT EXISTS billings (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  player_id      INT NOT NULL,
  reservation_id INT NOT NULL,
  amount_due     DECIMAL(10,2) NOT NULL,
  downpayment    DECIMAL(10,2) DEFAULT 0,
  balance        DECIMAL(10,2) NOT NULL,
  due_date       DATE NOT NULL,
  status         ENUM('unpaid','paid','overdue','waived','cancelled') DEFAULT 'unpaid',
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_reservation (reservation_id),
  KEY idx_player_status (player_id, status),
  CONSTRAINT fk_billings_player FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_billings_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 5. payments
-- ============================================
CREATE TABLE IF NOT EXISTS payments (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  billing_id            INT NOT NULL,
  player_id             INT NOT NULL,
  amount_paid           DECIMAL(10,2) NOT NULL,
  payment_type          VARCHAR(20) DEFAULT 'deposit',
  balance_after         DECIMAL(10,2) DEFAULT 0,
  payment_date          DATETIME NOT NULL,
  payment_method        VARCHAR(50) DEFAULT 'Cash',
  reference_number      VARCHAR(100),
  received_by_staff_id  INT,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_player (player_id),
  KEY idx_payment_date (payment_date),
  KEY idx_billing (billing_id),
  CONSTRAINT fk_payments_billing FOREIGN KEY (billing_id) REFERENCES billings(id) ON DELETE CASCADE,
  CONSTRAINT fk_payments_player FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_payments_staff FOREIGN KEY (received_by_staff_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
