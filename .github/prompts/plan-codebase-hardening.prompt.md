# TAMTAP Codebase Hardening Plan

**Generated:** March 3, 2026
**Scope:** 11 Critical, 19 High, 26 Medium — 56 total issues
**Goal:** Fix all issues in priority order across 6 phases

---

## Phase 1: Security — Backend Auth & Injection (C-1 → C-4, H-7, H-19)

> **Why first:** These are exploitable right now by any student on the school LAN.

### 1.1 — C-1: Add auth to attendance, students, stats routes

**Files:** `routes/attendance.js`, `routes/students.js`, `routes/stats.js`
**What:** Add `requireAuth` middleware at top of each router. The hardware Python script calls these from localhost, so also add a localhost bypass OR use the hardware API key from C-2.
**Approach:**
```
router.use(requireAuth)  — top of each file
```
For hardware bridge compatibility: check `req.headers['x-hardware-key']` as an alternative to session auth.

### 1.2 — C-2: Add API key to hardware bridge endpoints

**Files:** `server.js` (3 endpoints), `.env`, `hardware/database.py`
**What:**
- Add `HARDWARE_SECRET` to `.env`
- Create `requireHardwareKey` middleware: checks `X-Hardware-Key` header
- Apply to `POST /api/hardware/attendance`, `/api/hardware/fail`, `/api/hardware/status`
- Update Python `database.py` to send the header on all API calls

### 1.3 — C-3: Remove debug endpoint

**File:** `server.js`
**What:** Delete the entire `/api/debug/attendance` block. Or wrap in `if (process.env.NODE_ENV !== 'production')`.

### 1.4 — C-4: Sanitize $regex inputs

**Files:** `routes/attendance.js`, `routes/stats.js`, `routes/notifications.js`, `routes/archive.js`
**What:** Create a shared `sanitizeDate(str)` util that validates `/^\d{4}-\d{2}-\d{2}$/` and rejects anything else. Replace all raw `$regex: \`^${userInput}\`` with validated input. For non-date regex usage, escape special chars.

### 1.5 — H-7: Rate limit login endpoint

**File:** `routes/auth.js`
**What:** Add `express-rate-limit` to `POST /login` — 5 attempts per minute per IP. Install the package.
```
npm install express-rate-limit
```

### 1.6 — H-19: CSRF mitigation via SameSite cookie

**File:** `config.js`
**What:** Add `sameSite: 'Strict'` to session cookie config. This is the minimal CSRF fix for a LAN-only app — no token infrastructure needed.

---

## Phase 2: Security — Frontend XSS (C-10, C-11, H-16, H-18)

> **Why second:** XSS can steal admin sessions and forge actions.

### 2.1 — C-10: Fix XSS via onclick injection in admin.html

**File:** `public/admin.html`
**What:** Replace all inline `onclick="fn('${name}')"` patterns with `data-*` attributes + event delegation. Affects:
- `deleteTeacher('${t.id}', '${t.name}')`
- `deleteStudent('${s.nfc_id}', '${s.name}')`
- `restoreSingleStudent('${s.nfc_id}', '${s.name}')`
- `editTeacher('${t.id}')`
- All similar patterns

**Approach:** Add `data-action`, `data-id`, `data-name` attributes to buttons, then one delegated `document.addEventListener('click', ...)` handler at bottom of script.

### 2.2 — C-11: Fix XSS in admin showPersonalInfo()

**File:** `public/admin.html`
**What:** Wrap `currentUser.name`, `currentUser.username`, `currentUser.email` in `escapeHtml()` inside the SweetAlert2 `html` template.

### 2.3 — H-16: Add missing credentials: 'include' on loadRoster()

**File:** `public/dashboard.html`
**What:** Add `{ credentials: 'include' }` to the fetch call in `loadRoster()`.

### 2.4 — H-18: CSV export formula injection protection

**File:** `public/dashboard.html`
**What:** Create `sanitizeCsvCell()` function that:
1. Escapes double quotes by doubling them
2. Prefixes `=`, `+`, `-`, `@`, `\t`, `\r` with a single quote
Apply to all cells in CSV export.

---

## Phase 3: Data Integrity (C-8, H-8, H-1, H-2, H-9, H-13, H-15)

> **Why third:** Without these, duplicate/lost records corrupt the attendance database.

### 3.1 — C-8 + H-8: Make attendance index unique

**Files:** `hardware/database.py`, `server.js`
**What:**
- Python: `create_index([("nfc_id", 1), ("date", 1)], unique=True)`
- Node.js: `createIndex({ nfc_id: 1, date: 1 }, { unique: true })`
- Add duplicate key error handling in all write paths (upsert or catch E11000)

