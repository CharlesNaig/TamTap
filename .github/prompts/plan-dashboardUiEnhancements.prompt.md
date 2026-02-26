# PLAN: Dashboard UI Enhancements

**Scope:** `software/public/dashboard.html`, `software/routes/notifications.js`, `software/routes/schedules.js`
**Constraint:** Vanilla JS, Tailwind CDN, no SPA, responsive, follows TAMTAP contract

---

## 1. Section Tabs (Replace Dropdown with Clickable Tabs)

**Problem:** Section selector is a `<select>` dropdown (`#section-select`). User wants clickable tab buttons that auto-filter to that section on click.

**Current:** Lines 295–305 — `<select id="section-select">` with `onchange="onSectionChange()"`.
Used in: `populateSectionDropdown()` (line 1142), `onSectionChange()` (line 1171), and ~10 other places that read `sectionSelect.value`.

**Plan:**
- Replace `<select>` with a horizontal scrollable tab bar (pill buttons, same style as the View Toggle tabs already on the page).
- "All Sections" pill is default-active (green). Each section gets its own pill.
- Clicking a pill sets an internal `currentSection` variable and calls `onSectionChange()`.
- Keep a hidden `<select>` OR refactor all `.value` reads to use `currentSection` variable instead. **Preferred: use variable** — cleaner, fewer DOM reads.
- `populateSectionDropdown()` → rename to `populateSectionTabs()`, generates pill buttons dynamically.
- Active tab: `bg-feu-green text-white`. Inactive: `text-gray-600 hover:bg-gray-100 bg-white`.
- Mobile: horizontal scroll with `-webkit-overflow-scrolling: touch`, `overflow-x-auto`, `flex-nowrap`.
- Refactor every `document.getElementById('section-select').value` call (~10 occurrences) to read `currentSection` variable.

**Files touched:** `dashboard.html` (HTML + JS)

---

## 2. Excused Status: Color + Mark-Excused from Attendance Table

### 2a. Excused Legend & Color

**Problem:** No `status-excused` CSS dot defined. Excused uses generic `bg-blue-100 text-blue-700` badge but has no legend entry. User wants dedicated hex `#2664EB`.

**Current CSS (line 63–68):**
```css
.status-present { background-color: #22c55e; }
.status-late { background-color: #eab308; }
.status-absent { background-color: #ef4444; }
.status-unknown { background-color: #9ca3af; }
/* NO .status-excused */
```

**Current Legends (line 561–565):** Only Present, Late, Absent. No Excused.
**Second legend (line 688–691):** Only Present, Late, No Tap Yet. No Excused.

**Plan:**
- Add `.status-excused { background-color: #2664EB; }` to CSS block.
- Add `<span><span class="status-dot status-excused mr-0.5 sm:mr-1"></span> Excused</span>` to BOTH legend bars.
- Update `getStatusBadgeClass()` (line 2399): change `'excused': 'bg-blue-100 text-blue-700'` → use custom class `bg-[#2664EB]/10 text-[#2664EB]` or keep Tailwind blue but ensure consistency.
- Update excused stat card border (line 841): keep `border-blue-200` or shift to match `#2664EB`.

### 2b. Mark-Excused Button in Attendance View (Already-Tapped Students)

**Problem:** Currently, excusing is only available in the notification dropdown for students who *haven't* tapped. User wants to excused a student who already tapped (e.g., student got sick mid-class after marking present).

**Approach — Improved over user's idea:**
Rather than only in a "today schedule" view, add an **action column** to the attendance table (and roster view) with a small "Excuse" icon-button next to each record that is currently `present` or `late`. This button:
1. Opens the same SweetAlert2 flow (`markExcused()` already exists and supports updating existing records — see `notifications.js` line 276–290 which does `updateOne` if record exists).
2. On success, the row's status badge updates to "Excused" immediately.
3. Button is hidden for records already `excused` or `absent`.

**Implementation:**
- **Attendance table (desktop, line 568):** Add `<th>Action</th>` column.
- **`addRecordToTable()` / row rendering (~line 2095):** Add a `<td>` with a small excuse button if `status === 'present' || status === 'late'`.
- **Mobile cards:** Add the same icon-button in the card layout.
- **Roster view already has an Action column** (line 713) — the "Mark Excused" button already exists there for not-tapped students. Extend it so tapped students with `present`/`late` also get the excuse button instead of hiding it.
- **Backend already supports it:** `POST /api/notifications/mark-excused` checks for existing record and does `updateOne` to set `status: 'excused'`. No backend change needed (403 fix was already applied last session with `sections_handled`).

