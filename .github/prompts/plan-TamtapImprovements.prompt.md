PROJECT: TAMTAP – NFC-Based Attendance System
CONTEXT: Existing backend, hardware integration, admin + teacher dashboard
GOAL: Fix critical bugs, add missing academic features, and extend reporting
IMPORTANT: Follow existing architecture. Do NOT redesign the system.

==================================================
PART 1: DATABASE – DUPLICATE NFC_ID ERROR (TEACHERS) (important)
==================================================

Problem:
MongoDB throws:
E11000 duplicate key error on `teachers.nfc_id` where value is `null`.

Required Fix:
1. Teachers do NOT require NFC IDs.
2. NFC ID must be OPTIONAL for teachers.
3. Ensure `nfc_id` uniqueness applies ONLY when value is NOT null.

Implementation Requirements:
- Modify the teacher schema so that:
  - `nfc_id` is optional
  - Unique index ignores null values (sparse or partial index)
- Prevent duplicate-key errors when registering teachers without NFC cards.
- Validate teacher creation logic so `nfc_id` is never auto-set to null explicitly.

==================================================
PART 2: HARDWARE – RFID READER STUCK AFTER FIRST TAP (important)
==================================================

Problem:
RC522 reader sometimes freezes after first successful read.
Requires SDA pin refresh or system restart.

Required Fix:
1. Improve NFC read loop stability.
2. Ensure reader resets properly after each read attempt.
3. Prevent blocking or infinite wait states.
4. Add logging for stuck-read detection.

Implementation Requirements:
- Add timeout handling to NFC read cycle.
- Reinitialize RC522 reader after each tap OR after timeout.
- Clear SPI buffers if needed.
- Ensure non-blocking read logic.
- Add debug logs for:
  - Read start
  - UID detected
  - Read timeout
  - Reader reset

- Hardware script path: #file:tamtap.py

==================================================
PART 3: AUTH – TEACHER PASSWORD RESET (important)
==================================================

Required Features:
1. Admin can reset a teacher’s password.
2. Reset options:
   - Set to default password OR (deafult password tamtap@${teachername})
   - Set a new password manually.
3. Teacher cannot self-reset (no student/teacher public access).

Implementation Requirements:
- Admin-only endpoint to reset password.
- Password must be re-hashed.
- Log password reset action (who reset, when).
- Optional: Force password change on next login (flag-based).

==================================================
PART 4: BACKDATING & CALENDAR-BASED ATTENDANCE VIEW (important)
==================================================

Required Feature:
Teachers can view attendance for past dates.

UI / Logic Rules:
1. Add date selector (calendar or dropdown).
2. Sundays are DISABLED (no classes).
3. Saturdays:
   - Disabled by default
   - Enabled ONLY if admin allows Saturday classes.
4. Selected date updates:
   - Attendance table
   - Summary cards
   - Export results

Implementation Requirements:
- Backend must accept date parameter for attendance queries.
- Validate date against academic calendar rules.
- Return appropriate flags:
  - isInstructionalDay
  - isSuspended
  - isNoClass

#file:admin.html #file:admin.js #file:tamtap_admin.py 

==================================================
PART 5: ADMIN – SATURDAY CLASS ENABLE TOGGLE (important)
==================================================

Required Feature:
Admin can globally enable or disable Saturday classes.

Rules:
- Default: Saturday = non-instructional
- Admin toggle enables Saturday attendance system-wide
- Must be respected by:
  - Attendance logging
  - Backdating
  - Summary statistics
  - Export

Implementation Requirements:
- Store setting in database (not hardcoded).
- Cache or load setting on server start.
- Expose admin-only endpoint to toggle.
- Ensure frontend only reflects backend decision.

#file:admin.js  #file:admin.html #file:tamtap_admin.py
==================================================
PART 6: EXPORT – CSV AND PDF REPORTS (important)
==================================================

Required Features:
Teachers can export attendance reports as:
1. XLSX
2. PDF

XLSX Rules:
- Plain tabular data
- Columns:
  Student Name | Student Email | Section | Date | Status (present/absent/late) | Time | NFC_ID / TAMTAP_ID (from database) | Photo (snapshots of their faces.)
- Downloadable file 
- Format : #file:ExportAttendanceFormat.xlsx 

PDF Rules:
- Must visually match website layout or format
- Use TAMTAP + FEU logos (existing assets) : #file:TamTap-3D.png logo
- Include:
  - Header (school, section, date range)
  - Attendance table
  - Footer (system + academic year)
- PDF is READ-ONLY, no interaction

Implementation Requirements:
- Separate export endpoints.
- Do NOT generate files on frontend.
- Backend generates and returns files.
- Respect calendar rules (skip Sundays, suspensions, no-class days).

Leave blanks for:
- Export controller file: pdf or xlsx format
- 

--- (important)
PHOTO SNAPSHOTS SAVINGS, Let's create a tamtap picture vault for their picture that can be saved and viewed.

==================================================
GENERAL CONSTRAINTS 
==================================================

DO NOT:
- Add student website access
- Add frontend attendance computation
- Break existing endpoints
- Hardcode academic rules
- Ignore audit logging

DO:
- Keep logic backend-driven
- Use clear logging
- Maintain role separation (Admin vs Teacher)
- Preserve data integrity

OUTPUT EXPECTATION:
- Backend-safe changes
- Hardware stability improvements
- Feature-complete academic attendance flow
- No UI redesign unless necessary