### 3.2 — H-1: Atomic tamtap_id generation

**File:** `routes/admin.js`
**What:** Replace find-sort-increment with `findOneAndUpdate` on a counters collection:
```js
const counter = await db.collection('counters').findOneAndUpdate(
    { _id: 'student_tamtap_id' },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
);
const tamtap_id = String(counter.seq).padStart(3, '0');
```
Apply same pattern in bulk registration.

### 3.3 — H-2: Archive/delete race condition

**File:** `routes/admin.js`
**What:** Reorder operations: insert archive first, then delete. On failure, the worst case is a duplicate in archive (recoverable) rather than data loss. Add try/catch around the pair.

### 3.4 — H-9: Fix _sync_loop index-based slicing

**File:** `hardware/database.py`
**What:** Hold `_json_lock` for the entire sync transaction (read pending → sync → update JSON). Or match records by nfc_id+date instead of positional slicing.

### 3.5 — H-13: Add dedup check to manual sync_to_mongodb()

**File:** `hardware/tamtap_admin.py`
**What:** Before `insert_one(record)`, check `find_one({"nfc_id": nfc_id, "date": {"$regex": f"^{date_str}"}})`. Same pattern as `_sync_loop`.

### 3.6 — H-15: Fix remote sync retry index bug

**File:** `hardware/database.py`
**What:** Replace `records.index(record)` with enumeration:
```python
for idx, record in enumerate(records):
    # on error:
    retry_batch.extend(records[idx + 1:])
```

---

## Phase 4: Timing & Performance (C-5, C-6, C-7, M-4/HIGH, H-5, M-1–M-3, M-7)

> **Why fourth:** These directly impact the 3.5s tap-to-result contract and Pi memory.

### 4.1 — C-5: Make _check_mongodb() non-blocking

**File:** `hardware/database.py`
**What:** Remove the `_connect_mongodb()` call from `_check_mongodb()`. Only return `self.use_mongodb`. Let the existing background reconnect thread handle reconnection.
```python
def _check_mongodb(self):
    if not MONGODB_AVAILABLE:
        return False
    return self.use_mongodb
```

### 4.2 — C-6: Reuse detection photo as attendance photo

**File:** `hardware/tamtap.py`
**What:** In `process_card()`, after `detect_person()` succeeds, rename/copy the detection photo to the attendance photo path instead of running `rpicam-still` a second time. This cuts ~1.5s from the cycle.
```python
# Before: take_attendance_photo(user_data) — second camera capture
# After: shutil.copy2(detection_photo, attendance_photo_path)
```

### 4.3 — C-7: Cache schedule data and pass through

**Files:** `hardware/database.py`, `hardware/tamtap.py`
**What:**
1. In `process_card()`: pass `schedule_data` from `validate_tap_time()` into `save_attendance()`
2. In `save_attendance()`: accept optional `schedule_data` param, pass to `calculate_attendance_status()`
3. Add in-memory per-section per-day cache for schedule data (dict keyed by `section:date`)

### 4.4 — M-4 (PROMOTED TO HIGH): Philippine timezone consistency

**Files:** `routes/attendance.js`, `routes/stats.js`, `routes/archive.js`, `routes/export.js`, `routes/calendar.js`
**What:** Create shared `getPhilippineDate()` util (already exists in `notifications.js`). Extract to `utils/timezone.js`. Replace ALL `new Date().toISOString().split('T')[0]` with `getPhilippineDate()` across every route file.

### 4.5 — H-5: Replace unbounded archive stats query with aggregation

**File:** `routes/archive.js`
**What:** Replace `.find({}).toArray()` with aggregation pipeline:
```js
db.collection('attendance').aggregate([
    { $group: {
        _id: null,
        uniqueDates: { $addToSet: { $substr: ["$date", 0, 10] } },
        uniqueSections: { $addToSet: "$section" },
        uniqueStudents: { $addToSet: "$nfc_id" }
    }}
])
```

### 4.6 — M-1 to M-3: Fix N+1 queries

**Files:** `routes/export.js`, `routes/stats.js`
**What:**
- Export: Pre-fetch all students with `$in` on nfc_ids, build a lookup map
- Stats sections: Use aggregation `$group` by section
- Stats daily: Use aggregation `$group` by date substring

### 4.7 — M-7: Cap calendar range queries

**File:** `routes/calendar.js`
**What:** Validate `from`/`to` range. If > 90 days, return `400 Bad Request`. Add the check before the loop.

---

## Phase 5: Hardware Correctness (C-9, H-10, H-11, H-12, H-14, M-13–M-20)

