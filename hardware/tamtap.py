#!/usr/bin/env python3
"""
TAMTAP v6.3 - LCD Messages PERFECT SYNC
NFC-Based Attendance System | FEU Roosevelt Marikina
State Machine: IDLE → CARD_DETECTED → CAMERA_ACTIVE → SUCCESS|FAIL → IDLE
MongoDB with JSON fallback for offline mode
"""

import json
import time
import os
import signal
import sys
import subprocess
import logging
import shutil
from datetime import datetime
from enum import Enum

import RPi.GPIO as GPIO
from mfrc522 import SimpleMFRC522
import smbus
import cv2

# MongoDB support (optional - fallback to JSON if unavailable)
try:
    from pymongo import MongoClient
    from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError
    MONGODB_AVAILABLE = True
except ImportError:
    MONGODB_AVAILABLE = False
    
# ========================================
# LOGGING CONFIGURATION
# ========================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('TAMTAP')

# ========================================
# HARDWARE CONSTANTS
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
CAMERA_CAPTURE_TIME = 2000  # 2 seconds for camera capture (ms)
CAMERA_TIMEOUT = 3.0        # subprocess timeout
NFC_POLL_INTERVAL = 0.1
FACE_DETECTION_TIMEOUT = 1.2  # Haar cascade timeout

# Face Detection Constants
HAAR_CASCADE_PATH = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
MIN_FACE_SIZE = (80, 80)  # Minimum face size to detect

# File Paths
DB_FILE = "tamtap_users.json"
# Photo directory: ../assets/attendance_photos/{date}/
PHOTO_BASE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "attendance_photos")
TEMP_DETECTION_IMG = "/tmp/tamtap_detect.jpg"

# MongoDB Configuration
MONGODB_URI = "mongodb://naig:naig1229@162.243.218.87:27017/"
MONGODB_DB = "tamtap"
MONGODB_TIMEOUT = 3000  # Connection timeout in ms

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

# Create base photo directory
os.makedirs(PHOTO_BASE_DIR, exist_ok=True)

# ========================================
# 📸 PHOTO HELPER FUNCTIONS
# ========================================
def sanitize_filename(text):
    """Sanitize text for use in filenames - remove special chars, replace spaces"""
    if not text:
        return "Unknown"
    # Replace spaces with underscores, keep only alphanumeric and underscore
    sanitized = "".join(c if c.isalnum() or c == '_' else '_' for c in text.replace(' ', '_'))
    # Remove consecutive underscores and strip
    while '__' in sanitized:
        sanitized = sanitized.replace('__', '_')
    return sanitized.strip('_')[:30]  # Max 30 chars

def get_photo_dir_for_date(date_str=None):
    """
    Get photo directory for a specific date.
    Creates the directory if it doesn't exist.
    Returns: /path/to/assets/attendance_photos/2026-01-17/
    """
    if date_str is None:
        date_str = datetime.now().strftime("%Y-%m-%d")
    
    date_dir = os.path.join(PHOTO_BASE_DIR, date_str)
    os.makedirs(date_dir, exist_ok=True)
    return date_dir

