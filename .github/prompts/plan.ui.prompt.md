PROJECT: TAMTAP – Teacher Dashboard (Web UI)
TYPE: Internal School System (FEU Roosevelt Marikina)
USERS: Teachers (primary), Admin (secondary)
STUDENTS: Hardware interaction only (NO web interaction)

IMPORTANT:
This UI MUST strictly align with existing backend functionality.
If data is unavailable, the UI must degrade gracefully.
DO NOT fabricate, assume, or simulate backend values.

--------------------------------------------------
USER MODEL
--------------------------------------------------
• Teachers use the website to TRACK and BACKTRACK attendance
• Students interact ONLY with hardware (NFC tap)
• Admin manages accounts and sections

--------------------------------------------------
GOAL
--------------------------------------------------
Implement the TAMTAP website UI exactly based on the provided Canva designs.
Focus on FUNCTIONALITY FIRST, clean layout, and teacher usability.
Do NOT redesign creatively. Follow structure and flow strictly.

--------------------------------------------------
BACKEND AWARENESS RULES (CRITICAL)
--------------------------------------------------
• All UI components must check API availability before rendering
• If an endpoint is missing:
  - Show placeholder state OR
  - Hide the component with a clear label
• Never show incorrect statistics
• Never hardcode attendance logic in the frontend

--------------------------------------------------
KNOWN BACKEND LIMITATIONS (AS OF NOW)
--------------------------------------------------
• "Late" status exists but late-threshold logic may not yet be enforced
• Absent students are NOT computed automatically
• No notification system implemented
• Status breakdown endpoint may be missing

UI MUST account for these.

--------------------------------------------------
BRANDING & ASSETS
--------------------------------------------------
• Use provided image assets only:
  - TAMTAP logo variants (with/without "Teacher Dashboard")
  - TAMTAP mascot
  - FEU section badge image
• Color palette:
  - Primary: FEU Green
  - Accent: FEU Gold / Yellow
  - Background: White
• Fonts:
  - Use system-safe fonts or clean serif/sans-serif
• Icons:
  - PRIORITIZE Font Awesome or Icons8
  - Use icons for: login, logout, settings, help, notifications, user profile
  - Do NOT use custom SVG icons unless necessary

--------------------------------------------------
PAGE STRUCTURE (STRICT)
--------------------------------------------------

1) login.html (Landing + Login Flow)

Layout:
• Top navbar (simple, not complex)
  - Left: TAMTAP logo
  - No search bar
  - Optional text links (About/Mission/Vision) – visual only, not functional
• Hero section:
  - Centered TAMTAP logo
  - Large green "LOG IN" button
  - Button hover effect (slight darken / scale)
• Clicking LOG IN:
  - Opens login modal OR redirects to login section

Login Form:
• Title: "TAMTAP TEACHER DASHBOARD"
• Inputs:
  - Username or Email
  - Password
• Login button (green)
• Text note:
  - "Accounts are provided by the administrator"
• NO sign-up
• NO student login

Backend Integration:
• Use POST /api/auth/login
• If login fails, show backend error message
• After login, fetch:
  GET /api/auth/me
  - name
  - role
  - sections_handled
• If role !== teacher/admin → deny access

--------------------------------------------------
2) dashboard.html (Teacher Dashboard – MAIN PAGE)

Global Rules:
• Teacher-facing ONLY
• Read-only attendance data
• Section-based access (teacher sees assigned sections only)

Top Area:
• Left:
  - Section selector dropdown (e.g., "12 ICT B")
  - Populate from `sections_handled` (auth/me)
  - If no section selected → show empty state
• Center:
  - Date label (Today / This Week / This Month / This Semester)
  - Always display the date range being viewed
  - Default = Today
• Right:
  - Teacher avatar/icon
  - Notification icon (Font Awesome bell) — see rules below
  - Settings icon

Welcome Header:
• Text: "Welcome, [Teacher Name]"
• Section badge/logo visible
• Clean spacing, not crowded

