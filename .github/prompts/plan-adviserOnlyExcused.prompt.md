# TAMTAP Adviser-Only Excused/Absent Marking

**Created:** March 9, 2026  
**Scope:** Backend (2 files), Frontend (1 file) — 3 files total  
**Goal:** Restrict mark-excused and mark-absent to advisers of the section + admin only. Subject teachers can view attendance but cannot modify status.

---

## Rationale

In Filipino schools, the class adviser is the single authority for student attendance status. Parents report absences to the adviser, not to random subject teachers. Allowing any teacher with `sections_handled` to mark excused creates conflicting decisions and inconsistent records.

### Permission Model

| Role | View attendance | Mark excused | Mark absent |
|------|----------------|--------------|-------------|
| **Admin** | All sections | All sections | All sections |
| **Adviser** | Their `sections_handled` | **Only their `advised_section`** | **Only their `advised_section`** |
| **Teacher** (no advisory) | Their `sections_handled` | **No** | **No** |

### Existing Data Model (no schema changes needed)

Session user object already has:
```js
req.session.user = {
    role: 'admin' | 'teacher',
    role_type: 'admin' | 'adviser' | 'teacher',
    advised_section: 'ICT-A' | null,       // Only set for advisers
    sections_handled: ['ICT-A', 'ICT-B'],  // All sections they can VIEW
}
```

---

## Phase 1: Backend — Tighten Permission Check

### 1.1 — Update `POST /mark-excused` permission check

**File:** `software/routes/notifications.js` (~line 238)

**Current logic (too broad):**
```js
if (user.role !== 'admin') {
    const userSections = [];
    if (user.advised_section) userSections.push(user.advised_section);
    if (user.sections_handled) userSections.push(...user.sections_handled);
    if (!userSections.includes(student.section)) {
        return res.status(403).json({ error: 'Not authorized to mark this student' });
    }
}
```

**New logic (adviser + admin only):**
```js
if (user.role !== 'admin') {
    // Only advisers can mark excused, and only for their advised section
    if (!user.advised_section || user.advised_section !== student.section) {
        return res.status(403).json({ 
            error: 'Only the section adviser or admin can mark students as excused' 
        });
    }
}
```

### 1.2 — Update `POST /mark-absent` permission check

**File:** `software/routes/notifications.js` (~line 357)

**Same change:** Replace `sections_handled` broad check with `advised_section` narrow check:
```js
if (user.role !== 'admin') {
    if (!user.advised_section || user.advised_section !== student.section) {
        return res.status(403).json({ 
            error: 'Only the section adviser or admin can mark students as absent' 
        });
    }
}
```

### 1.3 — `POST /bulk-absent` stays admin-only (no change needed)

Already has `if (user.role !== 'admin')` guard. Correct as-is.

---

## Phase 2: Backend — Notification Dropdown Scoping

### 2.1 — Scope `GET /pending` to adviser's section only

**File:** `software/routes/notifications.js`

Currently returns pending students for all `sections_handled`. For non-admin users, should only return pending students if the user is the adviser of that section. Subject teachers should get an empty list (they don't need to action on absences).

**Logic:**
```js
// Admin: all students or filtered by section param
// Adviser: only students in their advised_section
// Teacher (no advisory): empty — they can't act on these anyway
if (user.role !== 'admin') {
    if (!user.advised_section) {
        return res.json({ success: true, data: [], count: 0, date: today });
    }
    studentQuery.section = user.advised_section;
}
```

### 2.2 — Scope `GET /count` similarly

Same logic — return count 0 for non-adviser teachers so the notification badge doesn't show.

---

## Phase 3: Frontend — Conditionally Show/Hide Mark Buttons

### 3.1 — Hide excused/absent buttons for non-adviser teachers

**File:** `software/public/js/dashboard.js`

**Helper function:**
```js
function canMarkAttendance(section) {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    return currentUser.advised_section === section;
}
```

**Update these render locations:**
- `renderTable()` (~line 1196) — hide the excused button column
- `renderMobileCards()` (~line 1261) — hide the excused button
- `addRecordToTable()` (~line 1300) — hide the excused button on live records
- `loadNotifications()` (~line 1830) — hide mark-excused/mark-absent buttons
- Notification dropdown: only show if `canMarkAttendance()`

For each button, wrap with:
```js
${canMarkAttendance(r.section) ? `<button onclick="markExcused(...)">...</button>` : ''}
```

### 3.2 — Hide notification bell for non-adviser teachers

**File:** `software/public/js/dashboard.js`

In `initDashboard()`, only call `loadNotificationCount()` if user is admin or has `advised_section`. Hide the bell icon entirely for subject teachers.

```js
if (currentUser.role === 'admin' || currentUser.advised_section) {
    loadNotificationCount();
} else {
    document.getElementById('notification-btn')?.classList.add('hidden');
}
```

---

## Phase 4: Frontend — Show Info Toast for Denied Actions (defensive)

### 4.1 — Handle 403 gracefully in `markExcused()` and `markAbsent()`

**File:** `software/public/js/dashboard.js`

If the backend returns 403 (e.g., user somehow clicked a button they shouldn't see), show:
```js
if (res.status === 403) {
    const data = await res.json();
    Swal.fire({
        icon: 'warning',
        title: 'Not Authorized',
        text: data.error || 'Only the section adviser can mark attendance status',
        confirmButtonColor: '#0a8249'
    });
    return;
}
```

---

## Files Changed Summary

| File | Changes |
|------|---------|
| `software/routes/notifications.js` | Tighten 4 endpoints: `mark-excused`, `mark-absent`, `pending`, `count` |
| `software/public/js/dashboard.js` | Add `canMarkAttendance()` helper, conditionally render buttons, scope notifications |

---

## Testing Checklist

- [ ] **Admin** can mark any student excused/absent in any section
- [ ] **Adviser** can mark excused/absent only for students in their `advised_section`
- [ ] **Adviser** CANNOT mark students in other sections they handle (subject only)
- [ ] **Teacher** (no advisory) sees NO excused/absent buttons in attendance table
- [ ] **Teacher** (no advisory) sees NO notification bell / gets count=0
- [ ] **Teacher** (no advisory) gets 403 if they POST to mark-excused/mark-absent directly
- [ ] **Notification dropdown** only shows for admin + advisers
- [ ] `bulk-absent` remains admin-only (unchanged)
- [ ] Dashboard attendance view still works for all teachers (read-only)
- [ ] Real-time `attendance:new` events still show for all teachers

---

## Edge Cases

1. **Teacher is adviser of ICT-A but also handles ICT-B:** Can mark excused for ICT-A students only. Can view ICT-B attendance but not modify it.
2. **Adviser is absent:** Admin handles it. No fallback to subject teachers.
3. **Student section doesn't match any adviser:** Only admin can mark. This is a data issue that admin should fix (assign an adviser).
4. **`advised_section` is null/undefined:** Treated as non-adviser teacher — no write access.