> **Why fifth:** These cause crashes, hangs, or data corruption in edge cases.

### 5.1 — C-9: Fix NameError in tamtap_admin.py

**File:** `hardware/tamtap_admin.py`
**What:** Import `DB_FILE` from database module or define locally:
```python
DB_FILE = os.path.join(os.path.dirname(__file__), '..', 'database', 'tamtap_users.json')
```

### 5.2 — H-10: Add real timeout to register.py scan_blocking()

**File:** `hardware/register.py`
**What:** Replace blocking `reader.read()` with a polling loop using `read_no_block()` + `time.time()` deadline. Return `None` on timeout.

### 5.3 — H-11: Fix beep() docstring or make non-blocking

**File:** `hardware/tamtap.py`
**What:** Change docstring from "Non-blocking" to "Blocking buzzer beeps". Optionally, wrap in a daemon thread for true non-blocking behavior.

### 5.4 — H-12: Fix clean_old_photos() to traverse date subdirs

**File:** `hardware/tamtap_admin.py`
**What:** Replace `os.listdir()` with `os.walk()` to iterate `attendance_photos/YYYY-MM-DD/` subdirectories and compare date folders against retention threshold.

### 5.5 — H-14: Fix LCD.backlight() global mutation

**File:** `hardware/tamtap.py`
**What:** Change `LCD_BACKLIGHT` from a global to an instance variable `self._backlight`. Update all methods that read it to use `self._backlight`.

### 5.6 — M-13: Fix init_photo_storage() logging

**File:** `hardware/tamtap.py`
**What:** Replace `logging.info(f"...")` with `logger.info("...", %s)` for lazy formatting and consistent named logger usage.

### 5.7 — M-14 to M-16: Reduce blocking sleeps

**File:** `hardware/tamtap.py`
**What:**
- `success_state()`: Reduce `time.sleep(1.0)` → `time.sleep(0.5)`
- `no_face_state()`: Reduce `time.sleep(1.0)` → `time.sleep(0.5)`
- Main loop debounce: Reduce `time.sleep(2.0)` → `time.sleep(1.0)` + UID comparison to detect card removal

### 5.8 — M-17: Eliminate duplicate HTTP call for schedule

**File:** `hardware/tamtap.py`, `hardware/database.py`
**What:** Already addressed in Phase 4.3 (cache + pass-through). This is the same fix.

### 5.9 — M-18: Fix CSV export escaping in tamtap_admin.py

**File:** `hardware/tamtap_admin.py`
**What:** Replace manual f-string CSV building with Python's `csv` module:
```python
import csv
with open(filepath, 'w', newline='') as f:
    writer = csv.writer(f, quoting=csv.QUOTE_ALL)
    writer.writerow(headers)
    for r in records:
        writer.writerow([r.get(h, '') for h in header_keys])
```

### 5.10 — M-19: Fix signal handler to close DB

**File:** `hardware/tamtap_admin.py`
**What:** Store db reference in module-level variable, close in signal handler:
```python
_db_ref = None
def signal_handler(sig, frame):
    if _db_ref:
        _db_ref.close()
    sys.exit(0)
```

### 5.11 — M-20: Make shutdown_in_progress thread-safe

**File:** `hardware/tamtap.py`
**What:** Replace plain `bool` with `threading.Event()`:
```python
_shutdown_event = threading.Event()
# Check: _shutdown_event.is_set()
# Set: _shutdown_event.set()
```

---

## Phase 6: Frontend Polish & Backend Cleanup (H-3, H-4, H-6, H-17, M-5–M-10, M-21–M-26)

> **Why last:** These improve code quality and maintainability but don't break functionality.

### 6.1 — H-3 + H-17: Document or replace log streaming Socket.IO events

**Files:** `routes/logs.js`, `public/admin.html`
**What:** Add `logs:subscribe`, `logs:entry`, `logs:error`, `logs:unsubscribe` to the contract in `copilot-instructions.md`. These are legitimate operational events — update the contract rather than remove the feature.

### 6.2 — H-4: Add ObjectId validation in admin teacher routes

**File:** `routes/admin.js`
**What:** Add try/catch around `new ObjectId(id)` in PUT/DELETE/POST teacher routes. Return 400 on BSONError, matching the pattern already used in `calendar.js`.

### 6.3 — H-6: Remove plaintext password from API response

**File:** `routes/admin.js`
**What:** Remove `response.defaultPassword = passwordToSet`. Instead, return `response.isDefaultPassword = true` and let the frontend display the pattern "tamtap@{firstname}" without the actual value.

### 6.4 — M-5: Normalize nfc_id to always be String