--------------------------------------------------
ATTENDANCE SUMMARY CARD
--------------------------------------------------
DATA SOURCE:
• GET /api/stats

• Large card with green background
• Title: "Attendance Summary"
• Show:
  - Total students
  - Attendance percentage
• Horizontal progress bar:
  - Green/Gold fill
• Clearly label the date range shown

UI RULES:
• If `attendanceRate` exists → show progress bar
• If breakdown data is missing:
  - Show only total attendance + percentage
  - Hide "Arrived late / Didn't arrive" cards
  - Display label: "Detailed breakdown unavailable"

DO NOT compute absent or late on frontend.

--------------------------------------------------
STUDENT ATTENDANCE TABLE
--------------------------------------------------
Purpose: Backtracking per section

DATA SOURCE:
• GET /api/attendance?section=&date=

Table columns:
• Student Name
• Present (P)
• Absent (A)
• Late (L)

Rules:
• Render only students returned by backend
• Status dots are based strictly on `status` field:
  - Green = Present
  - Yellow = Late
  - Dark = Absent
• If status === "unknown" or missing:
  - Show neutral icon
• Include legend above or below table
• Rows are clickable:
  - Fetch GET /api/attendance/student/:nfc_id
  - Show last records if available
  - Otherwise show "No history available"
• NO edit buttons
• NO manual marking

--------------------------------------------------
SUMMARY VIEW (Integrated, NOT separate page)
--------------------------------------------------
DATA SOURCE:
• Prefer GET /api/stats/daily or /api/stats

• Tabs or buttons:
  - Today
  - This Week
  - This Month
  - This Semester
• Summary cards:
  - Arrived on time
  - Arrived late
  - Didn't arrive
• Use Font Awesome icons inside cards
• Numbers are large and readable

RULES:
• If breakdown endpoint does NOT exist:
  - Show cards in disabled state
  - Tooltip: "Feature pending backend support"
• DO NOT show fake counts
• Cards must auto-hide if data is undefined

--------------------------------------------------
NOTIFICATIONS ICON
--------------------------------------------------
• Only render bell icon if backend provides:
  - notification endpoint OR
  - socket event
• Otherwise:
  - Hide icon OR
  - Disable icon with tooltip "No notifications"

--------------------------------------------------
SETTINGS / MAIN MENU
--------------------------------------------------
Accessed via top-right icon or menu drawer

Menu items:
• Personal Information (view only)
  - GET /api/auth/me for user info
  - If email not returned: Show name + role only
• Settings
• Help Center
• Log Out
  - POST /api/auth/logout
  - After logout → redirect to login.html

Footer:
• FEU Roosevelt logo × TAMTAP logo
• Minimal, clean

--------------------------------------------------
TECHNICAL UI RULES
--------------------------------------------------
• Use HTML5 + CSS3 + Vanilla JS
• Tailwind CSS allowed (preferred)
• Responsive but desktop-first
• NO heavy animations
• NO frameworks like React/Vue
• Socket.IO ready for live updates
• Semantic HTML
• No frontend attendance logic
• No assumptions about backend completeness

--------------------------------------------------
FAIL-SAFE DESIGN GOAL
--------------------------------------------------
The dashboard must:
• Never crash if data is missing
• Never display misleading attendance
• Clearly indicate unavailable features
• Still remain usable for teachers

--------------------------------------------------
DO NOT:
--------------------------------------------------
✗ Add student registration
✗ Add teacher self-registration
✗ Add search bar
✗ Add manual attendance editing
✗ Change layout flow
✗ Overdecorate UI
✗ Fabricate or assume backend values
✗ Compute attendance logic on frontend

--------------------------------------------------
EXPECTED RESULT
--------------------------------------------------
A production-safe teacher dashboard that:
• Matches Canva UI design intent
• Reflects backend reality accurately
• Degrades gracefully when data is missing
• Is defensible during panel evaluation
• Teachers can easily track and backtrack attendance
• System looks institutional and professional
