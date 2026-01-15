**🎯 PERFECT GitHub Copilot INSTRUCTION for TAMTAP**

## **📋 MASTER COPILOT PROMPT TEMPLATE**

```
# TAMTAP - NFC ATTENDANCE SYSTEM (FEU ROOSEVELT MARIKINA)
# Grade 12 ICT Capstone Project - S.Y. 2025-2026
# Authors: Charles Giann Marcelo + Team

## 🔧 HARDWARE SPECIFICATIONS
- Raspberry Pi 4B (4GB RAM, Bookworm OS)
- RC522 NFC Reader (SPI: GPIO 8,9,10,11,25)
- I2C LCD 16x2 (0x27 address)
- Pi Camera v2 5MP (CSI ribbon cable)
- LEDs: Green(G17), Red(G27), Buzzer(G18+relay)

## 🛠️ SOFTWARE STACK
**Hardware Control:** Python 3.11 + RPi.GPIO + mfrc522 + smbus
**Backend:** Node.js 20 + Express + MongoDB + Socket.IO  
**Frontend:** HTML/CSS/JS + Bootstrap 5 + WebSocket
**Database:** MongoDB (local: mongodb://localhost:27017/tamtap_db)

## 🎯 SYSTEM REQUIREMENTS (FROM RESEARCH PAPER)
1. NFC tap → Camera verification → LCD feedback (<3.5s total)
2. Anti-proxy: No face = "TRY AGAIN TMRW" 
3. Real-time LAN dashboard (no cloud)
4. Daily CSV reports for teachers
5. 211 Grade 11 students (FEURM)
6. SDG 4+9 compliance

## 📊 DATABASE SCHEMA
students: {uid, name, grade, section, nfc_id}
attendance: {uid, name, date, time, status, photo_path, session}

## 🎮 LCD STATES
IDLE: "WAITING FOR"/"STUDENT..."
CARD: "FACE CAMERA"/"STAND CLEAR"  
FAIL: "NO FACE DETECT"/"TRY AGAIN TMRW"
SUCCESS: "WELCOME"/"CHARLES R."

## ⚠️ CRITICAL CONSIDERATIONS
```
**LANGUAGE CHOICES & CONSIDERATIONS:**

### **1. PYTHON 3.11 (Hardware Control)**
```
# ✅ WHY PYTHON:
# - Native RPi.GPIO, mfrc522, smbus libraries
# - Bookworm OS compatibility guaranteed  
# - Real-time GPIO control (<10ms latency)
# - Camera: rpicam-apps native integration
# - Proven in 40+ research papers [file:2]

# ❌ DON'T USE:
# - C++ (complex GPIO setup)
# - Java (no hardware libs)
# - MicroPython (slow for camera)

# 📝 ALWAYS INCLUDE:
GPIO.setwarnings(False)
GPIO.setmode(GPIO.BCM)
try/except for camera timeouts
non-blocking NFC reads
```

### **2. NODE.JS 20 (Backend + Dashboard)**
```
# ✅ WHY NODE.JS:
# - Socket.IO for real-time updates (<200ms)
# - Express.js REST API (industry standard)
# - MongoDB native driver (mongoose ODM)
# - Proven LAN dashboard architecture
# - npm ecosystem for CSV export

# 📝 ALWAYS INCLUDE:
const cors = require('cors'); // LAN access
app.use(express.json());
io.emit('new_attendance', data); // WebSocket
```

### **3. MONGODB (Local Database)**
```
# ✅ WHY MONGODB:
# - Perfect for JSON-like attendance logs
# - Local LAN operation (RA 10173 compliant)
# - Indexes on uid+date for fast queries
# - No cloud dependency (research requirement)

# ❌ DON'T USE:
# - MySQL (overkill for 211 students)
# - SQLite (no real-time sync)
```

### **4. HTML/CSS/JS + BOOTSTRAP 5 (Frontend)**
```
# ✅ WHY VANILLA + BOOTSTRAP:
# - Zero framework overhead (Pi 4B friendly)
# - Bootstrap 5 responsive design
# - WebSocket native browser support
# - CSV download without libraries

# 📝 STRUCTURE:
<div class="container-fluid">
  <div id="live-feed" class="row"></div>  
  <div id="stats" class="col-md-4"></div>
</div>
```

## 🚀 COPILOT USAGE WORKFLOW

### **STEP 1: File Header Comment**
```python
"""
TAMTAP v1.0 - NFC Attendance System (FEU Roosevelt Marikina)
Hardware: Pi4B + RC522 + Camera v2 + I2C LCD(0x27)
Requirements: <3.5s cycle, Camera anti-proxy, LAN dashboard
Authors: Charles Giann Marcelo et al. (Grade 12-ICT)
"""
```

### **STEP 2: Module-Specific Prompts**
```
# In VSCode with Copilot extension:
# 1. Create new file: hardware/nfc_reader.py
# 2. Paste header comment above  
# 3. Type function signature → Copilot auto-completes
# 4. Add "TODO:" comments for edge cases
# 5. Use Ctrl+Enter for full function generation

Example:
def read_card_non_blocking(self) -> Optional[tuple]:
    """Non-blocking NFC read with 100ms timeout"""
    # Copilot generates complete implementation
```

### **STEP 3: Error Handling Template**
```python
def safe_operation(func):
    """Decorator for hardware timeout + error recovery"""
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except subprocess.TimeoutExpired:
            logger.error("Hardware timeout")
            lcd.show("ERROR", "RETRY...")
        except Exception as e:
            logger.error(f"Unexpected: {e}")
            feedback.failure()
    return wrapper
```

## 🎯 QUICK-START COPILOT COMMANDS

**For each file, start with:**
```python
# TAMTAP MODULE: [nfc/camera/lcd/db/dashboard]
# LANGUAGE: [Python/Node.js/HTML] 
# GPIO: [list pins] | I2C: 0x27 | Camera: rpicam-still
# REQUIREMENTS: [specific timing/accuracy from paper]
```

**Example:**
```python
# TAMTAP MODULE: LCD Display
# LANGUAGE: Python 3.11 | I2C: 0x27 
# REQUIREMENTS: <100ms update, 4 states (IDLE/CARD/FAIL/SUCCESS)

class LCDDisplay:
    def show(self, line1: str, line2: str):
        # Copilot generates full I2C implementation
```