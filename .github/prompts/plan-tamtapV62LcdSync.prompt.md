# 🚀 TAMTAP v6.2 - LCD Messages PERFECT SYNC

## 📋 Overview

**Goal:** Implement synchronized LCD state machine with clear user feedback flow.

**Flow:** `IDLE → CARD TAP → FACE DETECT → SUCCESS/FAIL → BACK TO IDLE`

---

## 📺 LCD State Machine

| State | Line 1 | Line 2 | LED | Buzzer |
|-------|--------|--------|-----|--------|
| **IDLE** | `WAITING FOR` | `STUDENT...` | All OFF | OFF |
| **CARD TAP** | `FACE CAMERA` | `STAND CLEAR` | Green blink | OFF |
| **NO FACE** | `NO FACE DETECT` | `TRY AGAIN TMRW` | Red ON | 5 beeps |
| **SUCCESS** | `WELCOME` | `{NAME}` | Green ON | 3 beeps |
| **SHUTDOWN** | `SHUTDOWN` | `TAMTAP` | All OFF | OFF |

---

## 🔧 Hardware Configuration

```
GPIO PINS:
- GPIO 17: Green LED (Success)
- GPIO 27: Red LED (Error)
- GPIO 18: Buzzer

I2C LCD:
- Address: 0x27
- Size: 16x2 characters
- Bus: SMBus(1)

RFID:
- MFRC522 via SPI

CAMERA:
- rpicam-still (Pi4 Bookworm)
```

---

## 📁 File Structure

```
/home/charles/Desktop/TamTap/
├── tamtap_v6.2.py          # Main application
├── tamtap_users.json       # User database
└── attendance_photos/      # Captured photos
    └── att_{uid}_{timestamp}.jpg
```

---

## 🔄 Process Flow

```
┌─────────────────────────────────────────────────────────────┐
│  1. IDLE STATE                                              │
│     LCD: "WAITING FOR" / "STUDENT..."                       │
│     → Wait for RFID tap                                     │
└─────────────────┬───────────────────────────────────────────┘
                  │ RFID Detected
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  2. CARD DETECTED STATE                                     │
│     LCD: "FACE CAMERA" / "STAND CLEAR"                      │
│     → Capture 2 photos for motion detection                 │
└─────────────────┬───────────────────────────────────────────┘
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
┌───────────────┐   ┌───────────────────────────────────────┐
│  NO PERSON    │   │  PERSON DETECTED                      │
│  LCD: "NO     │   │  → Take attendance photo              │
│  FACE DETECT" │   │  → Look up user in database           │
│  5x Red beeps │   │  → Save attendance record             │
└───────┬───────┘   └───────────────┬───────────────────────┘
        │                           │
        │                   ┌───────┴───────┐
        │                   ▼               ▼
        │           ┌───────────────┐ ┌───────────────┐
        │           │  UNKNOWN CARD │ │  SUCCESS!     │
        │           │  LCD: "NO     │ │  LCD: "WELCOME│
        │           │  FACE DETECT" │ │  / {NAME}"    │
        │           │  5x Red beeps │ │  3x Green beep│
        │           └───────┬───────┘ └───────┬───────┘
        │                   │                 │
        └───────────────────┴────────┬────────┘
                                     ▼
                          ┌─────────────────────┐
                          │  RETURN TO IDLE     │
                          │  (2 second delay)   │
                          └─────────────────────┘
```

---

## 💾 Database Schema

```json
{
  "students": {
    "479217313927": {
      "name": "Charles Rodriguez",
      "grade": "12"
    }
  },
  "attendance": [
    {
      "uid": "479217313927",
      "name": "Charles Rodriguez",
      "date": "2026-01-15 08:30:00",
      "status": "PRESENT"
    }
  ]
}
```

---

## 📸 Camera Detection Logic

```python
# Motion detection algorithm:
# 1. Capture empty frame
# 2. Wait 0.5 seconds
# 3. Capture person frame
# 4. Compare file sizes
# 5. If person_size > empty_size * 1.3 → Person detected

THRESHOLD = 1.3  # 30% larger = person present
```

---

## ✅ Implementation Checklist

- [ ] LCD I2C initialization with proper nibble writing
- [ ] State functions: `idle_state()`, `card_detected_state()`, `no_face_state()`, `success_state()`
- [ ] GPIO setup for LEDs and buzzer
- [ ] RFID reader with `read_no_block()`
- [ ] Camera capture with rpicam-still
- [ ] Motion detection (frame comparison)
- [ ] Database load/save functions
- [ ] Main loop with state transitions
- [ ] Graceful shutdown handling

---

## 🧪 Test Scenarios

| Test | Expected LCD | Expected Feedback |
|------|--------------|-------------------|
| Boot system | "TAMTAP v6.2" → "WAITING FOR" | Green LED flash |
| Tap valid card + face | "FACE CAMERA" → "WELCOME" | 3 green beeps |
| Tap valid card + no face | "FACE CAMERA" → "NO FACE DETECT" | 5 red beeps |
| Tap unknown card | "FACE CAMERA" → "NO FACE DETECT" | 5 red beeps |
| Ctrl+C | "SHUTDOWN" | Clean GPIO |

---

## 📝 Notes

- LCD messages limited to 16 characters per line
- Use `.ljust(16)[:16]` to ensure proper padding
- Always return to IDLE state after processing
- 2 second delay between card reads to prevent duplicates
- Photos saved as `att_{uid}_{timestamp}.jpg`
