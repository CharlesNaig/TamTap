#!/usr/bin/env python3
"""
🚀 TAMTAP v6.2 - LCD Messages PERFECT SYNC
NFC-Based Attendance System | FEU Roosevelt Marikina
State Machine: IDLE → CARD_DETECTED → CAMERA_ACTIVE → SUCCESS|FAIL → IDLE
"""

import json
import time
import os
import signal
import sys
import subprocess
import logging
from datetime import datetime
from enum import Enum

import RPi.GPIO as GPIO
from mfrc522 import SimpleMFRC522
import smbus

# ========================================
# 📋 LOGGING CONFIGURATION
# ========================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('TAMTAP')

# ========================================
# 🔧 HARDWARE CONSTANTS
# ========================================
# GPIO Pins
GPIO_GREEN_LED = 17
GPIO_RED_LED = 27
GPIO_BUZZER = 18

# I2C LCD Configuration
LCD_ADDRESS = 0x27
LCD_WIDTH = 16
LCD_CHR = 1  # Character mode
LCD_CMD = 0  # Command mode
LCD_LINE_1 = 0x80  # Line 1 address
LCD_LINE_2 = 0xC0  # Line 2 address
LCD_BACKLIGHT = 0x08
ENABLE = 0b00000100

# Timing Constants (in seconds)
CAMERA_TIMEOUT = 1.5
NFC_POLL_INTERVAL = 0.1
DETECTION_THRESHOLD = 1.3  # 30% larger = person present

# File Paths
DB_FILE = "tamtap_users.json"
PHOTO_DIR = "attendance_photos"

# ========================================
# 🔁 STATE MACHINE
# ========================================
class State(Enum):
    IDLE = "IDLE"
    CARD_DETECTED = "CARD_DETECTED"
    CAMERA_ACTIVE = "CAMERA_ACTIVE"
    SUCCESS = "SUCCESS"
    FAIL = "FAIL"
    SHUTDOWN = "SHUTDOWN"

# ========================================
# 🔧 GPIO INITIALIZATION
# ========================================
GPIO.setwarnings(False)
GPIO.setmode(GPIO.BCM)
GPIO.setup(GPIO_GREEN_LED, GPIO.OUT)
GPIO.setup(GPIO_RED_LED, GPIO.OUT)
GPIO.setup(GPIO_BUZZER, GPIO.OUT)

# Turn off all outputs initially
GPIO.output(GPIO_GREEN_LED, GPIO.LOW)
GPIO.output(GPIO_RED_LED, GPIO.LOW)
GPIO.output(GPIO_BUZZER, GPIO.LOW)

# Initialize RFID reader
reader = SimpleMFRC522()

# Create photo directory
os.makedirs(PHOTO_DIR, exist_ok=True)

# ========================================
# 📱 I2C LCD DRIVER (SMBus)
# ========================================
class LCD:
    """I2C LCD 16x2 Driver using SMBus"""
    
    def __init__(self, address=LCD_ADDRESS):
        self.address = address
        self.bus = None
        self.initialized = False
        self._init_lcd()
    
    def _init_lcd(self):
        """Initialize LCD display"""
        try:
            self.bus = smbus.SMBus(1)
            # LCD initialization sequence
            self._write_byte(0x33, LCD_CMD)
            self._write_byte(0x32, LCD_CMD)
            self._write_byte(0x06, LCD_CMD)  # Cursor move direction
            self._write_byte(0x0C, LCD_CMD)  # Display on, cursor off
            self._write_byte(0x28, LCD_CMD)  # 2 line, 5x8 matrix
            self._write_byte(0x01, LCD_CMD)  # Clear display
            time.sleep(0.005)
            self.initialized = True
            logger.info("LCD initialized at address 0x%02X", self.address)
        except Exception as e:
            logger.error("LCD initialization failed: %s", e)
            self.initialized = False
    
    def _write_byte(self, bits, mode):
        """Write byte to LCD using 4-bit mode"""
        if not self.bus:
            return
        try:
            # High nibble
            high = mode | (bits & 0xF0) | LCD_BACKLIGHT
            self.bus.write_byte(self.address, high)
            self._toggle_enable(high)
            
            # Low nibble
            low = mode | ((bits << 4) & 0xF0) | LCD_BACKLIGHT
            self.bus.write_byte(self.address, low)
            self._toggle_enable(low)
        except Exception:
            pass
    
    def _toggle_enable(self, bits):
        """Toggle enable pin for LCD"""
        try:
            time.sleep(0.0005)
            self.bus.write_byte(self.address, bits | ENABLE)
            time.sleep(0.0005)
            self.bus.write_byte(self.address, bits & ~ENABLE)
            time.sleep(0.0005)
        except Exception:
            pass
    
    def clear(self):
        """Clear LCD display"""
        self._write_byte(0x01, LCD_CMD)
        time.sleep(0.005)
    
    def show(self, line1="", line2=""):
        """Display two lines on LCD (≤100ms)"""
        if not self.initialized:
            logger.info("LCD: %s | %s", line1, line2)
            return
        
        try:
            # Line 1
            self._write_byte(LCD_LINE_1, LCD_CMD)
            message1 = line1.ljust(LCD_WIDTH)[:LCD_WIDTH]
            for char in message1:
                self._write_byte(ord(char), LCD_CHR)
            
            # Line 2
            self._write_byte(LCD_LINE_2, LCD_CMD)
            message2 = line2.ljust(LCD_WIDTH)[:LCD_WIDTH]
            for char in message2:
                self._write_byte(ord(char), LCD_CHR)
            
            logger.info("LCD: %s | %s", line1, line2)
        except Exception as e:
            logger.warning("LCD write error: %s", e)

