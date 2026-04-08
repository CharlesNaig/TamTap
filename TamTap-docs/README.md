<!-- markdownlint-disable MD033 MD036 MD041 MD001 MD051 MD060 MD040 -->
<div align="center">

<img width="4750" height="1425" alt="TamTap Logo" src="https://github.com/user-attachments/assets/3ebbd892-85de-4a12-8305-05565e5c8ef4" />

# TamTap

### TamTap NFC-Based Attendance System with Camera Verification

**Grade 12 ICT B Group 5 Capstone | FEU Roosevelt Marikina | S.Y. 2025–2026**

![Version](https://img.shields.io/badge/version-2.3.0-green)
![License](https://img.shields.io/badge/license-All%20Rights%20Reserved-red)
![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)
![Python](https://img.shields.io/badge/python-3.11-blue)
![Platform](https://img.shields.io/badge/platform-Raspberry%20Pi%204B-red)
![Status](https://img.shields.io/badge/status-capstone%20project-orange)

*A locally hosted, NFC-Based Attendance System running on Raspberry Pi with camera verification and a real-time LAN dashboard.*

</div>

---

## 📑 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [How It Works](#-how-it-works)
- [System Architecture](#-system-architecture)
- [Hardware Specifications](#-hardware-specifications)
- [Software Stack](#-software-stack)
- [Repository Structure](#-repository-structure)
- [State Machine](#-state-machine)
- [Timing Constraints](#-timing-constraints)
- [Database Schema](#-database-schema)
- [API Surface](#-api-surface)
- [Socket.IO Events](#-socketio-events)
- [Frontend Pages](#-frontend-pages)
- [Security Design](#-security-design)
- [Authors](#-authors)
- [License](#-license)

---

## 🔭 Overview

TamTap is a **locally hosted attendance system** designed for FEU Roosevelt Marikina. Students tap their NFC cards on an RC522 reader connected to a Raspberry Pi 4B. The system captures a photo via Pi Camera v2 for face detection verification (Haar Cascade — detection only, **no recognition**), records the attendance in MongoDB, and broadcasts the event to a real-time LAN dashboard via Socket.IO.

All processing happens **on-premise** — no cloud, no internet dependency.

> **Source code is private.** This document describes the project publicly. All file references point to the same repository.

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

## 🔄 How It Works

TamTap replaces manual attendance-taking with a fast, consistent hardware-software loop:

1. A student taps an NFC card on the RC522 reader.
2. The Raspberry Pi reads the card UID and looks up the student in MongoDB.
3. The Pi Camera v2 captures a snapshot.
4. OpenCV Haar cascade checks whether a face is present in the frame.
5. The system records the attendance result (present / late / fail) into MongoDB.
6. The result broadcasts to the LAN dashboard via Socket.IO in real time.
7. The hardware resets to `IDLE`, ready for the next tap.

```text
Student taps NFC card
        │
        ▼
  ┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐
  │ RC522 reads  ├───►│ Lookup student   ├───►│ Validate        │
  │ NFC UID      │    │ in DB (Mongo/JSON)│   │ schedule/time   │
  └─────────────┘    └──────────────────┘    └────────▬────────┘
                                                       │
                                              ┌────────▼────────┐
                                              │ Capture photo   │
                                              │ (rpicam-still)  │
                                              └────────▬────────┘
                                                       │
                                              ┌────────▼────────┐
                                              │ Haar cascade    │
                                              │ face detection  │
                                              └────────▬────────┘
                                                       │
                                    ┌──────────────────┴──────────────────┐
                                    │                                     │
                              Face detected?                         No face
                                    │                                     │
                              ┌─────▼─────┐                      ┌───────▼───────┐
                              │ Save to DB │                      │ Red LED +     │
                              │ Green LED  │                      │ Buzzer fail   │
                              │ Buzzer OK  │                      │ LCD: FAIL     │
                              └─────▬─────┘                      └───────────────┘
                                    │
                              ┌─────▼────────────┐
                              │ POST /api/hardware/ │
                              │ attendance          │
                              └─────▬────────────┘
                                    │
                              ┌─────▼────────────┐
                              │ Socket.IO broadcast │
                              │ attendance:new      │
                              └────────────────────┘
```

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
│  └──────▬───────┘    └──────▬───────┘    └──────▬───────┘      │
│         │                   │                   │               │
│  ┌──────▼─────────────────▼─────────────────▼──────────┐   │
│  │              tamtap.py (Python 3.11)                     │   │
│  │         State Machine + Face Detection (Haar)            │   │
│  │         GPIO: Green LED (17) | Red LED (27) | Buzzer(18) │   │
│  └──────────────────────▬──────────────────────────────────┘   │
│                         │ HTTP POST /api/hardware/*             │
│  ┌──────────────────────▼───────────────────────────────┐   │
│  │              server.js (Node.js 20 / Express)            │   │
│  │         REST API + Socket.IO + Session Auth              │   │
│  └──────────────────────▬───────────────────────────────┘   │
│                         │                                       │
│  ┌──────────────────────▼───────────────────────────────┐   │
│  │              MongoDB (Local Instance)                    │   │
│  │         Collections: students, teachers, attendance,     │   │
│  │         admins, calendar, schedules, settings            │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                                 │
└───────────────────────────────▬─────────────────────────────────┘
                                │ LAN (port 3000)
                    ┌───────────▼───────────┐
                    │   Browser Dashboard   │
                    │  (HTML/CSS/Vanilla JS) │
                    │  Tailwind + Chart.js   │
                    └───────────────────────┘
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
GPIO 5  ─── START button   (to GND)
GPIO 6  ─── RESTART button (to GND)
GPIO 8  ─── RC522 SDA/CS
GPIO 9  ─── RC522 MISO
GPIO 10 ─── RC522 MOSI
GPIO 11 ─── RC522 SCK
GPIO 13 ─── STOP button    (to GND, hold 2.5s)
GPIO 17 ─── Green LED (success)
GPIO 18 ─── Buzzer (via relay)
GPIO 25 ─── RC522 RST
GPIO 27 ─── Red LED (fail)
I2C SDA ─── LCD SDA
I2C SCL ─── LCD SCL
```

![Wiring Diagram](https://github.com/CharlesNaig/TamTap/blob/d9c751f90a32667d2d29fd973ff58f63e2dee5cd/assets/backgrounds/Wiring-Diagram.png)

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
| `connect-mongo` | MongoDB-backed session store |
| `express-rate-limit` | Rate limiting (login, API) |
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

## 📁 Repository Structure

```text
TamTap/
├── assets/
│   ├── attendance_photos/        # Captured attendance photos (by date)
│   ├── backgrounds/              # UI background images
│   ├── icons/                    # Favicon and UI icons
│   ├── logos/                    # FEU x TamTap branding logos
│   ├── researchers/              # Research team photos
│   └── templates/                # Schedule import templates
│
├── buttons/
│   ├── button_listener.py        # GPIO button controller (start/restart/stop)
│   ├── tamtap-buttons.service    # Systemd unit: button listener
│   └── tamtap-server.service     # Systemd unit: Node.js server
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
│   │   ├── auth.js               # Session auth middleware
│   │   └── hardwareAuth.js       # Hardware API key auth (Pi → Server)
│   ├── routes/
│   │   ├── admin.js              # Teacher/student CRUD (admin only)
│   │   ├── archive.js            # Attendance archival management
│   │   ├── attendance.js         # Attendance queries
│   │   ├── auth.js               # Login/logout/session
│   │   ├── calendar.js           # Academic calendar management
│   │   ├── export.js             # XLSX/PDF report generation
│   │   ├── logs.js               # Live systemd log streaming
│   │   ├── notifications.js      # Pending absences & excused marking
│   │   ├── schedules.js          # Section schedule management
│   │   ├── stats.js              # Dashboard statistics & analytics
│   │   └── students.js           # Student/teacher data queries
│   ├── utils/
│   │   ├── Logger.js             # Signale-based structured logging
│   │   ├── dateUtils.js          # Philippine timezone date utilities
│   │   ├── filenameSanitizer.js  # Photo filename sanitization
│   │   └── sanitize.js           # Input sanitization (NoSQL injection guard)
│   └── public/
│       ├── index.html            # Landing page
│       ├── login.html            # Login page
│       ├── dashboard.html        # Main dashboard
│       ├── admin.html            # Admin panel
│       ├── privacy.html          # Privacy policy
│       ├── terms.html            # Terms of use
│       ├── researchers.html      # Research team page
│       └── 404.html              # Custom 404 error page
│
└── test/
    ├── test_rfid.py              # RFID reader test
    ├── test_lcd.py               # LCD display test
    ├── test_leds.py              # LED test
    ├── test_buzzer.py            # Buzzer test
    └── test_dry_run.py           # Full system dry run (no hardware)
```

---

## 🔁 State Machine

All hardware modules **must** follow this state flow:

```text
          ┌─────────────────────────────────────────┐
          │                                         │
          ▼                                         │
       ┌──────┐    Card read     ┌───────────────┐  │
       │ IDLE │ ────────────────►│ CARD_DETECTED │  │
       └──────┘                  └───────▬───────┘  │
                                         │          │
                                         ▼          │
                                ┌────────────────┐  │
                                │ CAMERA_ACTIVE  │  │
                                └───────▬────────┘  │
                                        │           │
                              ┌─────────┴─────────┐ │
                              │                   │ │
                              ▼                   ▼ │
                        ┌─────────┐         ┌──────┐│
                        │ SUCCESS │         │ FAIL ││
                        └────▬────┘         └──▬───┘│
                             │                 │    │
                             └─────────────────┘────┘
```

**Rules:**

- No state skipping — every transition is sequential
- No parallel state transitions
- Every cycle must return to `IDLE`
- `SHUTDOWN` state only on `SIGINT`/`SIGTERM`

![Flow Chart](https://github.com/CharlesNaig/TamTap/blob/d9c751f90a32667d2d29fd973ff58f63e2dee5cd/assets/backgrounds/Flow-Chart.png)

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

**All code is non-blocking. No `sleep()` calls that violate this budget.**

---

## 🗄 Database Schema

### Collections

| Collection | Purpose |
|---|---|
| `students` | Registered student records with NFC IDs |
| `teachers` | Teacher/adviser/admin accounts with hashed passwords |
| `admins` | Separate admin account collection |
| `attendance` | All attendance events (one per UID per day) |
| `schedules` | Per-section weekly schedules with grace periods |
| `calendar` | Suspensions and no-class declarations |
| `settings` | System-wide configurable settings |

#### `students`

```js
{
  nfc_id:     String,  // Unique NFC card UID (required, indexed)
  tamtap_id:  String,  // Human-readable TamTap ID
  name:       String,  // Full name
  grade:      String,  // e.g. "12"
  section:    String,  // e.g. "12-ICT-A"
  registered: String   // ISO date string
}
```

#### `attendance`

```js
{
  nfc_id:   String,  // Student NFC UID
  name:     String,
  role:     String,  // "student" | "teacher"
  date:     String,  // "YYYY-MM-DD HH:MM:SS"
  time:     String,  // "HH:MM:SS"
  session:  String,  // "AM" | "PM"
  status:   String,  // "present" | "late" | "absent" | "excused"
  photo:    String,  // Captured photo filename
  section:  String
}
```

#### `schedules`

```js
{
  section: String,
  weekly_schedule: {
    monday:    { start: "07:00", end: "17:00" },
    tuesday:   { start: "07:00", end: "17:00" },
    // ...
    saturday:  { start: null, end: null }
  },
  grace_period_minutes:     Number,  // Default: 20
  absent_threshold_minutes: Number   // Default: 60
}
```

### Calendar Priority Order

```text
1. School-wide suspension (Admin)          ← Highest priority
2. Section no-class declaration (Teacher)
3. Weekend rules (Sat disabled, Sun always off)
4. Normal instructional day (Mon–Fri)      ← Lowest priority
```

---

## 📡 API Surface

Base URL: `http://<host>:3000/api`

### Authentication

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | Login — returns session cookie |
| `POST` | `/api/auth/logout` | Session | Destroy session |
| `GET` | `/api/auth/me` | Session | Get current user info |

### Attendance

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/attendance` | Session | Today's records |
| `GET` | `/api/attendance/:date` | Session | Records by date (YYYY-MM-DD) |
| `GET` | `/api/attendance/range` | Session | Records by date range |

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
| `POST` | `/api/schedules` | Admin | Create schedule |
| `PUT` | `/api/schedules/:section` | Admin/Adviser | Update schedule |
| `POST` | `/api/schedules/import` | Admin | Import from XLSX |

### Export

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/export/xlsx` | Session | Download XLSX report |
| `GET` | `/api/export/pdf` | Session | Download PDF report |

### Hardware Bridge (API Key Protected)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/hardware/attendance` | Hardware Key | Record attendance from `tamtap.py` |
| `POST` | `/api/hardware/fail` | Hardware Key | Failure event from `tamtap.py` |
| `POST` | `/api/hardware/status` | Hardware Key | Status update from `tamtap.py` |

### Health Check

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | Server health + uptime |

---

## 📡 Socket.IO Events

Only these events are emitted — contract-enforced, no custom events allowed.

### Attendance Events (hardware → dashboard)

| Event | Payload | Description |
|---|---|---|
| `attendance:new` | `{ nfc_id, name, role, date, time, session, photo, section }` | New attendance recorded |
| `attendance:fail` | `{ nfc_id, name, reason, decline_code }` | Attendance failed |
| `camera:snapshot` | `{ photo_url }` | Camera snapshot taken |
| `system:status` | `{ status, mongodb, clients, hardware }` | System health update |

### Log Streaming Events (admin panel ↔ server)

| Event | Direction | Description |
|---|---|---|
| `logs:subscribe` | Client → Server | Request real-time log stream |
| `logs:entry` | Server → Client | Push a log entry |
| `logs:error` | Server → Client | Report a log stream error |
| `logs:unsubscribe` | Client → Server | Stop the log stream |

---

## 🖥 Frontend Pages

| Page | Path | Description |
|---|---|---|
| Landing | `/index.html` | Public landing page with hero slideshow |
| Login | `/login.html` | Username/password login (session) |
| Dashboard | `/dashboard.html` | Real-time attendance feed + charts |
| Admin | `/admin.html` | Student/teacher management, schedules, calendar, logs |
| Privacy | `/privacy.html` | Privacy policy (Data Privacy Act compliance) |
| Terms | `/terms.html` | Terms of use |
| Researchers | `/researchers.html` | Research team profiles |
| 404 | `/404.html` | Custom error page |

### Frontend Architecture

| Rule | Detail |
|---|---|
| Structure | Multi-page HTML — no SPA frameworks |
| JS per page | One JS file per HTML page, no inline scripts |
| HTTP calls | Fetch API only — no Axios |
| Live updates | Socket.IO client only for real-time feeds |
| Styling | Tailwind CSS via CDN with shared config |
| Role-based UI | Admin / Adviser / Teacher via JS logic |

---

## 🔒 Security Design

| Concern | Approach |
|---|---|
| Authentication | Session-based with `express-session` and `connect-mongo` |
| Password storage | `bcryptjs` hashing — no plaintext passwords |
| Hardware bridge | Shared `HARDWARE_SECRET` key between Pi and server |
| Input validation | `sanitize.js` guards all MongoDB queries (NoSQL injection) |
| Rate limiting | `express-rate-limit` on login and API routes |
| CSRF protection | `sameSite: 'Strict'` on session cookies |
| No cloud | All processing on-premise — no Firebase, AWS, or Supabase |
| No face matching | Haar cascade detection only — no biometric identification |
| No public signup | Admin creates all accounts — no self-registration endpoint |

---

## 👨‍💻 Authors

| Name | Role |
|---|---|
| **Charles Giann Marcelo** | Lead Developer |
| et al. | FEU Roosevelt Marikina, Grade 12 ICT B Group 5 |

---

## 📄 License

Copyright (c) 2026 Charles Giann Marcelo — **All Rights Reserved.**

This software and its source code are the exclusive property of Charles Giann Marcelo. Unauthorized copying, distribution, modification, public display, or sale of this software, in whole or in part, is strictly prohibited without the express written permission of the copyright holder.

For licensing inquiries or commercial use, contact the author directly.

> See the [LICENSE](../LICENSE) file for the full notice.

---

<div align="center">

*TamTap NFC-Based Attendance System | FEU Roosevelt Marikina | S.Y. 2025–2026*

</div>
