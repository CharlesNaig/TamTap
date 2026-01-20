# 🧠 TAMTAP – GPIO BUTTON CONTROL (COPILOT PROMPT)

## 🎯 GOAL

Create a **Python-based GPIO button controller** for the TAMTAP system that safely controls the application lifecycle using **three physical buttons**:

* START
* RESTART
* GRACEFUL SHUTDOWN

The solution must be **reliable, debounced, safe**, and use **systemd**, not direct process killing.

---

## 🔘 BUTTON LOGIC (FINAL)

### 🟢 START BUTTON

**Purpose:** Start the TAMTAP application and initialize hardware.

* GPIO: **BCM 5**
* Action:

  ```bash
  sudo systemctl start tamtap.service
  ```
* Ignore press if service is already running

---

### 🟡 RESTART BUTTON

**Purpose:** Restart the TAMTAP application without rebooting the OS.

* GPIO: **BCM 6**
* Action:

  ```bash
  sudo systemctl restart tamtap.service
  ```

---

### 🔴 SHUTDOWN BUTTON (GRACEFUL)

**Purpose:** Exit the application cleanly, save database, then shut down the OS.

* GPIO: **BCM 16**
* Must be **LONG PRESS ONLY** (2–3 seconds)
* Action sequence:

  1. `sudo systemctl stop tamtap.service`
  2. Wait for service to fully stop
  3. `sudo shutdown now`

⚠️ Do NOT shut down the OS before stopping the service.

---

## 🔧 GPIO REQUIREMENTS

* Use **BCM numbering**
* Buttons are **active LOW**
* Use **internal pull-up resistors**
* Wiring: `GPIO → Button → GND`

---

## 🧩 ARCHITECTURE REQUIREMENTS

### 1️⃣ Button Listener Script

Create a Python script (e.g. `button_listener.py`) that:

* Uses `gpiozero` (preferred) or `RPi.GPIO`
* Implements:

  * Debounce (≥ 200 ms)
  * Long-press detection for shutdown
* Runs continuously
* Executes **systemctl commands only**
* Never runs or kills Python scripts directly

---

### 2️⃣ systemd Service for Buttons

Create `tamtap-buttons.service` that:

* Runs on boot
* Executes `button_listener.py`
* Restarts automatically if it crashes
* Runs with sufficient privileges to call `systemctl`

---

### 3️⃣ TAMTAP Backend (Assume exists)

Assume the TAMTAP backend already:

* Runs via `tamtap.service`
* Handles `SIGTERM` for graceful shutdown
* Saves database and releases hardware before exit

Do NOT reimplement backend logic here.

---

## 🧪 SAFETY RULES

* Shutdown button must be **long press only**
* Ignore repeated presses while an action is in progress
* No busy looping (use event-based callbacks)
* Clean GPIO cleanup on exit

---

## 📂 EXPECTED OUTPUT FILES

* `button_listener.py`
* `tamtap-buttons.service`
* (Optional) helper functions for checking service status

---

## 📌 DESIGN PRINCIPLES (FOLLOW STRICTLY)

* Favor reliability over shortcuts
* No `kill`, `pkill`, or forced exits
* No OS shutdown inside the backend
* Use `systemctl` as the control boundary

---

## ✅ FINAL INSTRUCTION

Implement exactly as specified above.
Do not simplify shutdown logic.
Write clean, readable, production-quality code.