**Files:** `routes/admin.js`, `routes/notifications.js`, `hardware/database.py`
**What:** Ensure all write paths cast `nfc_id` to `String()`. Remove triple-query `$or` patterns in notifications.js and replace with `{ nfc_id: String(nfc_id) }`.

### 6.5 — M-6: Replace sync file I/O in archive route

**File:** `routes/archive.js`
**What:** Replace `fs.readFileSync` / `fs.writeFileSync` with `fs.promises.readFile` / `fs.promises.writeFile`. Make the function async.

### 6.6 — M-8: Remove student names from gallery endpoint

**File:** `server.js`
**What:** Remove `name` and `section` from the `/api/gallery/recent` response. Return only `url` and `time`.

### 6.7 — M-9 + M-10: Add auth to calendar/schedule GET routes

**Files:** `routes/calendar.js`, `routes/schedules.js`
**What:** Add `optionalAuth` to GET routes. For `schedules/today/:section` (called by hardware), allow hardware key as alternative auth.

### 6.8 — M-11 + M-12: Document unapproved libraries

**File:** `.github/copilot-instructions.md`
**What:** Update approved library list to include `opencv-python-headless` (required for Haar cascade face detection), `pymongo` (required for MongoDB), `python-dotenv` (required for .env config). These are essential — the contract just wasn't updated.

### 6.9 — M-21: Extract shared Tailwind config

**Files:** All HTML pages
**What:** Create `public/js/tailwind-config.js` with the shared config. Update all pages to load it before the Tailwind CDN script. Ensure `feu-gold-dark` is present in all pages.

### 6.10 — M-22: Extract inline JS to separate files

**Files:** `public/dashboard.html` → `public/js/dashboard.js`, `public/admin.html` → `public/js/admin.js`, `public/login.html` → `public/js/login.js`
**What:** Cut the `<script>` blocks, paste into external files, replace with `<script src="./js/{page}.js" defer></script>`. The contract says "One JS file per page" — this fulfills it.

### 6.11 — M-23: Bundle CDN dependencies locally

**What:** Download and serve locally:
```
npm install tailwindcss chart.js sweetalert2
```
Copy minified builds to `public/vendor/`. Replace CDN `<script>`/`<link>` tags with local paths. Critical for offline LAN deployment.

### 6.12 — M-24: Extract shared @font-face to fonts.css

**Files:** `public/css/dashboard.css`, `public/css/login.css`, `public/css/admin.css`, `public/css/researchers.css`
**What:** Create `public/css/fonts.css` with the `@font-face` declaration. Remove duplicates from all other CSS files. Add `<link rel="stylesheet" href="./css/fonts.css">` to all pages.

### 6.13 — M-25: Extract shared escapeHtml() to utils.js

**Files:** `public/dashboard.html`, `public/admin.html`
**What:** Create `public/js/utils.js` with `escapeHtml()` and any other shared functions. Import in both pages.

### 6.14 — M-26: Add GET /api/admin/teachers/:id endpoint

**File:** `routes/admin.js`
**What:** Add single-teacher fetch route. Update `editTeacher()` in `admin.html` to call it instead of fetching all teachers.

---

## Execution Order Summary

| Phase | Issues | Est. Effort | Files Touched |
|-------|--------|-------------|---------------|
| **1. Backend Security** | C-1, C-2, C-3, C-4, H-7, H-19 | ~2 hours | 8 route files, server.js, config.js, .env |
| **2. Frontend XSS** | C-10, C-11, H-16, H-18 | ~1.5 hours | admin.html, dashboard.html |
| **3. Data Integrity** | C-8, H-8, H-1, H-2, H-9, H-13, H-15 | ~2 hours | database.py, server.js, admin.js, tamtap_admin.py |
| **4. Timing & Perf** | C-5, C-6, C-7, M-4, H-5, M-1–M-3, M-7 | ~3 hours | tamtap.py, database.py, 5 route files |
| **5. Hardware Fixes** | C-9, H-10–H-14, M-13–M-20 | ~2 hours | tamtap.py, tamtap_admin.py, register.py |
| **6. Polish & Cleanup** | H-3, H-4, H-6, H-17, M-5–M-26 | ~4 hours | All route files, all HTML files, CSS files |

**Total estimated effort: ~14.5 hours across 6 phases**

---

## Notes

- M-4 (timezone) promoted to HIGH per your request
- C-8 attendance unique index confirmed for fix
- H-7 rate limiting confirmed — will install express-rate-limit
- C-6 double camera capture confirmed by your observation
- M-11/M-12 are contract documentation updates, not code removals
- Each phase is independently deployable — you can test after each one

---

*This plan was generated from the full codebase review conducted on March 3, 2026.*
