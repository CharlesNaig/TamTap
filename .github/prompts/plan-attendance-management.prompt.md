# 📋 Plan: Attendance Management & Notification System

## TL;DR
Implement a complete attendance management system with: notification bell for marking students as excused/absent, section schedules with XLSX import, automatic late/absent calculation based on per-section arrival times, and role-based access (Admin, Teacher Adviser, Subject Teacher).

---

## 🎯 Core Features

### 1. Notification System (Dashboard Bell Icon)
- Click bell → dropdown showing students who haven't tapped today
- Filter by section (for advisers) or all (for admin)
- Quick actions: Mark as Excused (with reason) or confirm Absent
- Badge counter showing pending unmarked absences

### 2. Section Schedule System
- Each section has a weekly schedule (Mon-Fri)
- Define arrival time per day (e.g., ICT-B: Mon 7:00 AM, Tue 8:30 AM)
- XLSX template import for bulk schedule upload
- Grace period: 20 minutes = Late, 60+ minutes = Absent

### 3. Role Hierarchy

| Role | Who | Permissions |
|------|-----|-------------|
| **System Admin** | Registrar, IT, Principal | Full access: manage users, sections, schedules, view all, export all |
| **Teacher Adviser** | One per section | Manage their section: mark excused, edit schedule, view students |
| **Subject Teacher** | Multiple | View only: see attendance, export their handled sections |

---

## 📁 Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `software/routes/schedules.js` | Schedule CRUD API endpoints |
| `software/routes/notifications.js` | Notification/absence management API |
| `software/public/templates/schedule-template.xlsx` | Downloadable XLSX template |
| `software/public/js/notifications.js` | Notification dropdown component |

### Modified Files
| File | Changes |
|------|---------|
| `software/server.js` | Add multer for file upload, mount new routes |
| `software/public/admin.html` | Add Section Schedule tab, adviser assignment UI |
| `software/public/dashboard.html` | Implement notification dropdown, mark absent/excused |
| `software/routes/auth.js` | Add `adviser` role type, update session |
| `software/routes/students.js` | Add adviser assignment to sections |
| `software/routes/stats.js` | Update late/absent logic to use section schedules |
| `hardware/tamtap.py` | Fetch section schedule from API for accurate status |

---

## 🗄️ Database Schema Changes

### New Collection: `schedules`
```javascript
{
  section: "ICT-B",
  grade: "12",
  adviser_id: ObjectId,
  adviser_name: "Juan Dela Cruz",
  weekly_schedule: {
    monday:    { start: "07:00", end: "17:00" },
    tuesday:   { start: "08:30", end: "17:00" },
    wednesday: { start: "07:00", end: "17:00" },
    thursday:  { start: "07:00", end: "17:00" },
    friday:    { start: "07:00", end: "16:00" }
  },
  grace_period_minutes: 20,
  absent_threshold_minutes: 60,
  created_at: Date,
  updated_at: Date
}