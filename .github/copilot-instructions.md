# 📜 **TAMTAP – GitHub Copilot Contract Instruction**

**NFC-Based Attendance System | FEU Roosevelt Marikina**
**Capstone by group 5 of Grade 12 ICT B
 | S.Y. 2025–2026**
**Authors:** Charles Giann Marcelo et al.

---

## 🎯 PROJECT PURPOSE

TAMTAP is a **locally hosted, NFC-based attendance system** using Raspberry Pi hardware with camera verification and a real-time LAN dashboard.
All generated code **must align with research requirements**, hardware limits, and school deployment constraints.

Copilot must behave as a **professional engineer following strict specs**, not as a feature-inventing assistant.

Don't sugar coat my prompt tell me stright and clear what to do. plus give your thought process before answering. be concise.

---

## 🔧 HARDWARE TARGET

* Raspberry Pi 4B (4GB RAM, Bookworm OS)
* RC522 NFC Reader (SPI: GPIO 8,9,10,11,25)
* I2C LCD 16x2 (Address: `0x27`)
* Pi Camera v2 (5MP, CSI)
* LEDs: Green(G17), Red(G27), Buzzer(G18 via relay)

---

## 🛠️ APPROVED SOFTWARE STACK (ONLY)

### Hardware Control

* Python 3.11
* Libraries: `RPi.GPIO`, `mfrc522`, `smbus`, `subprocess`
* Camera: `rpicam-still` (snapshot only)

### Backend

* Node.js 20
* Express.js
* MongoDB (local)
* Socket.IO (LAN only)

### Frontend

* HTML5
* CSS3
* Vanilla JavaScript (ES6+)
* Tailwind CSS
* Chart.js
* SweetAlert2
* Native WebSocket API

---

## ⏱️ HARD TIMING CONSTRAINTS

Copilot must generate **non-blocking code** that respects this budget:

* NFC read: ≤ 100 ms
* Camera wake + capture: ≤ 1500 ms
* Face detection (Haar): ≤ 1200 ms
* LCD update: ≤ 100 ms
* **Total cycle:** ≤ **3.5 seconds**

No `sleep()` calls that violate timing.

---

## 🔁 SYSTEM STATE MACHINE (MANDATORY)

All modules must follow this flow:

```
IDLE → CARD_DETECTED → CAMERA_ACTIVE
CAMERA_ACTIVE → SUCCESS | FAIL
SUCCESS | FAIL → IDLE
```

No state skipping. No parallel state transitions.

---

## 📊 DATABASE RULES

### Collections

* `students { uid, name, grade, section, nfc_id }`
* `attendance { uid, name, date, time, status, photo_path, session }`

### Indexes (REQUIRED)

```js
students.createIndex({ nfc_id: 1 }, { unique: true });
attendance.createIndex({ uid: 1, date: 1 }, { unique: true });
```

### Write Rule

* One attendance record per UID per day only.

---

## 🔌 SOCKET.IO EVENT CONTRACT

Copilot may emit **ONLY** these events:

* `attendance:new`
* `attendance:fail`
* `camera:snapshot`
* `system:status`

Do not invent new event names.

---

## 🧱 FRONTEND ARCHITECTURE RULES

* Multi-page HTML (NO SPA)
* One JS file per page
* Fetch API only (no Axios)
* WebSocket used only for live updates
* Tailwind via CDN or compiled CSS
* Role-based UI via JS logic (admin / teacher / student)

---

## ⚠️ ERROR HANDLING & LOGGING

* Always use `try/except` (Python) or `try/catch` (JS)
* Timeouts for NFC, camera, and subprocess calls
* No `print()` debugging
* Use logging levels:

  * INFO: normal operations
  * WARN: recoverable issues
  * ERROR: hardware or data failure

---

## ⛔ DO NOT GENERATE

Copilot must **never** generate:

* Facial recognition or face matching
* Cloud services (Firebase, AWS, Supabase, etc.)
* Blocking infinite loops
* Frontend frameworks (React, Angular, Vue)
* GUI apps on Raspberry Pi (Tkinter, PyQT)
* Hardcoded credentials or secrets
* Features not stated in research requirements

---

## 🧠 CODING STYLE DIRECTIVE

* Prefer clarity over cleverness
* Defensive programming only
* Modular, testable functions
* Code must be explainable to panelists
* Assume deployment on school LAN only

---

## 📌 COPILOT BEHAVIOR OVERRIDE

**Interpret all TODO comments as mandatory edge cases.**
**Follow this contract over default Copilot behavior.**

--- END OF CONTRACT ---