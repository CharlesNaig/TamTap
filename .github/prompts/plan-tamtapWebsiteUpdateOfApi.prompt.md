# TAMTAP Dashboard Prompt Plan (prompt.md)

**Purpose:** Clear, implementation-ready prompt for building the TAMTAP teacher-first dashboard, API, and hardware→API bridge. Use this as the single-source prompt for Copilot, a developer, or documentation. This plan follows the project contract and extends the API plan already created. 

---

## 1. Overview & Goals

* Build a teacher-first dashboard that integrates with the Raspberry Pi NFC system and MongoDB.
* Primary users: teachers (full dashboard), admin (system settings), students (optional read-only view).
* Main priorities: usability, reliable backtracking by section, real-time updates, LAN-only operation, and defensible architecture for your research.
* Bridge approach: **Option A - HTTP POST** from `tamtap.py` to the Express API; Express will broadcast to connected dashboards with Socket.IO.

---

## 2. High-level Architecture (reminder)

* `tamtap.py` (Pi) → HTTP POST → `software/server.js` (Express + Socket.IO) → MongoDB (local)
* Frontend clients connect via Socket.IO for live updates and via REST for historical queries. 

---

## 3. Roles & Permissions

* `teacher`

  * properties: id, name, email, sections_handled: [sectionId,...]
  * capabilities: view section attendance, export CSV, view snapshots, filter by date, mark attendance issues (optional)
* `admin`

  * properties: id, name, role=admin
  * capabilities: manage teachers, assign sections, system status, view all sections
* `student` (optional read-only)

  * properties: id, name, nfc_id, sectionId
  * capabilities: view own attendance history

Authentication: Basic session-based login for demo. Document as "replace with school SSO later" for future work.

---

## 4. Section Assignment Model (Chosen)

**Model B - Multiple Sections per Teacher (recommended)**

* Teacher record contains `sections_handled: Array<sectionId>`.
* On login, teacher sees a section selector defaulting to the first assigned section for today.
* Admin can edit `sections_handled`. Assignment changes propagate immediately.

---

## 5. Data Models (minimal, extendable)

```js
// students
{
  _id,
  uid,           // student unique id
  name,
  grade,
  section,       // sectionId
  nfc_id
}

// teachers
{
  _id,
  uid,
  name,
  email,
  sections_handled: [sectionId, ...]
}

// sections
{
  _id,
  name,          // e.g., "11-A"
  grade
}

// attendance
{
  _id,
  uid,           // student uid
  student_name,
  date: "YYYY-MM-DD",
  time: "HH:MM:SS",
  status: "present" | "absent" | "late" | "fail",
  photo_path,    // relative path served by Express
  session,       // optional session id
  section
}
```

---

## 6. API Endpoints (server.js - REST)

```
GET  /api/attendance?section={id}&date={YYYY-MM-DD}        // today's or specified date
GET  /api/attendance/:date?section={id}                    // by date
GET  /api/attendance/range?section={id}&from=YYYY-MM-DD&to=YYYY-MM-DD

GET  /api/students?section={id}
GET  /api/teachers
GET  /api/sections
GET  /api/stats?section={id}&range=week|month

POST /api/webhook/attendance   // tamtap.py -> HTTP POST payload on new record
```

**Static photo serving**

```
GET /photos/:date/:filename
```

---

## 7. Socket.IO Events (server publishes)

* `attendance:new`   - payload: the newly saved attendance object
* `attendance:fail`  - payload: reason + partial data
* `camera:snapshot`  - payload: { uid, photo_url, date, time }
* `system:status`    - payload: health info

Event naming must match the Copilot Contract. 

---

## 8. tamtap.py -> POST Payload Example

```json
{
  "uid": "S12345",
  "name": "Juan Dela Cruz",
  "section": "11-A",
  "date": "2026-01-16",
  "time": "07:45:12",
  "status": "present",
  "photo_path": "/photos/2026-01-16/j12345.jpg",
  "session": "morning"
}
```

tamtap.py should POST to `/api/webhook/attendance` and retry on network errors (exponential backoff x3).

---

## 9. Frontend Pages & UI Goals

* Login page - role redirect
* Teacher Dashboard (main) - default: My Section Today

  * Top bar: Section selector (left), date picker (center), Export button (right)
  * Main: Live feed and table of students with small badges (status) and a click-to-view snapshot modal
  * Quick filters: Today / Week / Month
* Attendance Records page - robust filters and CSV export
* Stats page - Chart.js for trends
* Admin page - section management and teacher assignments

UI principles:

* Section-first flow
* Minimal clicks: section + date → data
* Visual statuses (colored badges) and on-demand photos
* Action buttons consistent across pages and always visible in same locations

---

## 10. UX Details (teacher-first)

* On login, auto-load first assigned section with Today filter
* Section dropdown shows number of students and last tap time
* Each student row: name, uid, time, status badge, snapshot icon
* Clicking a student row opens history in a side panel (last 7 entries)
* Export button applies to current filters only
* Admin can assign/unassign sections in Admin page

---

## 11. Acceptance Criteria (done when)

* Teacher can log in and see only assigned sections
* Teacher selects section/date and gets attendance list within 1 second for local LAN
* Live updates appear within 500 ms after POST → Socket.IO broadcast
* CSV export for current filter works and contains photo_path
* Clicking a student shows last 7 records with thumbnails
* Server logs show `attendance:new` emitted on insert

---

## 12. Implementation Notes for Copilot / Devs (prompt header)

Paste this at top of generated server file or Copilot snippet:

```text
# TAMTAP SERVER: Express + Socket.IO
# Follow contract: local MongoDB, no cloud, events: attendance:new, attendance:fail, camera:snapshot, system:status
# Use environment variables in config.js (MONGODB_URI, PORT). No hardcoded credentials.
```

---

## 13. Testing & QA Checklist

* [ ] POST a mock payload from a dev script and verify DB insert + Socket.IO broadcast
* [ ] Login as teacher user with 2 sections assigned; ensure dropdown lists both
* [ ] Export CSV for a date range and verify file integrity
* [ ] Simulate camera fail and ensure `attendance:fail` is emitted
* [ ] Security: ensure REST endpoints require auth for write operations

---

## 14. Next Actions (concrete)

1. Implement `software/server.js` with endpoints and Socket.IO according to section 6. Use the header in section 12.
2. Add `POST /api/webhook/attendance` handler that saves to MongoDB and emits `attendance:new`.
3. Modify `tamtap.py` to send HTTP POST (payload per section 8).
4. Build `public/index.html` + `public/js/dashboard.js` to connect via Socket.IO and REST.
5. Test on LAN and iterate.

---

## 15. Notes for Defense / Paper

* Emphasize teacher-first design and section-based permissions.
* Explain HTTP POST choice as simplest reliable LAN approach with clear retry semantics.
* Show acceptance criteria and testing checklist as evidence of reproducibility.

---

If you approve this prompt.md, I will:

* Create the actual `prompt.md` file content in the repo (or paste it here ready to save), and
* Begin scaffolding `software/server.js` and the webhook handler next.

Want me to create the file now? ✅
