# TAMTAP Dashboard Feature Plan
## "My Students" Roster + View Toggle + Not-Yet-Tapped Filter

**Date:** February 9, 2026  
**Scope:** `software/public/dashboard.html` (frontend only — all APIs already exist)  
**No new files needed.** No backend changes. Pure HTML/CSS/JS additions to the existing dashboard.

---

## PROBLEM

Right now the dashboard **only shows students who have already tapped**. A teacher with 40 students in their section sees 0 rows until someone taps. There's no way to:

1. View the full class roster (all registered students, tapped or not)
2. See who **hasn't** tapped yet at a glance
3. Click a student who hasn't tapped to view their attendance history

---

## SOLUTION: 3 Features (Same Page, No SPA)

### Feature 1: View Toggle Tabs (in existing Filter Bar)

**Location:** Inside the existing `TOP FILTER BAR` div, between the Section Selector and Date Range Tabs.

```
[📋 Attendance]  [👥 My Students]  [⚠ Not Yet Tapped]
```

**How it works:**
- Three pill-style toggle buttons
- Only ONE active at a time (like the date range tabs)
- Each button shows/hides a `<div>` in `<main>`:
  - `view-attendance` → existing attendance table + summary cards (default)
  - `view-roster` → new student roster table
  - `view-not-tapped` → new "not yet tapped" list
- Switching views does NOT reload data unnecessarily — roster is cached after first load
- Date range tabs and section selector remain visible and functional in all views

**Active Tab Styling:**
- Active: `bg-feu-green text-white` (same as active date tab)
- Inactive: `text-gray-600 hover:bg-gray-100`

---

### Feature 2: "My Students" Roster View

**API Used:** `GET /api/students/section/:section` (already exists, supports comma-separated sections)

**What the teacher sees:**
A table showing ALL students in their assigned sections. Each row has:

| # | Student Name | Section | TAMTAP ID | Today's Status | Action |
|---|-------------|---------|-----------|----------------|--------|
| 1 | Juan Dela Cruz | 12 ICT-A | TT-2025-001 | 🟢 Present (7:15 AM) | [View Record] |
| 2 | Maria Santos | 12 ICT-A | TT-2025-002 | 🟡 Late (7:45 AM) | [View Record] |
| 3 | Pedro Reyes | 12 ICT-A | TT-2025-003 | ⬛ No tap yet | [View Record] |

**"Today's Status" Column Logic:**
- Cross-reference the `currentRecords` array (already loaded by attendance view)
- Match by `nfc_id`
- If found → show status dot + time
- If not found → gray "No tap yet" badge

**"View Record" Button:**
- Calls existing `showStudentHistory(nfc_id, name)` — the modal already works perfectly
- This is the key feature: teacher can view ANY student's full history, even if they haven't tapped today

**Mobile View:**
- Card layout (same pattern as existing attendance mobile cards)
- Student name, section, today's status, tap to open history

**Data Loading:**
```
1. On first switch to "My Students" tab → fetch /api/students/section/{sections}
2. Cache result in a `let rosterData = null` global
3. On subsequent switches → re-render from cache (no re-fetch)
4. Merge with currentRecords to compute "Today's Status"
5. When section dropdown changes → clear cache, re-fetch on next view
```

**Search/Filter:**
- Add a search input at top of roster table (filters by name, case-insensitive)
- Client-side only — just `.filter()` on the cached array

---

### Feature 3: "Not Yet Tapped" View

**API Used:** None new — this is computed client-side by comparing roster vs attendance records.

**Logic:**
```js
const notTapped = rosterData.filter(student => 
    !currentRecords.some(r => r.nfc_id === student.nfc_id)
);
```

**What the teacher sees:**
Same table as roster, but filtered to show ONLY students with no attendance record today.

| # | Student Name | Section | TAMTAP ID | Action |
|---|-------------|---------|-----------|--------|
| 1 | Pedro Reyes | 12 ICT-A | TT-2025-003 | [View Record] |
| 2 | Ana Lim | 12 ICT-A | TT-2025-007 | [View Record] |

**Header shows count:** "5 of 40 students haven't tapped yet"

**Empty State:** If everyone has tapped:
```
✅ All students have tapped today!
```

**Note:** This view is most useful for the "Today" date range. For week/month ranges, it should show a notice: "Not Yet Tapped view is only available for today's date."

---

## IMPLEMENTATION PLAN (Step by Step)

### Step 1: Add View Toggle Buttons to Filter Bar
- Insert 3 buttons between section selector and date tabs
- Wire up `setView('attendance' | 'roster' | 'not-tapped')` function
- Add CSS for active/inactive states

### Step 2: Wrap Existing Content in View Container
- Wrap the attendance summary card, summary cards, and attendance table in `<div id="view-attendance">`
- This div is shown by default, hidden when other views active

