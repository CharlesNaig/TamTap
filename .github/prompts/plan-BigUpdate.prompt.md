PROJECT: TAMTAP – NFC-Based Attendance System
CONTEXT: Existing system with backend, hardware integration, admin + teacher dashboard
GOAL: Implement feature enhancements and UI improvements
IMPORTANT: Follow existing architecture. Maintain current tech stack constraints.

==================================================
PART 1: FEU × TAMTAP BRANDING (EXPORTS)
==================================================

Requirement:
Centralize and unify branding in all export outputs.

Implementation:
1. XLSX exports:
   - Merge and center header row (Row 1) with "FEU × TAMTAP" branding
   - Use FeuXTamTap.png logo embedded in worksheet
   - Consistent FEU Green (#0A8249) and Gold (#FFD700) styling

2. PDF exports:
   - Centered header with TamTap-3D.png logo
   - FEU Roosevelt Marikina school name
   - "TAMTAP Attendance Report" title with brand colors

Files to modify:
- #file: exports.js (routes)

==================================================
PART 2: ATTENDANCE PHOTO STORAGE (EXTERNAL SD CARD)
==================================================

Objective:
Ensure reliable and recoverable storage of attendance photos without relying on cloud or internet connectivity.

Requirement:
Use a dedicated external SD card as secondary physical storage for attendance photos.

Architecture:
- Primary system disk (Raspberry Pi microSD):
  - OS
  - Application code
  - Database
- External SD card (via USB card reader):
  - Attendance photos ONLY

The external SD card acts as:
- Dedicated photo storage
- Physical redundancy
- Reduced write stress on the OS disk

Implementation Rules:
1. Attendance photos must be saved directly to the external SD card mount point.
2. The mount point must be fixed and predictable (e.g. /mnt/tamtap_photos).
3. Photo saving must NOT block the attendance flow.
4. If the external SD card is not mounted or becomes unavailable:
   - Attendance logging must continue
   - No system crash is allowed
   - Log a warning
   - Display “Photo unavailable” in the dashboard
5. Attendance records remain valid even if photos are missing.

Directory Structure (Example):
/mnt/tamtap_photos/
  ├── YYYY-MM-DD/ (date folder - always generate each day)
  │     ├── <student_id>_<timestamp>.jpg

System Behavior:
- If photo file exists → load and display
- If photo file is missing or storage unavailable → show placeholder image
- No retries or blocking behavior during capture

Constraints:
- DO NOT use cloud storage or CDN
- DO NOT expose photos publicly
- DO NOT store photos inside the main OS filesystem
- DO NOT fail attendance if photo storage fails

Operational Notes:
- External SD card must be auto-mounted on boot.
- Storage health (mounted / writable) should be logged.
- This approach is sufficient for the research scope (limited number of images).

Future Work (Documentation Only):
- Cloud or private object storage may be added for large-scale deployment.
- This is not required for the current research implementation.

Files to Modify:
- #file:../../hardware/tamtap.py (hardware – photo capture and save path)
- #file:../../software/server.js (serve photos and handle missing-file fallback)
- System mount configuration: __________


==================================================
PART 3: IMPROVED FACE DETECTION (OpenCV)
==================================================

Requirement:
Enhance face detection to validate attendance captures.

Detection Requirements:
- Detect full face presence
- Detect eyes visibility
- Reject captures when:
  - Face not fully visible
  - Face covered (masks, obstructions)
  - Eyes not detected
  - Face is partially visible
  - No eyes are detected

Implementation:
1. Use OpenCV Haar cascades:
   - haarcascade_frontalface_default.xml
   - haarcascade_eye.xml
2. Validation flow:
   - Capture frame
   - Detect face → if no face, reject
   - Detect eyes within face region → if no eyes, reject
   - If both pass, save photo and proceed

Hardware Constraints (from copilot-instructions.md):
- Face detection (Haar): ≤ 1200 ms
- Total cycle: ≤ 3.5 seconds
- No facial recognition/matching (blocked per contract)
- total per tap will be 5 seconds max including all processing. (make the lcd less work because it makes the biggest delay)

Fail-State Rule (IMPORTANT):
- If face validation fails:
   - Attendance must be marked as FAILED_ATTEMPT
   - No photo is saved
   - System must immediately return to IDLE state
   - NFC reader and camera must be reset safely
   - Emit `attendance:fail` via Socket.IO with reason code
   - LCD displays "Face not detected" for 2 seconds max
   - Log as WARN level with failure reason

Validation Failure Reasons (for logging):
- NO_FACE_DETECTED
- EYES_NOT_VISIBLE
- FACE_PARTIALLY_VISIBLE
- MULTIPLE_FACES_DETECTED

Constraints:
- Do NOT perform facial recognition or identity matching
- Do NOT store biometric templates
- Do NOT compare faces against registered images
- Detection is strictly for presence validation only
- Detection must complete within 1200ms budget

Files to modify:
- #file:../../hardware/tamtap.py (add face validation before save)

==================================================
PART 4: STUDENT ATTENDANCE DETAIL VIEW
==================================================

Requirement:
Contextual student attendance view accessed from section student list.
Teachers and advisers can review raw attendance data per student without leaving the dashboard.

Access Model:
- NO separate "Student Profile" page in navigation
- Attendance details accessed ONLY from student list of selected section
- Each student row includes three-dot (⋯) action menu
- Dashboard context (section + date filter) preserved when viewing details

UI Architecture:
1. Student List (Primary View):
   - Displayed when teacher selects a section
   - Columns: Name, Status (Today), Action Menu (⋯)
   - Action menu option: "View Attendance Details"

2. Attendance Detail Side Panel/Modal:
   - Opens inline (no page navigation)
   - Read-only view
   - Contents:
     - Header: Student name, Section
     - Summary Cards:
       - Total instructional days
       - Present count
       - Late count
       - Absent count
       - Excused count
       - Attendance rate (%)
     - Raw History Table:
       - Date
       - Time (if applicable)
       - Status (Present/Late/Absent/Excused)
       - Notes (for excused absences)
       - Photo icon (click to preview snapshot)

Security & Data Guard (CRITICAL):
- API endpoint MUST enforce section ownership validation
- Query: Verify requesting teacher/adviser is assigned to student's section
- Reject with 403 if section mismatch detected
- No cross-section access allowed at API level
- Log unauthorized access attempts as WARN

Adviser Permissions (elevated):
- View full historical ranges (semester-wide)
- View aggregated summaries across date ranges
- Access contact details if school policy allows
- Still cannot edit/delete records

Constraints:
- Strictly read-only (no edit/delete buttons)
- No student self-access to this view
- No global student search outside section context
- For review and verification only

API Endpoint Design:

==================================================
PART 5: DASHBOARD LOGIN PAGE GALLERY
==================================================

Requirement:
Auto-scrolling photo gallery on login/landing page.

Implementation:
1. Gallery container below hero section or as background
2. Images scroll horizontally (leftward)
3. Scroll speed adapts to image count
4. Images are decorative (read-only)
5. Source: attendance photos or curated school images

Technical:
- CSS animation or JS-based smooth scroll
- Responsive: hide or reduce on mobile if needed
- Lazy loading for performance

Files to modify:
- #file:login.html (add gallery section)

==================================================
PART 6: SKELETON LOADING STATES
==================================================

Requirement:
Replace blank/jumping UI with skeleton placeholders during data load.

Implementation:
1. Create skeleton components for:
   - Attendance table rows
   - Summary cards
   - Student list
   - Charts

2. Show skeleton while:
   - API requests pending
   - Data loading

3. Replace skeleton with real content on load complete

Technical:
- Use Tailwind animate-pulse on gray placeholder divs
- Skeleton mimics shape of actual content

Files to modify:
- #file:../../software/public/dashboard.html
- #file:../../software/public/admin.html
- #file:../../software/public/login.html

==================================================
PART 7: CUSTOM PRELOADER ANIMATION
==================================================

Requirement:
Replace default spinner with TAMTAP character walking animation.

Implementation:
1. Create/source walking animation:
   - TAMTAP mascot walking leftward
   - CSS sprite animation or GIF/Lottie

2. Display during:
   - Initial page load
   - Heavy data fetches
   - Export generation

3. Replace all existing spinner references

Files to modify:
- #file:../../software/public/dashboard.html
- #file:../../software/public/admin.html
- #file:../../software/public/login.html

Files to use in the center for the preloader:
- #file:../../assets/animations/tamtap-walking.gif (already exist)

==================================================
PRIORITY ORDER
==================================================

1. PART 6: Skeleton Loading (quick UX win)
2. PART 4: Student Attendance Detail View (core feature)
3. PART 3: Face Detection Enhancement (hardware)
4. PART 1: Export Branding (polish)
5. PART 5: Login Gallery (visual enhancement)
6. PART 7: Custom Preloader (polish)
7. PART 2: Cloud Backup (infrastructure - requires cloud setup)

==================================================
CONSTRAINTS (FROM COPILOT-INSTRUCTIONS.MD)
==================================================

DO NOT:
- Add facial recognition or face matching
- Use cloud services for primary storage
- Add blocking infinite loops
- Use frontend frameworks (React, Angular, Vue)
- Break timing constraints (total cycle ≤ 3.5s)

DO:
- Keep logic backend-driven
- Use clear logging (INFO/WARN/ERROR)
- Maintain role separation (Admin vs Teacher vs Adviser)
- Follow existing state machine: IDLE → CARD_DETECTED → CAMERA_ACTIVE → SUCCESS/FAIL → IDLE

==================================================
OUTPUT EXPECTATION
==================================================

For each part, provide:
1. Backend changes (if applicable)
2. Frontend changes
3. Hardware changes (if applicable)
4. Test instructions

Implement incrementally. Confirm each part before proceeding to next.