def generate_photo_filename(user_data, suffix=""):
    """
    Generate descriptive filename for attendance photo.
    Format: {tamtap_id}_{first_name}_{last_name}_{time}_{session}{suffix}.jpg
    Example: 001_Charles_Marcelo_081523_AM.jpg
             001_Charles_Marcelo_081523_AM_detected.jpg
    """
    now = datetime.now()
    
    # Extract user info
    tamtap_id = user_data.get("tamtap_id", "000") if user_data else "000"
    first_name = sanitize_filename(user_data.get("first_name", "")) if user_data else ""
    last_name = sanitize_filename(user_data.get("last_name", "")) if user_data else ""
    
    # Fallback to full name if first/last not available
    if not first_name and not last_name:
        full_name = user_data.get("name", "Unknown") if user_data else "Unknown"
        name_parts = full_name.split()
        first_name = sanitize_filename(name_parts[0]) if name_parts else "Unknown"
        last_name = sanitize_filename(name_parts[-1]) if len(name_parts) > 1 else ""
    
    # Time and session
    time_str = now.strftime("%H%M%S")
    session = "AM" if now.hour < 12 else "PM"
    
    # Build filename
    name_part = f"{first_name}_{last_name}" if last_name else first_name
    suffix_part = f"_{suffix}" if suffix else ""
    
    filename = f"{tamtap_id}_{name_part}_{time_str}_{session}{suffix_part}.jpg"
    return filename

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
# 💾 DATABASE CLASS (MongoDB + JSON Fallback)
# ========================================
class Database:
    """
    Database handler with MongoDB primary and JSON fallback.
    Automatically syncs pending attendance when MongoDB becomes available.
    """
    
    def __init__(self):
        self.mongo_client = None
        self.mongo_db = None
        self.mongo_available = False
        self.json_file = DB_FILE
        self._init_json()
        self._connect_mongodb()
    
    def _init_json(self):
        """Initialize JSON file if it doesn't exist"""
        if not os.path.exists(self.json_file):
            self._save_json({
                "students": {},
                "teachers": {},
                "attendance": [],
                "pending_attendance": []
            })
            logger.info("Created new JSON database file")
    
    def _load_json(self):
        """Load JSON database"""
        try:
            with open(self.json_file, 'r') as f:
                data = json.load(f)
                # Ensure all required keys exist
                data.setdefault("students", {})
                data.setdefault("teachers", {})
                data.setdefault("attendance", [])
                data.setdefault("pending_attendance", [])
                return data
        except Exception as e:
            logger.error("JSON load error: %s", e)
            return {"students": {}, "teachers": {}, "attendance": [], "pending_attendance": []}
    
    def _save_json(self, data):
        """Save JSON database"""
        try:
            with open(self.json_file, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error("JSON save error: %s", e)
    
    def _connect_mongodb(self):
        """Attempt to connect to MongoDB"""
        if not MONGODB_AVAILABLE:
            logger.warning("pymongo not installed, using JSON fallback only")
            return False
        
        try:
            self.mongo_client = MongoClient(
                MONGODB_URI,
                serverSelectionTimeoutMS=MONGODB_TIMEOUT
            )
            # Test connection
            self.mongo_client.admin.command('ping')
            self.mongo_db = self.mongo_client[MONGODB_DB]
            self.mongo_available = True
            logger.info("MongoDB connected successfully")
            
            # Sync pending attendance if any
            self._sync_pending_attendance()
            
            return True
        except Exception as e:
            logger.warning("MongoDB connection failed: %s (using JSON fallback)", e)
            self.mongo_available = False
            return False
    
    def _check_mongodb(self):
        """Check if MongoDB is available, reconnect if needed"""
        if not MONGODB_AVAILABLE:
            return False
        
        if self.mongo_available:
            try:
                self.mongo_client.admin.command('ping')
                return True
            except Exception:
                logger.warning("MongoDB connection lost, switching to JSON fallback")
                self.mongo_available = False
        else:
            # Try to reconnect
            if self._connect_mongodb():
                logger.info("MongoDB reconnected")
                return True
        
        return False
    
    def _sync_pending_attendance(self):
        """Sync pending attendance records from JSON to MongoDB"""
        if not self.mongo_available:
            return
        
        data = self._load_json()
        pending = data.get("pending_attendance", [])
        
        if not pending:
            return
        
        synced_count = 0
        failed = []
        
        for record in pending:
            try:
                # Check if record already exists in MongoDB
                existing = self.mongo_db.attendance.find_one({
                    "nfc_id": str(record.get("nfc_id", record.get("uid"))),
                    "date": record.get("date", "")[:10]
                })
                
                if not existing:
                    # Insert to MongoDB
                    self.mongo_db.attendance.insert_one(record)
                synced_count += 1
            except Exception as e:
                logger.error("Failed to sync attendance record: %s", e)
                failed.append(record)
        
        # Update JSON - keep only failed records in pending
        data["pending_attendance"] = failed
        self._save_json(data)
        
        if synced_count > 0:
            logger.info("Synced %d pending attendance records to MongoDB", synced_count)
    
    def lookup_user(self, nfc_id):
        """
        Look up user by NFC ID.
        Returns: (name, role, user_data) or (None, None, None)
        """
        nfc_str = str(nfc_id)
        
        # Try MongoDB first
        if self._check_mongodb():
            try:
                # Check students collection
                student = self.mongo_db.students.find_one({"nfc_id": nfc_str})
                if student:
                    name = f"{student.get('first_name', '')} {student.get('last_name', '')}".strip()
                    if not name:
                        name = student.get("name", "Unknown")
                    return name, "student", student
                
                # Check teachers collection
                teacher = self.mongo_db.teachers.find_one({"nfc_id": nfc_str})
                if teacher:
                    name = f"{teacher.get('first_name', '')} {teacher.get('last_name', '')}".strip()
                    if not name:
                        name = teacher.get("name", "Unknown")
                    return name, "teacher", teacher
                
                return None, None, None
            except Exception as e:
                logger.error("MongoDB lookup error: %s", e)
        
        # Fallback to JSON
        data = self._load_json()
        
        if nfc_str in data.get("students", {}):
            user = data["students"][nfc_str]
            name = f"{user.get('first_name', '')} {user.get('last_name', '')}".strip()
            if not name:
                name = user.get("name", "Unknown")
            return name, "student", user
        
        if nfc_str in data.get("teachers", {}):
            user = data["teachers"][nfc_str]
            name = f"{user.get('first_name', '')} {user.get('last_name', '')}".strip()
            if not name:
                name = user.get("name", "Unknown")
            return name, "teacher", user
        
        return None, None, None
    
    def is_already_logged_today(self, nfc_id):
        """Check if user already logged attendance today"""
        nfc_str = str(nfc_id)
        today = datetime.now().strftime("%Y-%m-%d")
        
        # Try MongoDB first
        if self._check_mongodb():
            try:
                existing = self.mongo_db.attendance.find_one({
                    "nfc_id": nfc_str,
                    "date": {"$regex": f"^{today}"}
                })
                if existing:
                    return True
            except Exception as e:
                logger.error("MongoDB attendance check error: %s", e)
        
        # Also check JSON (for pending records)
        data = self._load_json()
        
        for record in data.get("attendance", []) + data.get("pending_attendance", []):
            record_nfc = str(record.get("nfc_id", record.get("uid", "")))
            record_date = record.get("date", "")[:10]
            if record_nfc == nfc_str and record_date == today:
                return True
        
        return False
    
    def save_attendance_record(self, nfc_id, name, role, photo_path, user_data=None):
        """
        Save attendance record to MongoDB with JSON fallback.
        Returns True if saved successfully.
        """
        if self.is_already_logged_today(nfc_id):
            logger.info("User %s already logged today", name)
            return False
        
        now = datetime.now()
        photo_filename = os.path.basename(photo_path) if photo_path else None
        
        # Build record with new schema
        record = {
            "nfc_id": str(nfc_id),
            "name": name,
            "role": role,
            "date": now.strftime("%Y-%m-%d %H:%M:%S"),
            "time": now.strftime("%H:%M:%S"),
            "photo": photo_filename,
            "photo_path": photo_path,
            "session": "AM" if now.hour < 12 else "PM",
            "status": "present"
        }
        
        # Add user details if available
        if user_data:
            record["tamtap_id"] = user_data.get("tamtap_id", "")
            record["email"] = user_data.get("email", "")
            record["first_name"] = user_data.get("first_name", "")
            record["last_name"] = user_data.get("last_name", "")
            record["grade"] = user_data.get("grade", "")
            record["section"] = user_data.get("section", "")
        
        # Try MongoDB first
        if self._check_mongodb():
            try:
                self.mongo_db.attendance.insert_one(record)
                logger.info("Attendance saved to MongoDB: %s (%s)", name, role)
                
                # Also save to JSON as backup
                data = self._load_json()
                data["attendance"].append(record)
                self._save_json(data)
                
                return True
            except Exception as e:
                logger.error("MongoDB save error: %s", e)
        
        # Fallback: Save to JSON pending queue
        data = self._load_json()
        data["pending_attendance"].append(record)
        self._save_json(data)
        logger.info("Attendance saved to JSON (pending sync): %s (%s)", name, role)
        
        return True
    
    def close(self):
        """Close database connections"""
        if self.mongo_client:
            try:
                self.mongo_client.close()
            except Exception:
                pass

# Initialize database
db = Database()

# ========================================
# CAMERA & FACE DETECTION (OpenCV + Haar Cascade)
# ========================================

# Initialize Haar Cascade for face detection
try:
    face_cascade = cv2.CascadeClassifier(HAAR_CASCADE_PATH)
    if face_cascade.empty():
        logger.error("Failed to load Haar cascade classifier")
        face_cascade = None
    else:
        logger.info("Haar cascade loaded successfully")
except Exception as e:
    logger.error("Haar cascade init error: %s", e)
    face_cascade = None

def capture_photo_for_detection(filename, timeout_ms=1500):
    """Capture photo for face detection - longer exposure for better quality"""
    try:
        result = subprocess.run(
            [
                'rpicam-still',
                '-t', str(timeout_ms),
                '--width', '640',
                '--height', '480',
                '-o', filename
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

def detect_face_in_image(image_path):
    """
    Detect face in image using OpenCV Haar Cascade
    Returns: (bool, num_faces) - whether face detected and count
    """
    if face_cascade is None:
        logger.error("Face cascade not initialized")
        return False, 0
    
    try:
        # Read image
        img = cv2.imread(image_path)
        if img is None:
            logger.warning("Could not read image: %s", image_path)
            return False, 0
        
        # Convert to grayscale for Haar detection
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Detect faces with Haar cascade
        # Parameters tuned for speed (<1.2s) on Raspberry Pi
        faces = face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=4,
            minSize=MIN_FACE_SIZE,
            flags=cv2.CASCADE_SCALE_IMAGE
        )
        
        num_faces = len(faces)
        logger.info("Face detection: found %d face(s)", num_faces)
        
        return num_faces > 0, num_faces
        
    except Exception as e:
        logger.error("Face detection error: %s", e)
        return False, 0

def detect_person(user_data=None, save_detection=True):
    """
    Face detection using OpenCV Haar Cascade:
    1. Capture photo with camera preview (2 seconds)
    2. Run Haar cascade face detection
    3. Optionally save detection photo with user info
    4. Return (success, saved_path)
    
    Total time budget: ≤3.5 seconds
    """
    saved_path = None
    
    try:
        # Capture photo for face detection (shows preview on screen)
        logger.info("Capturing image for face detection...")
        
        if not capture_photo_for_detection(TEMP_DETECTION_IMG, timeout_ms=2000):
            logger.warning("Failed to capture detection image")
            return False, None
        
        # Run face detection with Haar cascade
        logger.info("Running Haar cascade face detection...")
        face_found, num_faces = detect_face_in_image(TEMP_DETECTION_IMG)
        
        if face_found:
            logger.info("Person verified: %d face(s) detected", num_faces)
            
            # Save detection photo if requested
            if save_detection and user_data:
                try:
                    date_dir = get_photo_dir_for_date()
                    filename = generate_photo_filename(user_data, suffix="detected")
                    saved_path = os.path.join(date_dir, filename)
                    
                    # Copy temp file to permanent location
                    shutil.copy2(TEMP_DETECTION_IMG, saved_path)
                    logger.info("Detection photo saved: %s", saved_path)
                except Exception as e:
                    logger.warning("Failed to save detection photo: %s", e)
            
            return True, saved_path
        else:
            logger.info("No face detected in image")
            return False, None
        
    except Exception as e:
        logger.error("Person detection error: %s", e)
        return False, None
        
    finally:
        # Cleanup temp file
        try:
            if os.path.exists(TEMP_DETECTION_IMG):
                os.remove(TEMP_DETECTION_IMG)
        except Exception:
            pass

def take_attendance_photo(user_data):
    """
    Take attendance photo and save to date-organized directory.
    
    Saves to: assets/attendance_photos/{YYYY-MM-DD}/{tamtap_id}_{name}_{time}_{session}.jpg
    Example:  assets/attendance_photos/2026-01-17/001_Charles_Marcelo_081523_AM.jpg
    """
    # Get date-based directory
    date_dir = get_photo_dir_for_date()
    
    # Generate descriptive filename
    filename = generate_photo_filename(user_data)
    filepath = os.path.join(date_dir, filename)
    
    # Try up to 2 times to capture photo
    for attempt in range(2):
        try:
            # Capture high quality photo with 2 second preview
            result = subprocess.run(
                [
                    'rpicam-still',
                    '-t', str(CAMERA_CAPTURE_TIME),
                    '--width', '1024',
                    '--height', '768',
                    '-o', filepath
                ],
                capture_output=True,
                timeout=CAMERA_TIMEOUT
            )
            
            if os.path.exists(filepath) and os.path.getsize(filepath) > 5000:
                logger.info("Attendance photo saved: %s", filepath)
                return filepath
            else:
                logger.warning("Photo file invalid, attempt %d", attempt + 1)
                
        except subprocess.TimeoutExpired:
            logger.warning("Attendance photo timeout, attempt %d", attempt + 1)
        except Exception as e:
            logger.error("Attendance photo error: %s", e)
        
        # Brief delay before retry
        if attempt < 1:
            time.sleep(0.3)
    
    logger.error("Failed to capture attendance photo after retries")
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
    
    Flow: Check user first → Face detection → Photo → Save
    """
    global current_state
    
    logger.info("Card detected: %s", nfc_id)
    
    # === STATE: CARD_DETECTED ===
    current_state = State.CARD_DETECTED
    
    # *** CHECK USER FIRST before any camera operations ***
    lcd.show("CHECKING CARD", "PLEASE WAIT...")
    led_on(GPIO_GREEN_LED)
    
    # Look up user in database
    name, role, user_data = db.lookup_user(nfc_id)
    
    if name is None:
        # User not registered - reject immediately
        logger.warning("Unknown NFC ID: %s", nfc_id)
        led_off(GPIO_GREEN_LED)
        lcd.show("USER NOT FOUND", "REGISTER FIRST")
        led_on(GPIO_RED_LED)
        beep(count=2, duration=0.2, pause=0.1)
        time.sleep(1.5)
        led_off(GPIO_RED_LED)
        current_state = State.IDLE
        return False
    
    # Check if already logged today
    if db.is_already_logged_today(nfc_id):
        led_off(GPIO_GREEN_LED)
        lcd.show("ALREADY LOGGED", name[:LCD_WIDTH])
        led_on(GPIO_GREEN_LED)
        beep(count=1, duration=0.3)
        time.sleep(1.5)
        led_off(GPIO_GREEN_LED)
        current_state = State.IDLE
        return True
    
    # User found - show welcome and proceed to camera
    logger.info("User found: %s (%s)", name, role)
    lcd.show("HELLO " + name[:10], "FACE CAMERA")
    led_off(GPIO_GREEN_LED)
    time.sleep(0.5)
    
    # === STATE: CAMERA_ACTIVE ===
    current_state = State.CAMERA_ACTIVE
    card_detected_state()
    
    # Person detection (face verification) - pass user_data for photo naming
    face_detected, detection_photo = detect_person(user_data=user_data, save_detection=True)
    if not face_detected:
        # === STATE: FAIL ===
        current_state = State.FAIL
        no_face_state()
        current_state = State.IDLE
        return False
    
    # Take attendance photo (required for dashboard) - pass user_data for naming
    lcd.show("TAKING PHOTO", "SMILE!")
    photo_path = take_attendance_photo(user_data)
    
    if not photo_path:
        logger.warning("Photo capture failed for %s", name)
        lcd.show("PHOTO FAILED", "TRY AGAIN")
        led_on(GPIO_RED_LED)
        beep(count=3, duration=0.15, pause=0.1)
        time.sleep(1.5)
        led_off(GPIO_RED_LED)
        current_state = State.IDLE
        return False
    
    # Save attendance record with photo
    if db.save_attendance_record(nfc_id, name, role, photo_path, user_data):
        # === STATE: SUCCESS ===
        current_state = State.SUCCESS
        success_state(name)
    else:
        logger.warning("Failed to save attendance for %s", name)
    
    current_state = State.IDLE
    return True

# ========================================
# SIGNAL HANDLERS
# ========================================
shutdown_in_progress = False

def signal_handler(sig, frame):
    """Handle shutdown signals gracefully"""
    global current_state, shutdown_in_progress
    
    if shutdown_in_progress:
        return
    
    shutdown_in_progress = True
    logger.info("Shutdown signal received")
    current_state = State.SHUTDOWN
    
    try:
        shutdown_state()
        time.sleep(1)
    except Exception:
        pass
    finally:
        try:
            db.close()
        except Exception:
            pass
        try:
            GPIO.cleanup()
        except Exception:
            pass
    
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# ========================================
# 🚀 MAIN ENTRY POINT
# ========================================
def main():
    """Main entry point for TAMTAP v6.3"""
    global current_state
    
    logger.info("=" * 50)
    logger.info("🚀 TAMTAP v6.3 - MongoDB + LCD SYNC STARTING")
    logger.info("=" * 50)
    
    # Database status
    if db.mongo_available:
        logger.info("Database: MongoDB connected")
    else:
        logger.info("Database: JSON fallback mode")
    
    # Startup feedback
    lcd.show("TAMTAP v6.3", "STARTING...")
    led_on(GPIO_GREEN_LED)
    beep(count=2, duration=0.1, pause=0.1)
    time.sleep(0.5)
    led_off(GPIO_GREEN_LED)
    
    # Camera test
    logger.info("Testing camera...")
    try:
        subprocess.run(
            ['rpicam-hello', '-t', '500'],
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
                    
                    # Reset RFID reader state to allow next card read
                    try:
                        reader.READER.MFRC522_StopCrypto1()
                    except Exception:
                        pass
                    
                    # Debounce delay - wait for card to be removed
                    time.sleep(2.0)
                
                time.sleep(NFC_POLL_INTERVAL)
                
            except Exception as e:
                if not shutdown_in_progress:
                    logger.error("RFID read error: %s", e)
                    # Reset reader on error
                    try:
                        reader.READER.MFRC522_StopCrypto1()
                    except Exception:
                        pass
                    time.sleep(0.5)
                
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        if not shutdown_in_progress:
            try:
                shutdown_state()
                time.sleep(0.5)
            except Exception:
                pass
            finally:
                try:
                    db.close()
                except Exception:
                    pass
                try:
                    GPIO.cleanup()
                except Exception:
                    pass
        logger.info("TAMTAP shutdown complete")

if __name__ == "__main__":
    main()