### Step 3: Add Roster View HTML
- New `<div id="view-roster" class="hidden">` after attendance view
- Contains: search input + table (desktop) + card view (mobile) + empty state
- Table columns: #, Name, Section, TAMTAP ID, Today's Status, Action

### Step 4: Add Not-Yet-Tapped View HTML
- New `<div id="view-not-tapped" class="hidden">` after roster view
- Contains: count header + table + empty state ("All tapped!")
- Same column structure minus "Today's Status" (they're all not tapped)

### Step 5: Add JavaScript — View Switching
```js
let currentView = 'attendance'; // 'attendance' | 'roster' | 'not-tapped'
let rosterData = null;          // Cached student list

function setView(view) {
    currentView = view;
    // Hide all views
    document.getElementById('view-attendance').classList.add('hidden');
    document.getElementById('view-roster').classList.add('hidden');
    document.getElementById('view-not-tapped').classList.add('hidden');
    // Show selected
    document.getElementById(`view-${view}`).classList.remove('hidden');
    // Update tab styles
    // Load data if needed
    if (view === 'roster' || view === 'not-tapped') loadRoster();
}
```

### Step 6: Add JavaScript — Roster Loading
```js
async function loadRoster() {
    if (rosterData) { renderRoster(); return; }
    // Show skeleton
    const sections = getSectionFilter(); // current section or all sections_handled
    const res = await fetch(`/api/students/section/${encodeURIComponent(sections)}`);
    const data = await res.json();
    if (data.success) rosterData = data.data;
    renderRoster();
}
```

### Step 7: Add JavaScript — Roster Rendering
- `renderRoster()` — renders full roster table, merges with `currentRecords` for status
- `renderNotTapped()` — filters roster to show only missing students
- `searchRoster(query)` — client-side filter on rendered list

### Step 8: Clear Cache on Section Change
- In existing `onSectionChange()` → add `rosterData = null;`
- If currently in roster/not-tapped view → re-load

---

## WHAT STAYS THE SAME (No Changes)

- ✅ Attendance table (existing, untouched)
- ✅ Summary cards (existing, untouched)
- ✅ Student detail modal (`showStudentHistory`) — reused as-is
- ✅ Photo modal — reused as-is
- ✅ Socket.IO live updates — still work in attendance view
- ✅ Export buttons — still in attendance view
- ✅ Date range tabs — still functional
- ✅ All backend routes — no changes needed

---

## FILES MODIFIED

| File | Change |
|------|--------|
| `software/public/dashboard.html` | Add view toggle buttons, roster HTML, not-tapped HTML, ~150 lines JS |

**That's it. One file.**

---

## UI SKETCH (Desktop Layout)

```
┌──────────────────────────────────────────────────────────┐
│ 🟢 FEU Roosevelt Marikina                          Live │  ← Top bar (on live status could you make it responsive if the raspberryPi was like offline or not connected to the network? maybe show a red dot and "Offline" text instead?)
├──────────────────────────────────────────────────────────┤
│ [TAMTAP Logo]       Dashboard        [🔔] [Teacher ▾]  │  ← Header (unchanged)
├──────────────────────────────────────────────────────────┤
│ Section: [12 ICT-A ▾]                                    │
│                                                          │
│ [📋 Attendance] [👥 My Students] [⚠ Not Yet Tapped]    │  ← NEW: View toggle
│                                                          │
│                    [Today] [Week] [Month] [📅 Custom]   │  ← Date tabs (unchanged)
├──────────────────────────────────────────────────────────┤
│                                                          │
│  (Content changes based on active view tab)              │
│                                                          │
│  IF "Attendance" → existing summary + table              │
│  IF "My Students" → roster table with search             │
│  IF "Not Yet Tapped" → filtered absent list              │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## ESTIMATED EFFORT

| Step | Complexity | Lines Added |
|------|-----------|-------------|
| View toggle buttons | Low | ~15 HTML |
| Wrap existing content | Low | ~4 HTML |
| Roster view HTML | Medium | ~80 HTML |
| Not-tapped view HTML | Medium | ~50 HTML |
| View switching JS | Low | ~25 JS |
| Roster loading + rendering JS | Medium | ~80 JS |
| Not-tapped rendering JS | Low | ~30 JS |
| Search filter JS | Low | ~15 JS |
| Cache management JS | Low | ~10 JS |
| **Total** | **Medium** | **~310 lines** |

---

## QUESTIONS FOR YOU BEFORE I BUILD

1. **View toggle placement** — I put it inside the filter bar. Want it there, or as a second row below the filter bar?
2. **Search in roster** — name-only search, or also search by TAMTAP ID / section?
3. **"Not Yet Tapped" on week/month view** — disable it (only works for today), or show cumulative "students with 0 attendance in range"?
4. **Anything else you want in the roster row?** (e.g., email, grade, registration date)

---

**Ready to build on your go.**