**Files touched:** `dashboard.html` (HTML table headers, row rendering JS, CSS)

---

## 3. Schedule Management Tab in Teacher Dashboard

**Problem:** Only admin can manage schedules. Teacher should have read + edit access for their own sections' schedules, placed near the section tabs.

**Current:** Admin has a full Schedules tab (`panel-schedules` in `admin.html` line 438) with Add, Import, Template, Edit, Delete. Backend: `software/routes/schedules.js`.

**Plan:**
- Add a new View Toggle tab: **"Schedules"** (icon: `fa-calendar-alt`) alongside Attendance, My Students, Not Yet Tapped.
- New panel `#panel-schedules` inside dashboard, containing:
  - A table/card list of schedules for the teacher's `sections_handled` only.
  - **Edit** button per schedule (opens a SweetAlert2 or modal form to change start time, end time, grace period).
  - **No Add/Delete/Import** — teacher can only modify existing schedules for their sections. Adding/removing/importing sections stays admin-only.
- Backend: `GET /api/schedules` already returns schedules. Needs filtering by section query param (check if already supports `?section=`). `PUT /api/schedules/:id` should work for updates — verify auth allows teacher role.
- If `schedules.js` routes use `requireAdmin`, change schedule update to `requireTeacher` (teacher OR admin). Keep add/delete/import as `requireAdmin`.

**Files touched:** `dashboard.html` (new view tab + panel HTML + JS), `software/routes/schedules.js` (auth check relaxation on GET and PUT for teacher)

---

## 4. Unified Dropdown/Select Styling

**Problem:** Dropdowns (section select, date picker, export menu, notification dropdown, settings menu, calendar) have inconsistent styling — different border radius, shadows, paddings, animations.

**Audit of current dropdown elements:**
| Element | Location | Current Style |
|---------|----------|---------------|
| Section select | Line 301 | `border-2 border-gray-200 rounded-lg` |
| Custom date input | Line 357 | `border-2 border-gray-200 rounded-lg` |
| Notification dropdown | Line 206 | `rounded-xl shadow-xl border dropdown-enter` |
| Settings menu | Line 255 | `rounded-xl shadow-xl border dropdown-enter` |
| Export menu | Line 545 | `rounded-lg shadow-xl border dropdown-enter` |
| SweetAlert selects | JS-generated | SweetAlert default styling |

**Plan — Unified design tokens:**
```
All <select> elements:    border border-gray-300 rounded-lg px-3 py-2 text-sm
                          bg-white focus:ring-2 focus:ring-feu-green/30 focus:border-feu-green
                          shadow-sm transition appearance-none (+ custom chevron)

All popup dropdowns:      rounded-xl shadow-lg border border-gray-200
                          bg-white dropdown-enter overflow-hidden

All <input[type=date]>:   Same as <select> styling above
```

- Create a utility class `.tamtap-select` and `.tamtap-dropdown` in the `<style>` block and apply to all matching elements.
- Replace `border-2` with `border` (lighter feel), unify `rounded-lg` vs `rounded-xl` (use `rounded-xl` for popups, `rounded-lg` for inline inputs/selects).
- Add custom dropdown chevron SVG as background-image on selects for a polished look.
- Ensure `shadow-sm` on selects, `shadow-lg` on popup menus.
- **Responsive:** All existing responsive classes stay. No layout changes, only visual consistency.

**Files touched:** `dashboard.html` (CSS + HTML class updates), potentially `admin.html` for parity (optional, scope to dashboard first)

---

## Execution Order

1. **Item 2a** — Excused color/legend (pure CSS + HTML, zero risk, validates instantly)
2. **Item 4** — Unified dropdown styling (CSS + class swaps, low risk)
3. **Item 1** — Section tabs refactor (medium risk — touches ~10 JS references)
4. **Item 2b** — Mark-excused from attendance table (medium — new column + rendering logic)
5. **Item 3** — Schedule tab in dashboard (largest — new panel + backend auth check)

---

## Out of Scope (per TAMTAP contract)
- No SPA routing
- No new Socket.IO events
- No cloud services
- No frontend frameworks
