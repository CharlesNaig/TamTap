Got it. Below is a **cleanly UPDATED version of the prompt**, rewritten to **explicitly lock in** the rule you just approved:

> ✅ **Only ADMIN can register teachers and students**
> ❌ **No manual / self-registration for teachers**
> ❌ **No manual / self-registration for students**

This version is **final-policy clear**, Copilot-safe, and defense-ready.

---

# 📘 TAMTAP Dashboard & System Prompt Plan

**File:** `plan.prompt.md`
**Project:** TAMTAP – NFC-Based Attendance System
**Primary Users:** Teachers
**System Authority:** Admin
**Student Interaction:** Hardware only (NFC tap)

---

## 1. System Philosophy (Single Source of Truth)

**Core principle:**

> Students interact with the TAMTAP device.
> Teachers interact with the TAMTAP website.
> **Admins control all user registration and access.**

TAMTAP is an **internal school system**, not a public web application.

There are **no public sign-up or self-registration features**.

---

## 2. User Roles & Responsibilities

### 👨‍🎓 Students

* ❌ No website registration
* ❌ No login required
* ❌ No dashboard access
* ✅ Registered **only by Admin**
* ✅ Identified by:

  * Student ID
  * Section
  * NFC Card UID

Students exist in the system **only as attendance records**, not as active web users.

---

### 👩‍🏫 Teachers (Primary Dashboard Users)

* ❌ No self-registration
* ❌ No section self-assignment
* ✅ Accounts are **created by Admin only**
* ✅ Can log in **after admin registration**
* ✅ Can only access sections assigned by Admin

Teachers use the website to:

* Track attendance
* Backtrack records by section/date
* Export attendance reports
* Verify records via snapshots

Teachers **cannot**:

* Register users
* Modify attendance data
* View unassigned sections

---

### 🛠️ Admin (System Authority)

* ✅ Admin accounts are created **manually (bootstrap)**
* ✅ Admin has exclusive rights to:

  * Register teachers
  * Register students
  * Assign sections to teachers
  * Manage system configuration

Admin access is restricted and not publicly available.

---

## 3. Registration Policy (STRICT)

### 🔒 Registration Rules

* There is **NO public registration page**
* There is **NO “Sign Up” button**
* All users are provisioned by Admin

### 👩‍🏫 Teacher Registration

* Admin creates teacher accounts via Admin Panel
* Admin assigns one or more sections per teacher
* Teachers cannot edit their assignments

Example teacher record:

```json
{
  "username": "ms.santos",
  "role": "teacher",
  "sections_handled": ["11-A", "11-C"]
}
```

---

### 👨‍🎓 Student Registration

* Students are registered **only by Admin**
* Registration methods:

  * CSV import
  * Manual Admin Panel entry
  * Enrollment data sync (future work)

Example student record:

```json
{
  "uid": "2025-00123",
  "name": "Juan Dela Cruz",
  "section": "11-A",
  "nfc_id": "04A1B23C"
}
```

---

## 4. Section-Based Access Control (Enforced)

### ✅ Model: Teacher → Multiple Sections (Admin Assigned)

* Teacher accounts contain `sections_handled[]`
* Backend restricts access by section
* Frontend only displays assigned sections
* No override from UI

This control is enforced at **both UI and API levels**.

---

## 5. Functional Flow (End-to-End)

### 📍 Attendance Recording (Student Side)

1. Student taps NFC card
2. Camera snapshot captured
3. Attendance recorded by `tamtap.py`
4. Data sent to backend
5. Stored in MongoDB
6. Broadcast to dashboard

Students never interact with the website.

---

### 📍 Attendance Monitoring (Teacher Side)

1. Teacher logs in
2. Dashboard auto-loads:

   * First assigned section
   * Today’s attendance
3. Teacher filters by:

   * Section
   * Date / range
4. Teacher exports or reviews records

---

## 6. Dashboard Functional Pages

### 6.1 Login Page

* Admin & Teacher login only
* No registration links
* Role-based redirect

---

### 6.2 Teacher Dashboard (Core Page)

* Section selector (assigned only)
* Date selector
* Attendance table:

  * Student name
  * Student ID
  * Time
  * Status
  * Snapshot view (on click)

Read-only attendance data.

---

### 6.3 Attendance Backtracking

* Filter by section
* Filter by date/range
* Export CSV
* Drill-down per student

---

### 6.4 Admin Panel

Admin can:

* Register teachers
* Register students
* Assign sections
* View system status

Admin cannot:

* Edit attendance records manually

---

## 7. UI/UX Rules (Function First)

* Teacher-first design
* Section-first navigation
* Predictable button placement
* Minimal actions
* No hidden menus
* No unnecessary animations

The goal is **fast comprehension**, not decoration.

---

## 8. What the System MUST NOT Include

* ❌ Public sign-up
* ❌ Student login
* ❌ Teacher self-registration
* ❌ Manual attendance editing
* ❌ Cloud services

---

## 9. Success Criteria

The system is successful if:

* Only admin can create users
* Teachers only see assigned sections
* Students never need web access
* Attendance can be backtracked easily
* CSV export works reliably

---

## 10. Defense-Ready Statement

> “TAMTAP is an internal attendance system where user accounts are provisioned exclusively by administrators. Students interact only with the physical device, while teachers use the web dashboard solely for monitoring and historical analysis.”

---

## 11. Next Steps After Approval

1. Implement admin user bootstrap
2. Build Admin Panel (registration + assignment)
3. Implement backend access control
4. Build teacher dashboard
5. Integrate hardware data flow