# Initialize LCD
lcd = LCD()

# ========================================
# 🔊 FEEDBACK FUNCTIONS
# ========================================
def beep(count=1, duration=0.1, pause=0.1):
    """Non-blocking buzzer beeps"""
    for i in range(count):
        GPIO.output(GPIO_BUZZER, GPIO.HIGH)
        time.sleep(duration)
        GPIO.output(GPIO_BUZZER, GPIO.LOW)
        if i < count - 1:
            time.sleep(pause)

def led_on(pin):
    """Turn LED on"""
    GPIO.output(pin, GPIO.HIGH)

def led_off(pin):
    """Turn LED off"""
    GPIO.output(pin, GPIO.LOW)

def all_leds_off():
    """Turn all LEDs off"""
    GPIO.output(GPIO_GREEN_LED, GPIO.LOW)
    GPIO.output(GPIO_RED_LED, GPIO.LOW)

# ========================================
# 💾 DATABASE FUNCTIONS
# ========================================
def load_db():
    """Load user database from JSON file"""
    try:
        with open(DB_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        logger.warning("Database file not found, creating empty database")
        db = {"students": {}, "teachers": {}, "attendance": []}
        save_db(db)
        return db
    except json.JSONDecodeError as e:
        logger.error("Database JSON error: %s", e)
        return {"students": {}, "teachers": {}, "attendance": []}

def save_db(db):
    """Save database to JSON file"""
    try:
        with open(DB_FILE, 'w') as f:
            json.dump(db, f, indent=2)
    except Exception as e:
        logger.error("Failed to save database: %s", e)

def lookup_user(nfc_id):
    """Look up user by NFC ID, returns (name, role) or (None, None)"""
    db = load_db()
    nfc_str = str(nfc_id)
    
    # Check students first
    if nfc_str in db.get("students", {}):
        return db["students"][nfc_str].get("name", "Unknown"), "student"
    
    # Check teachers
    if nfc_str in db.get("teachers", {}):
        return db["teachers"][nfc_str].get("name", "Unknown"), "teacher"
    
    return None, None

def is_already_logged_today(nfc_id):
    """Check if user already logged attendance today"""
    db = load_db()
    today = datetime.now().strftime("%Y-%m-%d")
    
    for record in db.get("attendance", []):
        record_date = record.get("date", "")[:10]
        if str(record.get("uid")) == str(nfc_id) and record_date == today:
            return True
    return False

def save_attendance_record(nfc_id, name, role, photo_path):
    """Save attendance record to database (one per UID per day)"""
    if is_already_logged_today(nfc_id):
        logger.info("User %s already logged today", name)
        return False
    
    db = load_db()
    now = datetime.now()
    
    record = {
        "uid": nfc_id,
        "name": name,
        "role": role,
        "date": now.strftime("%Y-%m-%d %H:%M:%S"),
        "photo": os.path.basename(photo_path) if photo_path else None,
        "session": "AM" if now.hour < 12 else "PM"
    }
    
    db["attendance"].append(record)
    save_db(db)
    logger.info("Attendance saved: %s (%s)", name, role)
    return True

# ========================================
# 📸 CAMERA FUNCTIONS (rpicam-still)
# ========================================
def capture_photo(filename, width=320, height=240, timeout_ms=500):
    """Capture photo using rpicam-still with timeout"""
    try:
        result = subprocess.run(
            [
                'rpicam-still',
                '-t', str(timeout_ms),
                '--width', str(width),
                '--height', str(height),
                '-o', filename,
                '--nopreview'
            ],
            capture_output=True,
            timeout=CAMERA_TIMEOUT
        )
        
        if os.path.exists(filename) and os.path.getsize(filename) > 1000:
            return True
    except subprocess.TimeoutExpired:
        logger.warning("Camera capture timeout")
    except Exception as e:
        logger.error("Camera error: %s", e)
    
    return False

def detect_person():
    """
    Motion detection algorithm:
    1. Capture empty frame
    2. Wait 0.5 seconds
    3. Capture person frame
    4. Compare file sizes
    5. If person_size > empty_size * 1.3 → Person detected
    """
    empty_path = "/tmp/tamtap_empty.jpg"
    person_path = "/tmp/tamtap_person.jpg"
    
    try:
        # Capture frame 1 (baseline)
        if not capture_photo(empty_path):
            logger.warning("Failed to capture baseline frame")
            return False
        
        time.sleep(0.5)
        
        # Capture frame 2 (with potential person)
        if not capture_photo(person_path):
            logger.warning("Failed to capture detection frame")
            return False
        
        # Compare file sizes
        empty_size = os.path.getsize(empty_path) if os.path.exists(empty_path) else 0
        person_size = os.path.getsize(person_path) if os.path.exists(person_path) else 0
        
        if empty_size > 0 and person_size > empty_size * DETECTION_THRESHOLD:
            logger.info("Person detected (size ratio: %.2f)", person_size / empty_size)
            return True
        
        logger.info("No person detected (size ratio: %.2f)", 
                   person_size / empty_size if empty_size > 0 else 0)
        return False
        
    finally:
        # Cleanup temp files
        for path in [empty_path, person_path]:
            try:
                if os.path.exists(path):
                    os.remove(path)
            except Exception:
                pass

def take_attendance_photo(nfc_id):
    """Take attendance photo and save to photo directory"""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{PHOTO_DIR}/att_{nfc_id}_{timestamp}.jpg"
    
    try:
        result = subprocess.run(
            [
                'rpicam-still',
                '-t', '1000',
                '--width', '1024',
                '--height', '768',
                '-o', filename,
                '--nopreview'
            ],
            capture_output=True,
            timeout=CAMERA_TIMEOUT
        )
        
        if os.path.exists(filename) and os.path.getsize(filename) > 5000:
            logger.info("Attendance photo saved: %s", filename)
            return filename
    except subprocess.TimeoutExpired:
        logger.warning("Attendance photo timeout")
    except Exception as e:
        logger.error("Attendance photo error: %s", e)
    
    return None

# ========================================
# 🔁 STATE MACHINE FUNCTIONS
# ========================================
current_state = State.IDLE

def idle_state():
    """IDLE state: Display waiting message, all LEDs off"""
    lcd.show("WAITING FOR", "STUDENT...")
    all_leds_off()

def card_detected_state():
    """CARD_DETECTED state: Prompt to face camera, green LED blink"""
    lcd.show("FACE CAMERA", "STAND CLEAR")
    # Green LED blink (non-blocking single blink)
    led_on(GPIO_GREEN_LED)
    time.sleep(0.2)
    led_off(GPIO_GREEN_LED)

def no_face_state():
    """NO_FACE/FAIL state: Display error, red LED on, 5 beeps"""
    lcd.show("NO FACE DETECT", "TRY AGAIN!")
    led_on(GPIO_RED_LED)
    beep(count=5, duration=0.1, pause=0.1)
    time.sleep(1.0)
    led_off(GPIO_RED_LED)

def success_state(name):
    """SUCCESS state: Display welcome, green LED on, 3 beeps"""
    # Truncate name to fit LCD (16 chars max)
    display_name = name[:LCD_WIDTH] if name else "STUDENT"
    lcd.show("WELCOME", display_name)
    led_on(GPIO_GREEN_LED)
    beep(count=3, duration=0.15, pause=0.1)
    time.sleep(1.5)
    led_off(GPIO_GREEN_LED)

def shutdown_state():
    """SHUTDOWN state: Display shutdown message"""
    lcd.show("SHUTDOWN", "TAMTAP")
    all_leds_off()

# ========================================
# 🚀 MAIN ATTENDANCE CYCLE
# ========================================
def process_card(nfc_id):
    """
    Process card tap through state machine:
    CARD_DETECTED → CAMERA_ACTIVE → SUCCESS|FAIL → IDLE
    """
    global current_state
    
    logger.info("Card detected: %s", nfc_id)
    
    # === STATE: CARD_DETECTED ===
    current_state = State.CARD_DETECTED
    card_detected_state()
    
    # === STATE: CAMERA_ACTIVE ===
    current_state = State.CAMERA_ACTIVE
    
    # Person detection
    if not detect_person():
        # === STATE: FAIL ===
        current_state = State.FAIL
        no_face_state()
        current_state = State.IDLE
        return False
    
    # Look up user in database
    name, role = lookup_user(nfc_id)
    
    if name is None:
        logger.warning("Unknown NFC ID: %s", nfc_id)
        lcd.show("UNKNOWN CARD", "REGISTER FIRST")
        led_on(GPIO_RED_LED)
        beep(count=2, duration=0.2, pause=0.1)
        time.sleep(1.5)
        led_off(GPIO_RED_LED)
        current_state = State.IDLE
        return False
    
    # Check if already logged today
    if is_already_logged_today(nfc_id):
        lcd.show("ALREADY LOGGED", name[:LCD_WIDTH])
        led_on(GPIO_GREEN_LED)
        beep(count=1, duration=0.3)
        time.sleep(1.5)
        led_off(GPIO_GREEN_LED)
        current_state = State.IDLE
        return True
    
    # Take attendance photo
    photo_path = take_attendance_photo(nfc_id)
    
    # Save attendance record
    if save_attendance_record(nfc_id, name, role, photo_path):
        # === STATE: SUCCESS ===
        current_state = State.SUCCESS
        success_state(name)
    else:
        logger.warning("Failed to save attendance for %s", name)
    
    current_state = State.IDLE
    return True

# ========================================
# 🛑 SIGNAL HANDLERS
# ========================================
def signal_handler(sig, frame):
    """Handle shutdown signals gracefully"""
    global current_state
    logger.info("Shutdown signal received")
    current_state = State.SHUTDOWN
    shutdown_state()
    time.sleep(1)
    GPIO.cleanup()
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# ========================================
# 🚀 MAIN ENTRY POINT
# ========================================
def main():
    """Main entry point for TAMTAP v6.2"""
    global current_state
    
    logger.info("=" * 50)
    logger.info("🚀 TAMTAP v6.2 - LCD SYNC STARTING")
    logger.info("=" * 50)
    
    # Startup feedback
    lcd.show("TAMTAP v6.2", "STARTING...")
    led_on(GPIO_GREEN_LED)
    beep(count=2, duration=0.1, pause=0.1)
    time.sleep(0.5)
    led_off(GPIO_GREEN_LED)
    
    # Camera test
    logger.info("Testing camera...")
    try:
        subprocess.run(
            ['rpicam-hello', '-t', '500', '--nopreview'],
            capture_output=True,
            timeout=2
        )
        logger.info("Camera OK")
    except Exception as e:
        logger.warning("Camera test warning: %s", e)
    
    # Enter IDLE state
    current_state = State.IDLE
    idle_state()
    
    logger.info("System ready - waiting for RFID taps...")
    
    # Main loop
    try:
        while current_state != State.SHUTDOWN:
            try:
                # Non-blocking RFID read
                nfc_id, text = reader.read_no_block()
                
                if nfc_id:
                    process_card(nfc_id)
                    # Return to IDLE after processing
                    idle_state()
                    # Debounce delay
                    time.sleep(2.0)
                
                time.sleep(NFC_POLL_INTERVAL)
                
            except Exception as e:
                logger.error("RFID read error: %s", e)
                time.sleep(0.5)
                
    except KeyboardInterrupt:
        pass
    finally:
        shutdown_state()
        time.sleep(0.5)
        GPIO.cleanup()
        logger.info("TAMTAP shutdown complete")

if __name__ == "__main__":
    main()
