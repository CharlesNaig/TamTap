<!-- markdownlint-disable MD033 MD036 MD041 MD001 MD051 MD060 MD040 -->
<div align="center">
<img src="assets/logos/TamTap.png" alt="TamTap Logo" width="400" />

# 📛 TamTap

### NFC-Based Attendance System with Camera Verification

**Grade 12 ICT Capstone Project | FEU Roosevelt Marikina | S.Y. 2025–2026**

![Version](https://img.shields.io/badge/version-2.1.0-green)
![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)
![Python](https://img.shields.io/badge/python-3.11-blue)
![Platform](https://img.shields.io/badge/platform-Raspberry%20Pi%204B-red)

*A locally hosted, NFC-based attendance system running on Raspberry Pi with camera verification and a real-time LAN dashboard.*

</div>

---

## 📑 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [System Architecture](#-system-architecture)
- [Hardware Specifications](#-hardware-specifications)
- [Software Stack](#-software-stack)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Installation & Setup](#-installation--setup)
- [Configuration](#-configuration)
- [Running the System](#-running-the-system)
- [API Reference](#-api-reference)
- [Database Schema](#-database-schema)
- [Socket.IO Events](#-socketio-events)
- [State Machine](#-state-machine)
- [Timing Constraints](#-timing-constraints)
- [Frontend Pages](#-frontend-pages)
- [Systemd Services](#-systemd-services)
- [Scripts & Utilities](#-scripts--utilities)
- [Error Handling & Logging](#-error-handling--logging)
- [Contributing](#-contributing)
- [Code Style Guide](#-code-style-guide)
- [Authors](#-authors)
- [License](#-license)

---

## 🔭 Overview

TamTap is a **locally hosted attendance system** designed for FEU Roosevelt Marikina. Students tap their NFC cards on an RC522 reader connected to a Raspberry Pi 4B. The system captures a photo via Pi Camera v2 for face detection verification (Haar Cascade — detection only, **no recognition**), records the attendance in MongoDB, and broadcasts the event to a real-time LAN dashboard via Socket.IO.

All processing happens **on-premise** — no cloud, no internet dependency.

---

## ✨ Features

| Category | Feature |
|---|---|
| **Attendance** | NFC tap → Camera capture → Face detection → Record |
| **Dashboard** | Real-time attendance feed via Socket.IO |
| **Roles** | Admin, Adviser, Teacher — role-based access |
| **Schedules** | Per-section weekly schedules with grace period/absent thresholds |
| **Calendar** | Academic calendar with suspensions and no-class declarations |
| **Notifications** | Pending absence tracking, excused marking |
| **Export** | XLSX and PDF attendance reports |
| **Offline Mode** | JSON fallback when MongoDB is unreachable |
| **Logs** | Live systemd log streaming in admin panel |
| **Buttons** | Physical GPIO buttons to start/restart/stop services |
| **Photo Storage** | External SD card with internal fallback |

---

## 🏗 System Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                        RASPBERRY PI 4B                          │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  RC522 NFC   │    │  Pi Camera   │    │  I2C LCD     │      │
│  │  Reader      │    │  v2 (5MP)    │    │  16x2        │      │
│  │  (SPI)       │    │  (CSI)       │    │  (0x27)      │      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│         │                   │                   │               │
│  ┌──────▼───────────────────▼───────────────────▼──────────┐   │
│  │              tamtap.py (Python 3.11)                     │   │
│  │         State Machine + Face Detection (Haar)            │   │
│  │         GPIO: Green LED (17) | Red LED (27) | Buzzer(18) │   │
│  └──────────────────────┬──────────────────────────────────┘   │
│                         │ HTTP POST /api/hardware/*             │
│  ┌──────────────────────▼──────────────────────────────────┐   │
│  │              server.js (Node.js 20 / Express)            │   │
│  │         REST API + Socket.IO + Session Auth              │   │
│  └──────────────────────┬──────────────────────────────────┘   │
│                         │                                       │
│  ┌──────────────────────▼──────────────────────────────────┐   │
│  │              MongoDB (Local Instance)                    │   │
│  │         Collections: students, teachers, attendance,     │   │
│  │         admins, calendar, schedules, settings            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└───────────────────────────────┬─────────────────────────────────┘
                                │ LAN (port 3000)
                    ┌───────────▼───────────┐
                    │   Browser Dashboard   │
                    │   (HTML/CSS/Vanilla JS)│
                    │   Tailwind + Chart.js  │
                    └───────────────────────┘
```

### Data Flow

```text
Student taps NFC card
        │
        ▼
  ┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐
  │ RC522 reads  │───▶│ Lookup student   │───▶│ Validate        │
  │ NFC UID      │    │ in DB (Mongo/JSON)│   │ schedule/time   │
  └─────────────┘    └──────────────────┘    └────────┬────────┘
                                                       │
                                              ┌────────▼────────┐
                                              │ Capture photo   │
                                              │ (rpicam-still)  │
                                              └────────┬────────┘
                                                       │
                                              ┌────────▼────────┐
                                              │ Haar cascade    │
                                              │ face detection  │
                                              └────────┬────────┘
                                                       │
                                    ┌──────────────────┴──────────────────┐
                                    │                                     │
                              Face detected?                        No face
                                    │                                     │
                              ┌─────▼─────┐                      ┌───────▼───────┐
                              │ Save to DB │                      │ Red LED +     │
                              │ Green LED  │                      │ Buzzer fail   │
                              │ Buzzer OK  │                      │ LCD: FAIL     │
                              └─────┬─────┘                      └───────────────┘
                                    │
                              ┌─────▼──────────────┐
                              │ POST /api/hardware/ │
                              │ attendance          │
                              └─────┬──────────────┘
                                    │
                              ┌─────▼──────────────┐
                              │ Socket.IO broadcast │
                              │ attendance:new      │
                              └────────────────────┘
```

---

## 🔧 Hardware Specifications

| Component | Model | Interface | Details |
|---|---|---|---|
| **SBC** | Raspberry Pi 4B | — | 4GB RAM, Bookworm OS |
| **NFC Reader** | RC522 | SPI | GPIO 8, 9, 10, 11, 25 |
| **LCD** | I2C 16x2 | I2C | Address `0x27` |
| **Camera** | Pi Camera v2 | CSI | 5MP, snapshot only |
| **Green LED** | — | GPIO 17 | Success indicator |
| **Red LED** | — | GPIO 27 | Failure indicator |
| **Buzzer** | — | GPIO 18 | Via relay module |
| **Start Button** | — | GPIO 5 | Active LOW, pull-up |
| **Restart Button** | — | GPIO 6 | Active LOW, pull-up |
| **Stop Button** | — | GPIO 13 | Hold 2.5s, Active LOW |

### GPIO Pin Map (BCM)

```text
GPIO 5  ─── START button  (to GND)
GPIO 6  ─── RESTART button (to GND)
GPIO 8  ─── RC522 SDA/CS
GPIO 9  ─── RC522 MISO
GPIO 10 ─── RC522 MOSI
GPIO 11 ─── RC522 SCK
GPIO 13 ─── STOP button  (to GND, hold 2.5s)
GPIO 17 ─── Green LED (success)
GPIO 18 ─── Buzzer (via relay)
GPIO 25 ─── RC522 RST
GPIO 27 ─── Red LED (fail)
I2C SDA ─── LCD SDA
I2C SCL ─── LCD SCL
```

---

## 🛠 Software Stack

### Hardware Layer (Python 3.11)

| Library | Purpose |
|---|---|
| `RPi.GPIO` | GPIO pin control (LEDs, buzzer) |
| `mfrc522` | RC522 NFC reader driver (SPI) |
| `smbus` | I2C communication (LCD 16x2) |
| `opencv-python-headless` | Face detection (Haar Cascade) |
| `pymongo` | MongoDB driver (with JSON fallback) |
| `python-dotenv` | Environment variable loading |
| `pyserial` | Arduino serial communication |

### Backend (Node.js 20)

| Library | Purpose |
|---|---|
| `express` | HTTP server & REST API |
| `mongodb` | MongoDB native driver |
| `socket.io` | Real-time WebSocket events |
| `express-session` | Session-based authentication |
| `bcryptjs` | Password hashing |
| `cors` | Cross-origin requests (LAN) |
| `multer` | File upload handling (XLSX import) |
| `exceljs` | XLSX report generation |
| `pdfkit` | PDF report generation |
| `xlsx` | XLSX parsing (schedule import) |
| `signale` | Structured console logging |
| `dotenv` | Environment variable loading |

### Frontend (Multi-Page HTML)

| Technology | Purpose |
|---|---|
| HTML5 | Page structure |
| CSS3 | Styling |
| Vanilla JavaScript (ES6+) | Client logic — **no frameworks** |
| Tailwind CSS | Utility-first styling (CDN) |
| Chart.js | Attendance analytics charts |
| SweetAlert2 | Modal dialogs and alerts |
| Socket.IO Client | Real-time attendance feed |
| Fetch API | HTTP requests — **no Axios** |

---

## 📁 Project Structure

```text
TamTap/
├── .env                          # Environment variables (gitignored)
├── .gitignore
├── LICENSE                       # MIT License
├── README.md                     # This file
├── startup.sh                    # Systemd startup script for tamtap.py
├── update.sh                     # Git pull + dependency update + restart
│
├── assets/
│   ├── attendance_photos/        # Captured attendance photos (by date)
│   ├── backgrounds/              # UI background images
│   ├── icons/                    # Favicon and UI icons
│   ├── logos/                    # FEU x TamTap branding logos
│   ├── templates/                # Schedule import templates
│   └── formats/                  # Export format assets
│
├── buttons/
│   ├── button_listener.py        # GPIO button controller (start/restart/stop)
│   ├── tamtap-buttons.service    # Systemd unit: button listener
│   ├── tamtap-server.service     # Systemd unit: Node.js server
│   └── README.md                 # Button wiring & setup guide
│
├── database/
│   └── tamtap_users.json         # JSON fallback database
│
├── hardware/
│   ├── tamtap.py                 # Main NFC attendance loop (state machine)
│   ├── database.py               # Unified DB module (MongoDB + JSON sync)
│   ├── register.py               # Student registration CLI
│   ├── tamtap_admin.py           # Admin CLI (archive, manage, export)
│   ├── archive_attendance.py     # Attendance archival utility
│   ├── requirements.txt          # Python dependencies
│   └── arduino/
│       ├── rfid_reader.ino       # Arduino RFID reader firmware
│       └── register_arduino.py   # Arduino-based NFC registration
│
├── software/
│   ├── server.js                 # Express.js API server (main entry)
│   ├── config.js                 # Server configuration
│   ├── package.json              # Node.js dependencies
│   ├── middleware/
│   │   └── auth.js               # Session auth middleware (requireAuth, requireAdmin)
│   ├── routes/
│   │   ├── admin.js              # Teacher/student CRUD (admin only)
│   │   ├── attendance.js         # Attendance queries (today, by date, range)
│   │   ├── auth.js               # Login/logout/session
│   │   ├── calendar.js           # Academic calendar management
│   │   ├── export.js             # XLSX/PDF report generation
│   │   ├── logs.js               # Live systemd log streaming
│   │   ├── notifications.js      # Pending absences & excused marking
│   │   ├── schedules.js          # Section schedule management
│   │   ├── stats.js              # Dashboard statistics & analytics
│   │   └── students.js           # Student/teacher data queries
│   ├── scripts/
│   │   └── bootstrap-admin.js    # Initial admin account creation
│   ├── utils/
│   │   └── Logger.js             # Signale-based structured logging
│   └── public/
│       ├── index.html            # Landing page
│       ├── login.html            # Login page
│       ├── dashboard.html        # Main dashboard
│       ├── admin.html            # Admin panel
│       ├── css/
│       │   └── preloader.css     # Loading animation styles
│       └── js/
│           └── preloader.js      # Loading animation logic
│
└── test/
    ├── test_rfid.py              # RFID reader test
    ├── test_lcd.py               # LCD display test
    ├── test_lcd_debug.py         # LCD debug utility
    ├── test_leds.py              # LED test
    ├── test_buzzer.py            # Buzzer test
    ├── test_dry_run.py           # Full system dry run (no hardware)
    └── excel_id.py               # Excel ID utility
```

---

## 📋 Prerequisites

### Hardware

- Raspberry Pi 4B (4GB RAM) with Raspberry Pi OS Bookworm
- RC522 NFC Reader module
- I2C LCD 16x2 display
- Pi Camera v2
- 2x LEDs (green, red), 1x buzzer with relay
- 3x push buttons (start, restart, stop)
- NFC cards/tags (MIFARE)

### Software

- Python 3.11+
- Node.js 20+
- MongoDB 7+ (local instance)
- Git

### Enable Interfaces (on Raspberry Pi)

```bash
sudo raspi-config
# Enable: SPI, I2C, Camera (Legacy Camera if needed)
```

---

## 🚀 Installation & Setup

### 1. Clone the Repository

```bash
cd /home/charles
git clone https://github.com/CharlesNaig/TamTap.git
cd TamTap
```

### 2. Create Environment File

```bash
cp .env.example .env
# Edit .env with your MongoDB URI and settings
```

Required `.env` variables:

```env
# MongoDB
MONGODB_URI=mongodb://localhost:27017/
MONGODB_NAME=tamtap

# Server
API_SERVER_PORT=3000
API_SERVER_HOST=0.0.0.0

# Session
SESSION_SECRET=your-random-secret-here

# Hardware → Server communication
TAMTAP_API_URL=http://localhost:3000
API_URL=http://localhost:3000
```

### 3. Setup Python Virtual Environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r hardware/requirements.txt
```

### 4. Install Node.js Dependencies

```bash
cd software
npm install
```

### 5. Start MongoDB

```bash
sudo systemctl start mongod
sudo systemctl enable mongod
```

### 6. Bootstrap Admin Account

```bash
cd software
npm run bootstrap
# Default: admin / tamtap2026 (change immediately)
```

### 7. Install Systemd Services

```bash
# Copy service files
sudo cp buttons/tamtap-buttons.service /etc/systemd/system/
sudo cp buttons/tamtap-server.service /etc/systemd/system/

# Create tamtap.service for the hardware script
sudo systemctl daemon-reload
sudo systemctl enable tamtap-buttons.service
sudo systemctl enable tamtap-server.service
sudo systemctl enable tamtap.service
```

---

## ⚙️ Configuration

### Server Config (`software/config.js`)

| Setting | Default | Description |
|---|---|---|
| `server.port` | `3000` | HTTP server port |
| `server.host` | `0.0.0.0` | Bind address (all interfaces) |
| `mongodb.maxPoolSize` | `10` | Max MongoDB connections |
| `session.maxAge` | `8 hours` | Session cookie lifetime |
| `photos.baseDir` | `../assets/attendance_photos` | Internal photo storage |
| `photos.externalDir` | `/mnt/tamtap_photos` | External SD card (preferred) |
| `socketio.pingTimeout` | `60000` | Socket.IO ping timeout (ms) |

### Timing Constants (`hardware/tamtap.py`)

| Constant | Value | Description |
|---|---|---|
| `CAMERA_CAPTURE_TIME` | 1200 ms | Camera shutter time |
| `CAMERA_TIMEOUT` | 2.5 s | subprocess timeout |
| `NFC_POLL_INTERVAL` | 0.1 s | NFC read poll interval |
| `FACE_DETECTION_TIMEOUT` | 1.0 s | Haar cascade timeout |
| `MIN_FACE_SIZE` | (80, 80) | Minimum face pixel size |

---

## 🏃 Running the System

### Development Mode

```bash
# Terminal 1: Start MongoDB
sudo systemctl start mongod

# Terminal 2: Start Node.js server (with auto-reload)
cd software
npm run dev

# Terminal 3: Start hardware script (on Raspberry Pi only)
source .venv/bin/activate
cd hardware
python tamtap.py
```

### Production Mode (Systemd)

```bash
# Start all services
sudo systemctl start tamtap.service
sudo systemctl start tamtap-server.service
sudo systemctl start tamtap-buttons.service

# Or use physical START button (GPIO 5)
```

### Access the Dashboard

Open a browser on any device on the same LAN:

```
http://<raspberry-pi-ip>:3000
```

---

## 📡 API Reference

Base URL: `http://<host>:3000/api`

### Authentication

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | Login (returns session cookie) |
| `POST` | `/api/auth/logout` | Session | Destroy session |
| `GET` | `/api/auth/me` | Session | Get current user info |

### Students & Teachers

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/students` | Session | List all students |
| `GET` | `/api/students/:nfc_id` | Session | Get student by NFC ID |
| `GET` | `/api/teachers` | Session | List all teachers |
| `GET` | `/api/teachers/:nfc_id` | Session | Get teacher by NFC ID |

### Admin (Admin Only)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/admin/teachers` | Admin | List teachers with sections |
| `POST` | `/api/admin/teachers` | Admin | Register new teacher |
| `PUT` | `/api/admin/teachers/:id` | Admin | Update teacher |
| `DELETE` | `/api/admin/teachers/:id` | Admin | Delete teacher |
| `POST` | `/api/admin/students` | Admin | Register new student |
| `POST` | `/api/admin/students/bulk` | Admin | Bulk register (CSV) |
| `PUT` | `/api/admin/students/:nfc_id` | Admin | Update student |
| `DELETE` | `/api/admin/students/:nfc_id` | Admin | Delete student |
| `GET` | `/api/admin/sections` | Admin | List all sections |

### Attendance

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/attendance` | Session | Today's records (`?section=11-A`) |
| `GET` | `/api/attendance/:date` | Session | Records by date (YYYY-MM-DD) |
| `GET` | `/api/attendance/range` | Session | Records by date range (`?from=&to=`) |

### Statistics

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/stats` | Session | Dashboard statistics |
| `GET` | `/api/stats/summary` | Session | Present/late/absent counts |
| `GET` | `/api/stats/daily` | Session | Daily summary |
| `GET` | `/api/stats/weekly` | Session | Weekly summary |

### Schedules

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/schedules` | Session | All section schedules |
| `GET` | `/api/schedules/:section` | Session | Specific section schedule |
| `POST` | `/api/schedules` | Admin | Create schedule |
| `PUT` | `/api/schedules/:section` | Admin/Adviser | Update schedule |
| `DELETE` | `/api/schedules/:section` | Admin | Delete schedule |
| `POST` | `/api/schedules/import` | Admin | Import from XLSX |
| `GET` | `/api/schedules/template` | Session | Download XLSX template |

### Calendar

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/calendar` | Session | Calendar events |
| `POST` | `/api/calendar` | Admin | Add suspension/no-class |
| `DELETE` | `/api/calendar/:id` | Admin | Remove event |

### Export

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/export/xlsx` | Session | Download XLSX report |
| `GET` | `/api/export/pdf` | Session | Download PDF report |

### Notifications

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/notifications/pending` | Session | Students who haven't tapped |
| `GET` | `/api/notifications/count` | Session | Pending absence count |
| `POST` | `/api/notifications/mark-excused` | Session | Mark student excused |
| `POST` | `/api/notifications/mark-absent` | Session | Confirm absent |
| `POST` | `/api/notifications/bulk-absent` | Session | Mark all pending as absent |

### System Logs (Admin Only)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/logs` | Admin | All service logs |
| `GET` | `/api/logs/:service` | Admin | Logs by service (`buttons`, `server`, `hardware`) |

### Hardware Bridge (Internal)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/hardware/attendance` | Internal | Record from tamtap.py |
| `POST` | `/api/hardware/fail` | Internal | Failure from tamtap.py |
| `POST` | `/api/hardware/status` | Internal | Status update from tamtap.py |

### Health Check

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | Server health + uptime |

---

## 🗄 Database Schema

### MongoDB Collections

#### `students`

```javascript
{
  nfc_id: String,       // Unique NFC card UID (required, indexed)
  tamtap_id: String,    // Human-readable TamTap ID
  name: String,         // Full name
  first_name: String,
  last_name: String,
  email: String,
  grade: String,        // e.g., "12"
  section: String,      // e.g., "12-ICT-A"
  registered: String    // ISO date string
}
```

#### `teachers`

```javascript
{
  username: String,           // Unique login username (indexed)
  password: String,           // bcrypt hash
  name: String,
  email: String,
  nfc_id: String,             // Optional (sparse unique index)
  tamtap_id: String,
  role_type: String,          // "admin" | "adviser" | "teacher"
  advised_section: String,    // For advisers only
  sections_handled: [String], // Sections this teacher manages
  forcePasswordChange: Boolean,
  created: String
}
```

#### `admins`

```javascript
{
  username: String,     // Unique
  password: String,     // bcrypt hash
  name: String
}
```

#### `attendance`

```javascript
{
  nfc_id: String,       // Student/teacher NFC UID
  tamtap_id: String,
  name: String,
  role: String,         // "student" | "teacher"
  date: String,         // "YYYY-MM-DD HH:MM:SS"
  time: String,         // "HH:MM:SS"
  session: String,      // "AM" | "PM"
  status: String,       // "present" | "late" | "absent" | "excused"
  photo: String,        // Filename of captured photo
  grade: String,
  section: String
}
```

#### `schedules`

```javascript
{
  section: String,              // Unique (e.g., "12-ICT-A")
  adviser_id: String,           // Teacher _id (indexed)
  weekly_schedule: {
    monday:    { start: "07:00", end: "17:00" },
    tuesday:   { start: "07:00", end: "17:00" },
    wednesday: { start: "07:00", end: "17:00" },
    thursday:  { start: "07:00", end: "17:00" },
    friday:    { start: "07:00", end: "17:00" },
    saturday:  { start: null, end: null }
  },
  grace_period_minutes: Number,     // Default: 20
  absent_threshold_minutes: Number  // Default: 60
}
```

#### `calendar`

```javascript
{
  type: String,         // "suspension" | "no-class" | "saturday-makeup"
  date: String,         // Single date (YYYY-MM-DD)
  startDate: String,    // Range start (for multi-day suspensions)
  endDate: String,      // Range end
  section: String,      // For section-specific no-class
  reason: String
}
```

#### `settings`

```javascript
{
  key: String,          // Unique setting key
  value: Mixed          // Setting value
}
```

### Calendar Priority Order

```text
1. School-wide suspension (Admin)      ← Highest
2. Section no-class declaration (Teacher)
3. Weekend rules (Sat disabled, Sun always off)
4. Normal instructional day (Mon-Fri)  ← Lowest
```

### Indexes

```javascript
// Students
students.createIndex({ nfc_id: 1 }, { unique: true });
students.createIndex({ tamtap_id: 1 });

// Teachers
teachers.createIndex({ nfc_id: 1 }, { unique: true, sparse: true });
teachers.createIndex({ tamtap_id: 1 });
teachers.createIndex({ username: 1 }, { unique: true });

// Attendance
attendance.createIndex({ nfc_id: 1, date: 1 });
attendance.createIndex({ date: -1 });

// Calendar
calendar.createIndex({ type: 1, date: 1 });
calendar.createIndex({ type: 1, startDate: 1, endDate: 1 });
calendar.createIndex({ type: 1, section: 1, date: 1 });

// Settings
settings.createIndex({ key: 1 }, { unique: true });

// Schedules
schedules.createIndex({ section: 1 }, { unique: true });
schedules.createIndex({ adviser_id: 1 });
```

---

## 📡 Socket.IO Events

Only these events are emitted (contract-enforced):

| Event | Direction | Payload | Description |
|---|---|---|---|
| `attendance:new` | Server → Client | `{ nfc_id, name, role, date, time, session, photo, section }` | New attendance recorded |
| `attendance:fail` | Server → Client | `{ nfc_id, name, reason, decline_code }` | Attendance failed |
| `camera:snapshot` | Server → Client | `{ photo_url }` | Camera snapshot taken |
| `system:status` | Server → Client | `{ status, mongodb, clients, hardware }` | System health update |

**⚠️ No custom events may be added without updating the contract.**

---

## 🔁 State Machine

All hardware modules **must** follow this state flow:

```text
          ┌─────────────────────────────────────────┐
          │                                         │
          ▼                                         │
       ┌──────┐    Card read     ┌───────────────┐  │
       │ IDLE │ ────────────────▶│ CARD_DETECTED │  │
       └──────┘                  └───────┬───────┘  │
                                         │          │
                                         ▼          │
                                ┌────────────────┐  │
                                │ CAMERA_ACTIVE  │  │
                                └───────┬────────┘  │
                                        │           │
                              ┌─────────┴─────────┐ │
                              │                   │ │
                              ▼                   ▼ │
                        ┌─────────┐         ┌──────┐│
                        │ SUCCESS │         │ FAIL ││
                        └────┬────┘         └──┬───┘│
                             │                 │    │
                             └─────────────────┘────┘
```

**Rules:**

- No state skipping — every transition is sequential
- No parallel state transitions
- Every cycle must return to `IDLE`
- `SHUTDOWN` state only on `SIGINT`/`SIGTERM`

---

## ⏱ Timing Constraints

Each attendance cycle **must** complete within **≤ 3.5 seconds**:

```text
┌──────────────────────────────────────────────────────────────┐
│                    TOTAL BUDGET: ≤ 3.5s                      │
├──────────┬──────────┬──────────────┬──────────┬─────────────┤
│ NFC Read │ Schedule │ Camera Wake  │ Face     │ LCD + LED   │
│ ≤ 100ms  │ Validate │ + Capture    │ Detect   │ Update      │
│          │ ~50ms    │ ≤ 1500ms     │ ≤ 1200ms │ ≤ 100ms     │
└──────────┴──────────┴──────────────┴──────────┴─────────────┘
```

**All code must be non-blocking. No `sleep()` calls that violate this budget.**

---

## 🖥 Frontend Pages

| Page | Path | Description |
|---|---|---|
| Landing | `/index.html` | Public landing page |
| Login | `/login.html` | Username/password login (session) |
| Dashboard | `/dashboard.html` | Real-time attendance feed + charts |
| Admin | `/admin.html` | Student/teacher management, schedules, calendar, logs |

### Frontend Rules

- **Multi-page HTML** — no SPA frameworks
- **One JS file per page** — no bundling
- **Fetch API only** — no Axios
- **WebSocket** only for live updates — not for data fetching
- **Tailwind CSS** via CDN or compiled CSS
- **Role-based UI** via JS logic: `admin` / `adviser` / `teacher`

---

## ⚙️ Systemd Services

| Service | File | Description | User |
|---|---|---|---|
| `tamtap.service` | (created during setup) | Hardware NFC/camera loop | charles |
| `tamtap-server.service` | `buttons/tamtap-server.service` | Node.js backend | charles |
| `tamtap-buttons.service` | `buttons/tamtap-buttons.service` | GPIO button controller | root |

### Service Commands

```bash
# Check status
sudo systemctl status tamtap.service
sudo systemctl status tamtap-server.service
sudo systemctl status tamtap-buttons.service

# View logs
sudo journalctl -u tamtap -f
sudo journalctl -u tamtap-server -f
sudo journalctl -u tamtap-buttons -f

# Restart
sudo systemctl restart tamtap.service
sudo systemctl restart tamtap-server.service
```

---

## 🧰 Scripts & Utilities

| Script | Location | Description |
|---|---|---|
| `startup.sh` | Root | Activates venv + starts tamtap.py (used by systemd) |
| `update.sh` | Root | Git pull + update deps + restart services |
| `bootstrap-admin.js` | `software/scripts/` | Create initial admin account |
| `register.py` | `hardware/` | CLI student registration via NFC |
| `tamtap_admin.py` | `hardware/` | Admin CLI: archive, manage, export |
| `archive_attendance.py` | `hardware/` | Archive/clear attendance records |

### CLI Registration (`register.py`)

```bash
source .venv/bin/activate
cd hardware
python register.py
# Menu: 1. Register Student (NFC) | 2. List | 3. Delete | 4. Exit
```

### Update System (`update.sh`)

```bash
./update.sh
# Pulls from GitHub, updates pip deps if changed, restarts services
# Aborts if local uncommitted changes exist
```

---

## ⚠️ Error Handling & Logging

### Python (Hardware)

- All functions use `try/except` with specific exception types
- Timeouts on NFC reads, camera subprocess, and face detection
- **No `print()` debugging** — use `logging` module only
- Levels: `INFO` (normal), `WARNING` (recoverable), `ERROR` (hardware/data failure)

### Node.js (Backend)

- All routes use `try/catch`
- Structured logging via `signale` (`Logger.js`)
- Custom log types: `info`, `success`, `warn`, `error`, `debug`, `database`, `socket`, `api`, `hardware`, `server`
- Live log streaming to admin panel via Socket.IO

### Logging Levels

| Level | Use Case | Example |
|---|---|---|
| `INFO` | Normal operations | "Student tapped: John Doe" |
| `WARN` | Recoverable issues | "MongoDB reconnecting..." |
| `ERROR` | Hardware or data failure | "NFC reader init failed" |

---

## 🤝 Contributing

### Rules

1. **No cloud services** — Firebase, AWS, Supabase, etc. are forbidden
2. **No frontend frameworks** — React, Angular, Vue are not allowed
3. **No GUI apps on Pi** — No Tkinter, PyQT
4. **No facial recognition** — Face detection (Haar) only, no face matching
5. **No hardcoded credentials** — Use `.env` for all secrets
6. **No blocking infinite loops** — All code must be non-blocking
7. **No features outside research scope** — Only implement what's in the capstone spec

### Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit changes: `git commit -m "feat: description"`
4. Push: `git push origin feature/your-feature`
5. Open a Pull Request

### Commit Convention

```text
feat:     New feature
fix:      Bug fix
docs:     Documentation only
style:    Formatting (no logic change)
refactor: Code restructuring
test:     Adding tests
chore:    Build/tooling changes
```

### Pull Request Checklist

- [ ] Code follows the [Code Style Guide](#-code-style-guide)
- [ ] No cloud dependencies introduced
- [ ] Hardware timing constraints respected (≤ 3.5s cycle)
- [ ] State machine flow preserved
- [ ] Only approved Socket.IO events used
- [ ] Error handling with try/except or try/catch
- [ ] Tested on Raspberry Pi 4B

---

## 📏 Code Style Guide

### Python

- Python 3.11+ syntax
- `logging` module — never `print()`
- Type hints encouraged but not required
- `snake_case` for functions and variables
- `PascalCase` for classes
- `UPPER_SNAKE_CASE` for constants
- Defensive programming: validate all inputs
- Prefer clarity over cleverness
- All code must be explainable to panelists

### JavaScript (Node.js)

- ES6+ syntax (`const`, `let`, arrow functions, async/await)
- `camelCase` for functions and variables
- `PascalCase` for classes
- `UPPER_SNAKE_CASE` for constants
- Always use `try/catch` in async routes
- Return early on errors
- Use structured logger, not `console.log`

### JavaScript (Frontend)

- Vanilla ES6+ — no frameworks, no transpilers
- One JS file per HTML page
- Fetch API for HTTP requests — no Axios
- Socket.IO client for real-time only
- Use `const` by default, `let` when mutation needed
- Never use `var`

### General

- 4-space indentation (Python), 4-space or 2-space (JS — match existing)
- Modular, testable functions
- Meaningful variable/function names
- Comments for non-obvious logic
- TODO comments are **mandatory edge cases** — never ignore them

---

## 🗣 Languages

| Layer | Language |
|---|---|
| Hardware control | Python 3.11 |
| Backend API | JavaScript (Node.js 20) |
| Frontend UI | HTML5, CSS3, JavaScript (ES6+) |
| Arduino firmware | C++ (Arduino IDE) |
| Shell scripts | Bash |
| Database | MongoDB query language |

---

## 👨‍💻 Authors

- **Charles Giann Marcelo** — Lead Developer
- et al. — FEU Roosevelt Marikina, Grade 12 ICT

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

```text
MIT License
Copyright (c) 2025 Charles Giann Marcelo
```

---

<div align="center">

**Built with 💚 at FEU Roosevelt Marikina**

*TamTap — Tap. Verify. Present.*

</div>
