# PlayReserve — Outdoor Sports Court Reservation Management System
## Complete System Architecture & Logic Guide

> **Purpose**: This document is the definitive reference for building **PlayReserve**, an outdoor sports court reservation and management system, using **React.js + Vite + TailwindCSS** (frontend) and **Node.js** (backend) with **MySQL** managed through **SQLyog** (database).
> It defines every page, database table, business rule, API flow, and user interaction needed to implement the system end-to-end. The structure below is adapted from a prior Commercial Spaces Services rebuild, but every entity, table, and workflow has been re-designed specifically for **court reservations, time-slot scheduling, and booking payments** — this is NOT a market/stall rental system.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Tech Stack](#2-tech-stack)
3. [Database Schema](#3-database-schema)
4. [Authentication & Authorization](#4-authentication--authorization)
5. [Role-Based Access & Navigation](#5-role-based-access--navigation)
6. [Recommended File Structure](#6-recommended-file-structure)
7. [Page-by-Page Functionality](#7-page-by-page-functionality)
8. [Core Business Logic](#8-core-business-logic)
9. [API Endpoints to Build](#9-api-endpoints-to-build)
10. [Security Considerations](#10-security-considerations)
11. [UI/UX Design System](#11-uiux-design-system)
12. [Quick Reference](#12-quick-reference)

---

## 1. System Overview

**PlayReserve** is an **Outdoor Sports Court Reservation Management System**. It digitalizes the full lifecycle of booking and managing outdoor sports courts (basketball, tennis, badminton, volleyball, futsal, etc.), including:

- **Court inventory management** — create, edit, and track court availability, sport type, and hourly rates
- **Player / member management** — self-registration, admin approval, profile management
- **Reservation & scheduling** — time-slot booking with automatic conflict detection (no double-booking a court)
- **Billing & payments** — per-reservation billing, deposits, balance tracking, FIFO payment application
- **Transaction history** — full payment audit trail per player and per court
- **Reporting & analytics** — revenue charts, court utilization rate, peak-hour analysis, booking trends

### Three User Roles

| Role       | Description                                                                                   |
|------------|------------------------------------------------------------------------------------------------|
| **Admin**  | Full system control: manage users, courts, view reports, approve reservations & memberships     |
| **Staff**  | Operational: manage courts, create/assist walk-in reservations, handle billing & payments        |
| **Player** | Self-service (a.k.a. Member): browse courts, book time slots, view balance & booking history     |

### What Changed From a Stall-Rental Model

| Stall Rental Concept          | PlayReserve Equivalent                                             |
|--------------------------------|----------------------------------------------------------------------|
| Market space (long-term rent) | **Court** (short-term, hourly time-slot use)                        |
| Renter                         | **Player / Member**                                                 |
| Rental (start_date–end_date, ~1 year) | **Reservation** (single date + start_time/end_time, hours not years) |
| Yearly rate ÷ 12 = monthly installment | **Hourly rate × duration** = amount due per booking            |
| Space status: available/rented | **Court status is time-based** — a court can be "available" for one slot and "reserved" for another on the same day |
| No conflict checking needed (1 renter per space long-term) | **Time-slot conflict checking is a core, mandatory algorithm** |

---

## 2. Tech Stack

| Layer      | Technology                                  |
|------------|----------------------------------------------|
| Frontend   | **React.js** + **Vite** + **TailwindCSS**    |
| Backend    | **Node.js** (Express.js recommended)         |
| Database   | **MySQL** (managed via **SQLyog**)           |
| ORM        | Sequelize or Knex.js (recommended)           |
| Auth       | JWT (JSON Web Tokens) + bcrypt               |
| Charts     | Chart.js or Recharts                         |
| Scheduling UI | A day/week calendar/timeline component (e.g. custom Tailwind grid, or `react-big-calendar`) |
| Font       | Google Fonts — Outfit                        |

---

## 3. Database Schema

Database name: `playreserve_db`
Charset: `utf8mb4_unicode_ci`

### 3.1 `users` Table

```sql
CREATE TABLE users (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  role            ENUM('admin','staff','player') NOT NULL,
  first_name      VARCHAR(50) NOT NULL,
  middle_name     VARCHAR(50),
  last_name       VARCHAR(50) NOT NULL,
  email           VARCHAR(100) UNIQUE NOT NULL,
  password        VARCHAR(255) NOT NULL,        -- bcrypt hash only
  contact_number  VARCHAR(20),
  address         TEXT,
  gender          VARCHAR(20),
  profile_image   VARCHAR(255),                 -- filename in assets/images/profiles/
  status          ENUM('active','inactive') DEFAULT 'active',
  approval_status ENUM('pending','approved','rejected') DEFAULT 'approved',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Key business rules:**
- Admin creates staff accounts directly (`status='active'`, `approval_status='approved'`)
- Player self-registration creates account with `status='inactive'`, `approval_status='pending'`
- Admin must approve a player before they can log in and book courts
- Passwords are stored **only** as bcrypt hashes — no plaintext column (security fix vs. the legacy model)
- Email pattern: `{firstname}{lastname}@playreserve.com`
- Default password pattern: `{Firstname}1234` (player/staff must change on first login — recommended)

### 3.2 `courts` Table

```sql
CREATE TABLE courts (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  court_number  VARCHAR(20) UNIQUE NOT NULL,        -- e.g. "COURT-01"
  sport_type    ENUM('basketball','tennis','badminton','volleyball','futsal','multi-purpose') NOT NULL,
  location      VARCHAR(100),                       -- e.g. "Outdoor Field A"
  size_sqm      DECIMAL(10,2),
  hourly_rate   DECIMAL(10,2) NOT NULL,              -- charged per hour of use
  image         VARCHAR(255),                       -- stored path, not BLOB
  status        ENUM('available','maintenance','closed') DEFAULT 'available',
  description   TEXT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_status (status),
  KEY idx_sport_type (sport_type)
);
```

**Key business rules:**
- `court_number` must be unique
- `status` here is a **facility-level** flag only (`maintenance` / `closed` block ALL bookings regardless of time). It is **not** used to say "booked" — actual booking availability is always computed live from the `reservations` table for a given date/time (see §8.4)
- `hourly_rate` is the base price per hour; `amount_due` on a reservation = `hourly_rate × duration_hours`
- Images stored as file paths (uploaded to `/uploads/courts/`), not BLOBs

### 3.3 `reservations` Table

```sql
CREATE TABLE reservations (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  player_id            INT NOT NULL,
  court_id             INT NOT NULL,
  reservation_date     DATE NOT NULL,
  start_time           TIME NOT NULL,
  end_time             TIME NOT NULL,
  duration_hours        DECIMAL(4,2) NOT NULL,       -- computed = TIMEDIFF(end,start) in hours
  status               ENUM('pending','confirmed','cancelled','completed','no_show') DEFAULT 'pending',
  created_by_staff_id  INT,                          -- NULL if self-booked by the player
  notes                TEXT,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_player_status (player_id, status),
  KEY idx_court_date (court_id, reservation_date, status)
);
```

**Key business rules:**
- One player can have many reservations across different courts/dates
- `pending` = booking submitted, awaiting deposit/payment confirmation (self-booked online) or awaiting admin approval (special/recurring bookings)
- `confirmed` = deposit or full payment received AND slot is locked — this is the only status that blocks the time slot for other players
- `completed` = system/staff marks it done once `reservation_date` + `end_time` has passed
- `cancelled` = player or staff cancelled (subject to cancellation cutoff policy, e.g. must cancel ≥2 hours before `start_time` for a refund)
- `no_show` = player never checked in for a confirmed slot
- **A court/date/time combination can never have two overlapping `pending` or `confirmed` reservations** — enforced at the application layer via the conflict-check query in §8.4

### 3.4 `billings` Table

```sql
CREATE TABLE billings (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  player_id      INT NOT NULL,
  reservation_id INT NOT NULL,
  amount_due     DECIMAL(10,2) NOT NULL,      -- hourly_rate * duration_hours
  downpayment    DECIMAL(10,2) DEFAULT 0,     -- deposit paid to hold the slot
  balance        DECIMAL(10,2) NOT NULL,       -- amount_due - downpayment - subsequent payments
  due_date       DATE NOT NULL,                -- normally = reservation_date
  status         ENUM('unpaid','paid','overdue','waived','cancelled') DEFAULT 'unpaid',
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_reservation (reservation_id),
  KEY idx_player_status (player_id, status)
);
```

**Key business rules:**
- One billing record is created per reservation, automatically when the reservation is made (or manually via "Booking Setup" if staff is handling a walk-in)
- `amount_due` = the court's `hourly_rate × duration_hours` at time of booking
- `balance` = `amount_due` − `downpayment` − sum of subsequent payments
- When `balance` reaches 0 → `status = 'paid'` → the linked reservation is auto-promoted to `confirmed`
- If the reservation is cancelled before full payment, billing → `cancelled`
- Only `unpaid` billings can be deleted

### 3.5 `payments` Table

```sql
CREATE TABLE payments (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  billing_id            INT NOT NULL,
  player_id             INT NOT NULL,
  amount_paid           DECIMAL(10,2) NOT NULL,
  payment_type          VARCHAR(20) DEFAULT 'deposit',  -- deposit, full, balance_settlement
  balance_after         DECIMAL(10,2) DEFAULT 0,
  payment_date          DATETIME NOT NULL,
  payment_method        VARCHAR(50) DEFAULT 'Cash',
  reference_number      VARCHAR(100),
  received_by_staff_id  INT,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_player (player_id),
  KEY idx_payment_date (payment_date),
  KEY idx_billing (billing_id)
);
```

**Key business rules:**
- Payments are applied to the player's **oldest unpaid billing first** (FIFO) — relevant when a player has multiple upcoming reservations with open balances
- A single payment can span multiple billing records if the amount exceeds the first bill's balance
- `amount_paid` cannot exceed the player's total unpaid balance across selected billing(s)
- `received_by_staff_id` tracks which staff processed the payment (NULL for self-service online payments)
- `payment_type`: `deposit` (holds the slot), `full` (pays the entire amount_due at once), `balance_settlement` (pays remaining balance after a deposit)

### Entity Relationship Diagram

```
users (player) (1) ──── (M) reservations (M) ──── (1) courts
       │                       │
       │                       │
      (1)                     (1)
       │                       │
      (M)                     (M)
   billings ──────────────  billings
       │
      (1)
       │
      (M)
   payments
```

---

## 4. Authentication & Authorization

### Login Flow

1. User submits email + password to `POST /api/auth/login`
2. Server queries `users` where `email = ?`
3. Validates: `status === 'active'` AND `bcrypt.compare(input, hash)` succeeds
4. On success: issues a JWT containing `user_id`, `role`, `email`
5. Redirects to role-specific dashboard:
   - `admin` → `/admin/dashboard`
   - `staff` → `/staff/dashboard`
   - `player` → `/player/dashboard`
6. On failure: return "Invalid credentials or inactive account"

### Token Configuration

```javascript
{
  accessToken:  { expiresIn: '15m' },
  refreshToken: { expiresIn: '7d', httpOnly: true, sameSite: 'Lax' }
}
```

### Authorization Middleware

```javascript
// requireAuth()          — verifies JWT, attaches req.user
// requireRole(['admin']) — checks req.user.role against allowed roles
// Both return 401/403 JSON errors (React handles redirect to /login)
```

---

## 5. Role-Based Access & Navigation

### Admin Sidebar Menu

| Label         | Route                  | Description                                       |
|---------------|------------------------|-----------------------------------------------------|
| Overview      | `/admin/dashboard`     | KPI metrics, revenue chart, court utilization      |
| Profile       | `/admin/profile`       | Edit own profile                                    |
| Users         | `/admin/users`         | CRUD all staff & player accounts                    |
| Players       | `/admin/players`       | View player list with booking history               |
| Courts        | `/admin/courts`        | CRUD courts, approve/reject pending reservations    |
| Transactions  | `/admin/transactions`  | View all payment transactions                       |
| Reports       | `/admin/reports`       | Revenue, court utilization, peak-hour reports       |

### Staff Sidebar Menu

| Label         | Route                  | Description                                       |
|---------------|------------------------|-----------------------------------------------------|
| Overview      | `/staff/dashboard`     | Staff-level KPIs                                    |
| Profile       | `/staff/profile`       | Edit own profile                                    |
| Players       | `/staff/players`       | View/manage players                                 |
| Courts        | `/staff/courts`        | Manage courts, create walk-in reservations, view schedule/calendar |
| Payments      | `/staff/payments`      | Record deposit / full / balance payments            |
| Billing       | `/staff/billing`       | Booking setup & billing management                  |

### Player Sidebar Menu

| Label            | Route                     | Description                          |
|------------------|----------------------------|---------------------------------------|
| Overview         | `/player/dashboard`       | Personal KPIs, upcoming reservations |
| Profile          | `/player/profile`         | Edit own profile                     |
| My Reservations  | `/player/reservations`    | View upcoming & past bookings        |
| Browse Courts    | `/player/courts`          | Browse courts & live availability    |
| Book a Court      | `/player/courts/:id/book` | Time-slot picker + booking form      |
| Transactions     | `/player/transactions`    | View own payment history             |

---

## 6. Recommended File Structure

```
playreserve/
├── client/                        # React + Vite + TailwindCSS
│   ├── public/
│   │   └── assets/images/
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── Header.jsx
│   │   │   │   ├── Sidebar.jsx
│   │   │   │   ├── Footer.jsx
│   │   │   │   └── DashboardLayout.jsx
│   │   │   ├── ui/
│   │   │   │   ├── FlashMessage.jsx
│   │   │   │   ├── Modal.jsx
│   │   │   │   ├── Pagination.jsx
│   │   │   │   ├── SearchBar.jsx
│   │   │   │   ├── StatusBadge.jsx
│   │   │   │   └── DataTable.jsx
│   │   │   ├── scheduling/
│   │   │   │   ├── CourtScheduleGrid.jsx    # day/week timeline of slots per court
│   │   │   │   ├── TimeSlotPicker.jsx       # used in the booking form
│   │   │   │   └── AvailabilityBadge.jsx
│   │   │   └── charts/
│   │   │       ├── RevenueChart.jsx
│   │   │       └── UtilizationChart.jsx
│   │   ├── pages/
│   │   │   ├── public/
│   │   │   │   ├── Landing.jsx
│   │   │   │   └── Login.jsx
│   │   │   ├── admin/
│   │   │   │   ├── Dashboard.jsx
│   │   │   │   ├── Users.jsx
│   │   │   │   ├── Players.jsx
│   │   │   │   ├── Courts.jsx
│   │   │   │   ├── Transactions.jsx
│   │   │   │   ├── Reports.jsx
│   │   │   │   └── Profile.jsx
│   │   │   ├── staff/
│   │   │   │   ├── Dashboard.jsx
│   │   │   │   ├── Players.jsx
│   │   │   │   ├── Courts.jsx
│   │   │   │   ├── Payments.jsx
│   │   │   │   ├── Billing.jsx
│   │   │   │   └── Profile.jsx
│   │   │   └── player/
│   │   │       ├── Dashboard.jsx
│   │   │       ├── MyReservations.jsx
│   │   │       ├── BrowseCourts.jsx
│   │   │       ├── BookCourt.jsx
│   │   │       ├── Transactions.jsx
│   │   │       └── Profile.jsx
│   │   ├── hooks/
│   │   │   ├── useAuth.js
│   │   │   └── useFlash.js
│   │   ├── context/
│   │   │   └── AuthContext.jsx
│   │   ├── services/
│   │   │   └── api.js              # Axios instance
│   │   ├── utils/
│   │   │   ├── formatCurrency.js
│   │   │   ├── formatTime.js       # start_time/end_time helpers
│   │   │   └── constants.js
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css               # TailwindCSS directives
│   ├── tailwind.config.js
│   ├── vite.config.js
│   └── package.json
│
├── server/                        # Node.js (Express)
│   ├── config/
│   │   └── db.js                  # MySQL connection pool
│   ├── middleware/
│   │   ├── auth.js                # JWT verification
│   │   └── roleGuard.js           # Role-based access
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── users.routes.js
│   │   ├── courts.routes.js
│   │   ├── reservations.routes.js
│   │   ├── billings.routes.js
│   │   ├── payments.routes.js
│   │   └── reports.routes.js
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── users.controller.js
│   │   ├── courts.controller.js
│   │   ├── reservations.controller.js   # includes conflict-check logic
│   │   ├── billings.controller.js
│   │   ├── payments.controller.js
│   │   └── reports.controller.js
│   ├── models/                    # Sequelize models (optional)
│   ├── utils/
│   │   └── helpers.js
│   ├── app.js
│   ├── server.js
│   └── package.json
│
└── README.md
```

---

## 7. Page-by-Page Functionality

### 7.1 Public Pages

#### Landing Page (`/`)

1. **Hero Section** — Headline cycling sport types ("Book a Basketball Court" / "Reserve a Tennis Court"), CTA "Find a Court" / "Login"
2. **Features Section** — 3 cards: Live Availability, Instant Booking, Flexible Payments
3. **About Section** — Mission/vision, feature tags (Real-Time Scheduling, Multiple Sports, Deposit Booking)
4. **Services Section** — Supported sports checklist + booking requirements (Valid Account, Contact Info, Deposit/Advance Payment, House Rules Agreement)
5. **Courts Section** — Live from database, paginated (8 per page), shows sport type + live "Available now / Booked until HH:MM" badge, modal detail view with today's schedule
6. **Contact Section** — Email, socials, operating hours, location
7. **Footer**

**Data queries on landing:**
- `SELECT sport_type, COUNT(*) FROM courts GROUP BY sport_type`
- `SELECT * FROM courts WHERE status != 'closed' ORDER BY court_number ASC LIMIT 8 OFFSET ?`
- Live availability per court computed via the conflict-check query in §8.4 against `CURDATE()`/`CURTIME()`

#### Login Page (`/login`)

- Dark theme card, Email + Password form
- Social login icons (optional)
- Flash/inline error messages
- "Back to Home" link

#### Logout (`/logout`)

- Clears JWT from client storage → redirect to `/login`

---

### 7.2 Admin Pages

#### Admin Dashboard (`/admin/dashboard`)

**KPI Cards:**

| Metric               | Query                                                                                          |
|----------------------|--------------------------------------------------------------------------------------------------|
| Total Collections    | `SELECT SUM(amount_paid) FROM payments`                                                         |
| Registered Users     | `SELECT COUNT(*) FROM users WHERE role IN ('staff','player')`                                   |
| Court Utilization    | `booked_slot_hours_today / total_bookable_hours_today * 100` across all active courts           |
| Pending Approvals    | `SELECT COUNT(*) FROM users WHERE approval_status='pending'` + `SELECT COUNT(*) FROM reservations WHERE status='pending'` |

**Revenue Chart (Line, last 6 months):**
`SELECT DATE_FORMAT(payment_date, '%b'), SUM(amount_paid) FROM payments WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH) GROUP BY YEAR(payment_date), MONTH(payment_date) ORDER BY payment_date ASC`

**Recent Activities:** last 5 payments with player name, amount, court, date.

#### Admin Users (`/admin/users`)

- Create form: Role (staff/player), First/Middle/Last Name, Email, Password (auto-filled with the default pattern)
- Users table: ID, avatar+name+email, role badge, approval status (Approve/Reject for pending), active/inactive toggle, Edit/Delete
- Actions: `create`, `update_status`, `update_user`, `approve_player`, `reject_player`, `delete`

#### Admin Players (`/admin/players`)

- Read-only table: player details, contact info, upcoming reservation (if any, via active reservation JOIN), registration date
- `SELECT ... FROM users u LEFT JOIN reservations r ON r.player_id = u.id AND r.status='confirmed' LEFT JOIN courts c ON c.id = r.court_id WHERE u.role='player'`

#### Admin Courts (`/admin/courts`)

**Pending Reservation Approvals** (shown if any exist — e.g. recurring/group bookings flagged for review):
- Table: Player, Court, Date/Time, Duration, Amount, Approve/Reject buttons
- `SELECT * FROM reservations r JOIN users u JOIN courts c WHERE r.status = 'pending'`

**Create Court Form:** Court Number, Sport Type, Location, Size, Hourly Rate, Image, Description (duplicate court_number check)

**Courts Table (paginated, 8/page):** thumbnail + number + sport type, hourly rate, facility status dropdown, Actions (Edit, View Schedule)
- Click row → Detail Modal showing today's/this week's time-slot schedule for that court (calls the conflict-check query for the selected day)

**Actions:** `create`, `modify`, `approve_reservation` (transaction: reservation→confirmed, ensure no conflict, billing recalculated), `reject_reservation` (transaction: reservation→cancelled, billing→cancelled)

#### Admin Transactions (`/admin/transactions`)

Full payment history: `payments → billings → reservations → users → courts`

#### Admin Reports (`/admin/reports`)

Revenue reports, court utilization by sport type, peak-hour heatmap, top players by spend/bookings.

---

### 7.3 Staff Pages

#### Staff Dashboard (`/staff/dashboard`)

Operational KPIs: today's bookings, today's expected collections, courts currently in use, no-shows today.

#### Staff Courts (`/staff/courts`)

**Live Schedule View:** per-court day/week grid showing existing reservations as blocks, free slots visibly open.

**AJAX Player Lookup:** `GET /api/players/lookup?email={email}` → returns player id, name, contact, unpaid balance — used to pre-fill a walk-in booking.

**Create Reservation (Walk-in) Flow:**
1. Staff opens the schedule for a court and clicks an open slot
2. Modal pre-fills court + date + start_time; staff sets duration/end_time
3. Staff enters player email → AJAX lookup fills player details (or "Register new player" if not found)
4. **System runs the conflict check (§8.4)** before allowing submission
5. On submit: creates `reservations` row (`status='pending'`) + matching `billings` row
6. Once deposit/full payment is recorded, reservation auto-promotes to `confirmed`

**Actions:** `create_court`, `update_status`, `modify_court`, `delete_court`, `assign` (create reservation for a walk-in player)

#### Staff Payments (`/staff/payments`)

**Payment Type Tabs:**
- **Deposit** — a partial amount to hold the slot (e.g. 50% of `amount_due`)
- **Full** — auto-fills the entire `amount_due`
- **Balance Settlement** — auto-fills remaining `balance` after a deposit

**Process Payment Form:** Select player (dropdown shows name + upcoming reservation + current balance), billing reference, payment method, reference #, amount (validated against balance), real-time summary.

**Payment Recording Logic (FIFO — see §8.3 for full pseudocode).**

**Recent Transactions Table:** last 30 transactions — Player, Court, Amount Paid, Balance After, Type badge, Method badge, Date, Reference. Client-side search by player name.

#### Staff Billing (`/staff/billing`)

**Booking Setup Modal:**
1. Select a reservation that has no existing billing yet
2. System auto-computes `amount_due = court.hourly_rate * duration_hours`
3. Staff enters Down Payment (deposit) and confirms Due Date (defaults to `reservation_date`)
4. Real-time display: Balance = `amount_due − downpayment`

**Billing Setup Logic:**
```
1. Get reservation's court hourly_rate and duration_hours
2. amount_due = hourly_rate * duration_hours
3. balance = amount_due - down_payment
4. status = balance <= 0 ? 'paid' : 'unpaid'
5. INSERT billing record
6. If down_payment > 0: INSERT payment record (payment_type='deposit')
7. If status == 'paid': UPDATE reservations SET status='confirmed' WHERE id = reservation_id
8. Commit transaction
```

**Billings Table:** Reference (#BK-00001), Player, Court/Date, Amount Due, Balance, Due Date, Status badge, Actions (status update, delete if unpaid).

---

### 7.4 Player Pages

#### Player Dashboard (`/player/dashboard`)

| Metric               | Query                                                                                    |
|----------------------|---------------------------------------------------------------------------------------------|
| Upcoming Reservations | `SELECT COUNT(*) FROM reservations WHERE player_id=? AND status='confirmed' AND reservation_date >= CURDATE()` |
| Outstanding Balance  | `SELECT SUM(balance) FROM billings WHERE player_id=? AND status NOT IN ('paid','cancelled')` |
| Next Booking          | `SELECT MIN(reservation_date), start_time FROM reservations WHERE player_id=? AND status='confirmed' AND reservation_date >= CURDATE()` |
| Total Paid            | `SELECT SUM(amount_paid) FROM payments WHERE player_id=?`                                    |

Recent payments list: last 5, with date, amount, court/reservation reference.

#### Browse Courts (`/player/courts`)

- Filter by sport type + date; shows live availability per court for the selected day
- Paginated (8 per page); click court → detail modal with the day's time-slot schedule
- "Book This Court" CTA opens the booking flow

#### Book a Court (`/player/courts/:id/book`)

1. Player picks a date → system fetches already-booked slots for that court/date (conflict-check query)
2. Player picks an open start_time + duration → `end_time` auto-computed
3. System re-validates no conflict on submit (race-condition safe)
4. Creates `reservations` (`status='pending'`) + `billings` (amount_due computed)
5. Player pays deposit or in full → billing recalculated → reservation promoted to `confirmed` once required deposit is met

#### My Reservations (`/player/reservations`)

- Tabs: Upcoming / Past / Cancelled
- Each row: court, sport type, date, time range, status badge, balance due, "Pay Now" / "Cancel" actions (cancel respects the cutoff policy)

#### Transactions (`/player/transactions`)

Own payment history only — Amount, Method, Date, Reference, linked Reservation.

#### Player/Staff/Admin Profile Pages

View/edit: name, email, contact, address, gender. Upload/change profile image. Change password (current password required).

---

## 8. Core Business Logic

### 8.1 Reservation Booking Flow

```
1. Player (or staff on their behalf) picks a court, date, start_time, and duration
2. System runs the conflict-check query (§8.4) for that court + date + time range
3a. If a conflict exists → reject with "Slot no longer available", suggest next open slot
3b. If no conflict → create reservation(status='pending') + matching billing (amount_due computed)
4. Player/staff submits deposit or full payment
5. On sufficient payment: billing status recalculated, reservation → 'confirmed'
6. (Optional) Admin review queue applies only to flagged cases — e.g. recurring/league bookings —
   otherwise confirmation is automatic once payment clears
7. On reservation_date + end_time passing: system job marks reservation → 'completed'
```

### 8.2 Billing Lifecycle

```
1. Billing is created at the moment a reservation is submitted (auto) or via Staff Booking Setup (manual, for walk-ins)
2. amount_due = court.hourly_rate * duration_hours
3. balance = amount_due - downpayment
4. status = balance <= 0 ? 'paid' : 'unpaid'
5. Player settles the balance any time before the reservation date (or on-site)
6. Each payment reduces billing balance; when balance = 0 → status = 'paid' → reservation auto-confirms
7. If the reservation is cancelled before being paid in full → billing → 'cancelled'
```

### 8.3 Payment Processing (FIFO)

```
1. Staff/player selects a billing (or the system auto-selects the player's oldest unpaid billing)
2. Choose payment type: Deposit / Full / Balance Settlement
3. Enter amount (validated: cannot exceed total unpaid balance across selected billing(s))
4. System processes:
   a. Fetch all unpaid billings for the player, ordered oldest reservation_date first
   b. Apply payment amount across billings sequentially (min of remaining_amount, bill_balance)
   c. Update each billing's balance and status
   d. If a billing reaches balance=0, promote its reservation to 'confirmed'
   e. Insert payment record with balance_after snapshot
5. All steps run inside a single database transaction (rollback on any error)
```

### 8.4 Court Availability / Conflict-Checking Algorithm (Core New Logic)

This replaces the old "space is available/rented" flag. Availability is always computed live, per court, per date, per time range:

```sql
-- Returns TRUE (conflict exists) if any row is returned
SELECT id FROM reservations
WHERE court_id = :court_id
  AND reservation_date = :reservation_date
  AND status IN ('pending', 'confirmed')
  AND (
        :new_start_time < end_time
    AND :new_end_time   > start_time
      )
LIMIT 1;
```

- A slot is bookable only if this query returns **zero rows**
- Run this check **twice**: once when rendering the schedule/calendar (to grey out taken slots), and again server-side at the moment of booking submission (to prevent race conditions from two players booking the same slot simultaneously)
- `pending` reservations are included in the conflict check (they hold the slot temporarily) — consider an expiry job that auto-cancels `pending` reservations with no payment after e.g. 15 minutes, freeing the slot
- Court-level `status = 'maintenance'` or `'closed'` blocks the entire court for all time slots on top of this check

### 8.5 Cancellation & Refund Policy

```
1. Player/staff requests cancellation of a 'confirmed' or 'pending' reservation
2. If now < reservation start_time - cancellation_cutoff_hours (e.g. 2 hours):
     → full refund of any payments made, billing → 'cancelled', reservation → 'cancelled'
3. Else (late cancellation):
     → deposit forfeited (billing balance/status per policy), reservation → 'cancelled'
4. Slot is immediately freed and re-appears as available in the conflict check
```

### 8.6 Currency & Timezone

- Configure per deployment (e.g. Philippine Peso `₱{number_format(value,2)}`, timezone `Asia/Manila`) — keep both as environment-level config values, not hardcoded, since court reservation systems are commonly deployed across different locales.

---

## 9. API Endpoints to Build

### Auth

| Method | Endpoint            | Description               | Access  |
|--------|----------------------|-----------------------------|---------|
| POST   | `/api/auth/login`   | Login, return JWT           | Public  |
| POST   | `/api/auth/logout`  | Invalidate/clear token      | Auth    |
| GET    | `/api/auth/me`      | Get current user profile    | Auth    |

### Users

| Method | Endpoint                    | Description                        | Access  |
|--------|------------------------------|---------------------------------------|---------|
| GET    | `/api/users`                | List users (filter by role/search)   | Admin   |
| POST   | `/api/users`                | Create user                          | Admin   |
| PUT    | `/api/users/:id`            | Update user details                  | Admin   |
| PATCH  | `/api/users/:id/status`     | Toggle active/inactive               | Admin   |
| PATCH  | `/api/users/:id/approve`    | Approve player                       | Admin   |
| PATCH  | `/api/users/:id/reject`     | Reject player                        | Admin   |
| DELETE | `/api/users/:id`            | Delete user                          | Admin   |

### Courts

| Method | Endpoint                        | Description                          | Access       |
|--------|-----------------------------------|-----------------------------------------|-------------|
| GET    | `/api/courts`                   | List courts (filter, paginate)         | Auth        |
| GET    | `/api/courts/:id`                | Get court detail                       | Auth        |
| GET    | `/api/courts/:id/schedule?date=` | Get booked slots for a court/date      | Auth        |
| POST   | `/api/courts`                   | Create court                           | Admin       |
| PUT    | `/api/courts/:id`                | Update court                           | Admin/Staff |
| PATCH  | `/api/courts/:id/status`         | Update facility status (maintenance/closed) | Admin/Staff |

### Reservations

| Method | Endpoint                            | Description                          | Access  |
|--------|---------------------------------------|-----------------------------------------|---------|
| GET    | `/api/reservations`                 | List reservations                      | Auth    |
| GET    | `/api/reservations/pending`         | List pending reservations              | Admin   |
| POST   | `/api/reservations/check-availability` | Run the conflict-check query          | Auth    |
| POST   | `/api/reservations`                 | Create reservation (self or walk-in)   | Auth    |
| PATCH  | `/api/reservations/:id/approve`     | Approve reservation                    | Admin   |
| PATCH  | `/api/reservations/:id/reject`      | Reject reservation                     | Admin   |
| PATCH  | `/api/reservations/:id/cancel`      | Cancel reservation (refund logic)      | Auth    |
| GET    | `/api/players/lookup?email=`        | AJAX player lookup                     | Staff   |

### Billings

| Method | Endpoint                       | Description                     | Access  |
|--------|-----------------------------------|-------------------------------------|---------|
| GET    | `/api/billings`                | List billings (search)             | Staff   |
| POST   | `/api/billings/setup`          | Create billing + optional deposit  | Staff   |
| PATCH  | `/api/billings/:id/status`     | Update billing status              | Staff   |
| DELETE | `/api/billings/:id`            | Delete unpaid billing              | Staff   |

### Payments

| Method | Endpoint                       | Description                     | Access  |
|--------|-----------------------------------|-------------------------------------|---------|
| GET    | `/api/payments`                | List payments (limit 30)           | Staff   |
| GET    | `/api/payments/player/:id`     | Get player's payments              | Auth    |
| POST   | `/api/payments`                | Record payment (FIFO logic)        | Staff   |

### Reports & Dashboard

| Method | Endpoint                          | Description                       | Access  |
|--------|-------------------------------------|----------------------------------------|---------|
| GET    | `/api/dashboard/admin`            | Admin KPIs + chart data               | Admin   |
| GET    | `/api/dashboard/staff`            | Staff KPIs                            | Staff   |
| GET    | `/api/dashboard/player`           | Player personal KPIs                  | Player  |
| GET    | `/api/reports/revenue`            | Revenue reports                       | Admin   |
| GET    | `/api/reports/utilization`        | Court utilization / peak-hour reports | Admin   |

### Profile

| Method | Endpoint                       | Description                     | Access  |
|--------|-----------------------------------|-------------------------------------|---------|
| GET    | `/api/profile`                 | Get own profile                    | Auth    |
| PUT    | `/api/profile`                 | Update own profile                 | Auth    |
| POST   | `/api/profile/image`           | Upload profile image               | Auth    |
| PUT    | `/api/profile/password`        | Change password                    | Auth    |

---

## 10. Security Considerations

1. **JWT Authentication** with short-lived access tokens (15min) + refresh tokens (7d)
2. **bcrypt** for password hashing (cost factor 12) — no plaintext password storage anywhere
3. **Helmet.js** for HTTP security headers
4. **CORS** whitelist for the frontend origin
5. **Input validation** with Joi/express-validator (especially date/time fields for reservations)
6. **File upload** validation (type, size limits) for court images and profile pictures
7. **SQL injection protection** via parameterized queries / ORM
8. **Rate limiting** on the login endpoint and on the booking-submission endpoint (prevent slot-hoarding bots)
9. **Transactional integrity** — the conflict check + reservation insert must run inside a DB transaction (or use a unique constraint / row locking strategy) to prevent race-condition double-bookings under concurrent requests
10. **Auto-expiry job** for stale `pending` reservations with no payment, to release held slots

---

## 11. UI/UX Design System

### Color Palette

```javascript
// Primary (Emerald/Green — "outdoors, sport, go" feel)
primary: {
  50:  '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0',
  300: '#6ee7b7', 400: '#34d399', 500: '#10b981',
  600: '#059669', 700: '#047857', 800: '#065f46',
  900: '#064e3b'
}

// Accent (used for CTAs, court-availability highlights):
accent: {
  50: '#fff7ed', 500: '#f97316', 600: '#ea580c'   // Orange — "book now" energy
}

// Semantic Colors:
// Success (confirmed/paid): emerald-500 (#10b981)
// Warning (pending/unpaid):  amber-500  (#f59e0b)
// Danger (cancelled/overdue): rose-500  (#f43f5e)
// Info:  primary-500
```

### Typography

- **Font Family**: `'Outfit', sans-serif` (Google Fonts)
- **Weights Used**: 300, 400, 500, 600, 700, 800, 900

### Layout

- **Sidebar**: Fixed left, 16rem expanded / 5rem collapsed, `bg-slate-900`
- **Main Content**: Flex column with sticky header
- **Responsive**: Sidebar hidden on mobile, overlay toggle
- **Cards**: `rounded-3xl`, `border border-slate-200`, `shadow-sm`, hover → `shadow-xl`
- **Schedule Grid**: Timeline columns per court, taken slots filled solid, open slots outlined/clickable
- **Tables**: Full-width, `rounded-2xl`, hover row highlight
- **Modals**: Centered, backdrop blur, `rounded-[2.5rem]`, z-index stacking
- **Buttons**: `rounded-xl` / `rounded-2xl`, `shadow-lg`, `active:scale-[0.98]`

### Status Badges

| Status     | Style                                |
|------------|-----------------------------------------|
| Active     | `bg-emerald-50 text-emerald-700`       |
| Inactive   | `bg-rose-50 text-rose-700`             |
| Pending    | `bg-amber-50 text-amber-700`           |
| Approved   | `bg-emerald-50 text-emerald-700`       |
| Rejected   | `bg-rose-50 text-rose-700`             |
| Available  | `bg-emerald-50 text-emerald-700`       |
| Confirmed  | `bg-primary-50 text-primary-700`       |
| Cancelled  | `bg-rose-50 text-rose-700`             |
| Completed  | `bg-slate-50 text-slate-700`           |
| No Show    | `bg-rose-50 text-rose-700`             |
| Paid       | `bg-emerald-50 text-emerald-700`       |
| Unpaid     | `bg-amber-50 text-amber-700`           |
| Overdue    | `bg-rose-50 text-rose-700`             |
| Waived     | `bg-slate-50 text-slate-700`           |

### Animations

- **Sidebar**: `transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1)`
- **Hover cards**: `hover:-translate-y-1 transition-all duration-300`
- **Schedule slot select**: quick scale/highlight pulse on click
- **Modals**: `animate-in zoom-in duration-300`
- **Flash messages**: `animate-in fade-in slide-in-from-top-2 duration-300`

---

## 12. Quick Reference

### Default Credentials Pattern

| Field    | Pattern                                           |
|----------|-----------------------------------------------------|
| Email    | `{firstname}{lastname}@playreserve.com` (lowercase) |
| Password | `{Firstname}1234` (first letter capitalized)         |

**Example**: First Name: `Mark`, Last Name: `Cruz`
- Email: `markcruz@playreserve.com`
- Password: `Mark1234`

### Core Formula Cheat Sheet

| Formula                  | Definition                                            |
|--------------------------|----------------------------------------------------------|
| `duration_hours`         | `TIMESTAMPDIFF(MINUTE, start_time, end_time) / 60`       |
| `amount_due`             | `court.hourly_rate * reservation.duration_hours`         |
| `balance`                | `amount_due - downpayment - SUM(payments.amount_paid)`    |
| Conflict check           | `new_start < existing_end AND new_end > existing_start`  |
| Court utilization %      | `SUM(booked_hours_today) / SUM(operating_hours_today) * 100` |

---

> **This document is the complete blueprint for building PlayReserve — an outdoor sports court reservation management system. Every database table, business rule, page interaction, and UI pattern is designed specifically around time-slot booking, live availability, and per-reservation billing (not long-term stall/space rental).**