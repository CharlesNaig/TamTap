# TAMTAP API Implementation Plan

## 🏗️ Architecture Gap Diagram

```
CURRENT STATE:
┌─────────────────┐     ┌─────────────┐
│   tamtap.py     │────▶│  MongoDB    │
│  (Raspberry Pi) │     │             │
└─────────────────┘     └─────────────┘
         ↓
    [DEAD END - No connection to Frontend]


REQUIRED STATE (per contract):
┌─────────────────┐     ┌─────────────┐     ┌─────────────────┐
│   tamtap.py     │────▶│  MongoDB    │◀────│  Express.js     │
│  (Raspberry Pi) │     │             │     │  + Socket.IO    │
└────────┬────────┘     └─────────────┘     └────────┬────────┘
         │                                           │
         │  HTTP POST or Socket.IO emit              │ Socket.IO broadcast
         └───────────────────────────────────────────┘
                                                     │
                                          ┌──────────▼──────────┐
                                          │  Frontend Dashboard │
                                          │  (HTML + JS)        │
                                          └─────────────────────┘
```

---

## 📋 Build Order

### Phase 1: API Server (software/)
```
Priority: 🔴 CRITICAL - Do this FIRST

□ software/server.js        - Express.js + Socket.IO server
□ software/package.json     - Dependencies (express, socket.io, mongodb)
□ software/config.js        - Environment config (no hardcoded secrets)
□ software/routes/
    □ attendance.js         - Attendance API routes
    □ students.js           - Student API routes
    □ stats.js              - Dashboard statistics

API Endpoints:
  - GET  /api/attendance              (today's records)
  - GET  /api/attendance/:date        (by date YYYY-MM-DD)
  - GET  /api/attendance/range        (date range query)
  - GET  /api/students                (all students)
  - GET  /api/teachers                (all teachers)
  - GET  /api/stats                   (dashboard stats)
  - GET  /photos/:date/:filename      (static photo serving)
```

### Phase 2: Hardware → API Bridge
```
Priority: 🔴 CRITICAL

Option A (Recommended): HTTP POST from tamtap.py
  □ Add requests library to tamtap.py
  □ POST to Express server on attendance save
  □ Express broadcasts via Socket.IO

Option B: MongoDB Change Streams
  □ Express watches attendance collection
  □ Auto-broadcast on insert

Option C: Socket.IO client in Python
  □ Add python-socketio to tamtap.py
  □ Emit directly to Socket.IO server

Socket.IO Events (per contract):
  - attendance:new    (on successful tap)
  - attendance:fail   (on failed tap)
  - camera:snapshot   (photo captured)
  - system:status     (system health)
```

### Phase 3: Frontend Pages
```
Priority: 🟡 After API is ready

□ software/public/index.html       - Dashboard (live attendance)
□ software/public/students.html    - Student list/management
□ software/public/reports.html     - Attendance reports by date
□ software/public/admin.html       - Admin panel

□ software/public/js/
    □ dashboard.js                 - Live updates via Socket.IO
    □ students.js                  - Student CRUD
    □ reports.js                   - Report generation
    □ admin.js                     - Admin functions

□ software/public/css/
    □ styles.css                   - Tailwind compiled or CDN

Libraries (CDN):
  - Tailwind CSS
  - Chart.js (statistics)
  - SweetAlert2 (alerts)
  - Socket.IO client
```

---

## 🚨 Contract Violations to Fix

| Issue | Location | Fix |
|-------|----------|-----|
| MongoDB on remote server | tamtap.py | Change to localhost or use config file |
| No Socket.IO events | tamtap.py | Add HTTP POST to Express on save |
| Hardcoded credentials | MONGODB_URI | Use environment variables or config.js |
| software/main.js empty | software/ | Implement Express server |

---

## 📁 Target File Structure

```
software/
├── server.js              # Main Express + Socket.IO server
├── package.json           # Node.js dependencies
├── config.js              # Configuration (DB, ports, etc.)
├── routes/
│   ├── attendance.js      # GET /api/attendance/*
│   ├── students.js        # GET /api/students, /api/teachers
│   └── stats.js           # GET /api/stats
└── public/
    ├── index.html         # Dashboard
    ├── students.html      # Student management
    ├── reports.html       # Attendance reports
    ├── admin.html         # Admin panel
    ├── js/
    │   ├── dashboard.js
    │   ├── students.js
    │   ├── reports.js
    │   └── admin.js
    └── css/
        └── styles.css
```

---

## ⏱️ Estimated Work

| Component | Time |
|-----------|------|
| Express.js API Server | 2-3 hours |
| Socket.IO Integration | 1-2 hours |
| Hardware Bridge (tamtap.py) | 1 hour |
| Dashboard Frontend | 3-4 hours |
| Reports Page | 2 hours |
| Admin Panel | 2-3 hours |
| Testing & Polish | 2-3 hours |
| **TOTAL** | **~15-20 hours** |

---

## ✅ Next Action

Start with Phase 1: Create `software/server.js` with:
1. Express.js setup
2. MongoDB connection (configurable)
3. Socket.IO server
4. Basic API routes
5. Static file serving for photos
