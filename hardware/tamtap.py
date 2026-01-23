#!/usr/bin/env python3
"""
TAMTAP v7.0 - LCD Messages PERFECT SYNC
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
import urllib.request
import urllib.error
from datetime import datetime
from enum import Enum
from dotenv import load_dotenv

# Load .env from project root
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(_PROJECT_ROOT, ".env"))

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

# Database module (shared sync logic)
from database import Database as SharedDatabase
    
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
PHOTO_BASE_DIR = os.path.join(_PROJECT_ROOT, "assets", "attendance_photos")
TEMP_DETECTION_IMG = "/tmp/tamtap_detect.jpg"

# API Server Configuration (from .env)
API_SERVER_URL = os.getenv("TAMTAP_API_URL", "http://localhost:3000")
API_TIMEOUT = 2  # seconds

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

# ========================================
# 📡 RFID READER MANAGEMENT (Stability Fix)
# ========================================
# Problem: RC522 reader sometimes freezes after first read
# Solution: Wrapper class with timeout, reset, and SPI cleanup

class RFIDManager:
    """
    RFID Reader Manager with stability improvements.
    Handles timeouts, resets, and SPI buffer clearing.
    """
    
    def __init__(self):
        self.reader = None
        self.consecutive_errors = 0
        self.max_consecutive_errors = 5
        self.last_read_time = 0
        self._init_reader()
    
    def _init_reader(self):
        """Initialize or reinitialize the RFID reader"""
        try:
            logger.debug("RFID: Initializing reader...")
            self.reader = SimpleMFRC522()
            self.consecutive_errors = 0
            logger.info("RFID: Reader initialized successfully")
        except Exception as e:
            logger.error("RFID: Failed to initialize reader: %s", e)
            self.reader = None
    
    def reset_reader(self):
        """
        Full reset of the RFID reader.
        Called after errors or stuck states.
        """
        logger.warning("RFID: Resetting reader...")
        try:
            # Stop any ongoing crypto operations
            if self.reader and hasattr(self.reader, 'READER'):
                try:
                    self.reader.READER.MFRC522_StopCrypto1()
                except Exception:
                    pass
                
                # Soft reset the MFRC522
                try:
                    self.reader.READER.MFRC522_Reset()
                except Exception:
                    pass
            
            # Small delay for SPI bus to settle
            time.sleep(0.1)
            
            # Reinitialize
            self._init_reader()
            
        except Exception as e:
            logger.error("RFID: Reset failed: %s", e)
            # Force full reinitialization
            time.sleep(0.5)
            self._init_reader()
    
    def read_card(self, timeout_ms=100):
        """
        Non-blocking card read with timeout.
        
        Args:
            timeout_ms: Maximum time to wait for card (milliseconds)
        
        Returns:
            (nfc_id, text) or (None, None) if no card or error
        """
        if not self.reader:
            logger.error("RFID: Reader not initialized")
            self._init_reader()
            return None, None
        
        try:
            logger.debug("RFID: Read start")
            start_time = time.time()
            
            # Perform non-blocking read
            nfc_id, text = self.reader.read_no_block()
            
            elapsed_ms = (time.time() - start_time) * 1000
            
            if nfc_id:
                logger.info("RFID: UID detected: %s (%.0fms)", nfc_id, elapsed_ms)
                self.consecutive_errors = 0
                self.last_read_time = time.time()
                
                # Clean up after successful read
                self._cleanup_after_read()
                
                return nfc_id, text
            else:
                logger.debug("RFID: No card (%.0fms)", elapsed_ms)
                return None, None
                
        except Exception as e:
            self.consecutive_errors += 1
            logger.error("RFID: Read error (%d/%d): %s", 
                        self.consecutive_errors, self.max_consecutive_errors, e)
            
            # Check if we need a full reset
            if self.consecutive_errors >= self.max_consecutive_errors:
                logger.warning("RFID: Too many errors, forcing reset")
                self.reset_reader()
            else:
                # Quick cleanup
                self._cleanup_after_read()
            
            return None, None
    
    def _cleanup_after_read(self):
        """Clean up reader state after read attempt"""
        try:
            if self.reader and hasattr(self.reader, 'READER'):
                self.reader.READER.MFRC522_StopCrypto1()
        except Exception:
            pass

# Initialize the RFID manager
rfid_manager = RFIDManager()

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
# 📱 I2C LCD DRIVER (SMBus) - Optimized for 10kHz I2C
# ========================================
# Note: /boot/firmware/config.txt settings:
#   dtparam=i2c_arm_baudrate=10000  (10kHz for stability)
#   dtparam=i2c_arm=on

# Timing constants for 10kHz I2C bus (slower = more reliable)
LCD_E_PULSE = 0.002    # Enable pulse width (2ms for 10kHz bus)
LCD_E_DELAY = 0.002    # Delay after enable toggle
LCD_INIT_DELAY = 0.05  # Delay during initialization

class LCD:
    """
    I2C LCD 16x2 Driver using SMBus
    Optimized for slow I2C bus (10kHz baudrate)
    """
    
    def __init__(self, address=LCD_ADDRESS):
        self.address = address
        self.bus = None
        self.initialized = False
        self._init_lcd()
    
    def _init_lcd(self):
        """Initialize LCD display with extended timing for 10kHz I2C"""
        try:
            self.bus = smbus.SMBus(1)
            time.sleep(LCD_INIT_DELAY)  # Wait for bus to stabilize
            
            # LCD initialization sequence (HD44780 protocol)
            # First, put LCD into 4-bit mode
            self._write_4bits(0x30)
            time.sleep(0.005)
            self._write_4bits(0x30)
            time.sleep(0.001)
            self._write_4bits(0x30)
            time.sleep(0.001)
            self._write_4bits(0x20)  # Set 4-bit mode
            time.sleep(0.001)
            
            # Now configure display
            self._write_byte(0x28, LCD_CMD)  # 4-bit, 2 lines, 5x8 font
            time.sleep(0.001)
            self._write_byte(0x0C, LCD_CMD)  # Display on, cursor off, blink off
            time.sleep(0.001)
            self._write_byte(0x06, LCD_CMD)  # Entry mode: increment, no shift
            time.sleep(0.001)
            self._write_byte(0x01, LCD_CMD)  # Clear display
            time.sleep(0.003)
            
            self.initialized = True
            logger.info("LCD initialized at address 0x%02X (10kHz I2C)", self.address)
        except Exception as e:
            logger.error("LCD initialization failed: %s", e)
            self.initialized = False
    
    def _write_4bits(self, data):
        """Write 4 bits to LCD (used during init)"""
        if not self.bus:
            return
        try:
            byte = (data & 0xF0) | LCD_BACKLIGHT
            self.bus.write_byte(self.address, byte)
            self._pulse_enable(byte)
        except Exception:
            pass
    
    def _pulse_enable(self, data):
        """Pulse the Enable pin with timing for 10kHz I2C"""
        try:
            time.sleep(LCD_E_DELAY)
            self.bus.write_byte(self.address, data | ENABLE)
            time.sleep(LCD_E_PULSE)
            self.bus.write_byte(self.address, data & ~ENABLE)
            time.sleep(LCD_E_DELAY)
        except Exception:
            pass
    
    def _write_byte(self, bits, mode):
        """Write byte to LCD using 4-bit mode"""
        if not self.bus:
            return
        try:
            # High nibble
            high = mode | (bits & 0xF0) | LCD_BACKLIGHT
            self.bus.write_byte(self.address, high)
            self._pulse_enable(high)
            
            # Low nibble
            low = mode | ((bits << 4) & 0xF0) | LCD_BACKLIGHT
            self.bus.write_byte(self.address, low)
            self._pulse_enable(low)
        except Exception:
            pass
    
    def clear(self):
        """Clear LCD display"""
        self._write_byte(0x01, LCD_CMD)
        time.sleep(0.003)  # Clear command needs extra time
    
    def home(self):
        """Return cursor to home position"""
        self._write_byte(0x02, LCD_CMD)
        time.sleep(0.003)
    
    def set_cursor(self, row, col):
        """Set cursor position (row 0-1, col 0-15)"""
        row_offsets = [0x00, 0x40]
        if row < 0 or row > 1:
            row = 0
        if col < 0 or col > 15:
            col = 0
        self._write_byte(LCD_LINE_1 | (row_offsets[row] + col), LCD_CMD)
    
    def backlight(self, on=True):
        """Control backlight"""
        global LCD_BACKLIGHT
        LCD_BACKLIGHT = 0x08 if on else 0x00
        if self.bus:
            try:
                self.bus.write_byte(self.address, LCD_BACKLIGHT)
            except Exception:
                pass
    
    def show(self, line1="", line2=""):
        """Display two lines on LCD"""
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
# 💾 DATABASE (Using Shared Module)
# ========================================
class Database(SharedDatabase):
    """
    Database wrapper for tamtap.py.
    Extends SharedDatabase with tamtap-specific methods.
    
    Features:
    - MongoDB primary, JSON cache/fallback
    - Auto-sync: Pull from MongoDB on connect, push pending on reconnect
    - Bidirectional sync keeps JSON always up-to-date
    """
    
    def lookup_user(self, nfc_id):
        """
        Look up user by NFC ID.
        Returns: (name, role, user_data) or (None, None, None)
        """
        user_data, role = self.get_user(nfc_id)
        
        if user_data:
            name = f"{user_data.get('first_name', '')} {user_data.get('last_name', '')}".strip()
            if not name:
                name = user_data.get("name", "Unknown")
            return name, role, user_data
        
        return None, None, None
    
    def save_attendance_record(self, nfc_id, name, role, photo_path, user_data=None):
        """Save attendance record - wrapper for save_attendance"""
        return self.save_attendance(nfc_id, name, role, photo_path, user_data)

# Initialize database
db = Database()

# ========================================
# API SERVER NOTIFICATION (Socket.IO Bridge)
# ========================================
def notify_api_server(endpoint, data):
    """
    Send HTTP POST to Express API server for Socket.IO broadcast.
    Non-blocking with short timeout - failure doesn't affect core operation.
    
    Args:
        endpoint: API path (e.g., '/api/hardware/attendance')
        data: Dictionary to send as JSON
    
    Returns:
        True if successful, False otherwise
    """
    try:
        url = f"{API_SERVER_URL}{endpoint}"
        json_data = json.dumps(data).encode('utf-8')
        
        req = urllib.request.Request(
            url,
            data=json_data,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        
        with urllib.request.urlopen(req, timeout=API_TIMEOUT) as response:
            if response.status == 200:
                logger.info("API notified: %s", endpoint)
                return True
            else:
                logger.warning("API response: %s", response.status)
                return False
                
    except urllib.error.URLError as e:
        # Server not running or network issue - not critical
        logger.debug("API server unreachable: %s", e.reason)
        return False
    except Exception as e:
        logger.debug("API notification failed: %s", e)
        return False

def notify_attendance_success(record):
    """Notify API server of successful attendance"""
    notify_api_server('/api/hardware/attendance', record)

def notify_attendance_fail(nfc_id, name, reason):
    """Notify API server of failed attendance"""
    notify_api_server('/api/hardware/fail', {
        'nfc_id': str(nfc_id),
        'name': name,
        'reason': reason
    })

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
    lcd.show("WAITING FOR", "TAMARAW...")
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
        
        # Notify API server of failure
        notify_attendance_fail(nfc_id, name, "No face detected")
        
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
        
        # Notify API server of failure
        notify_attendance_fail(nfc_id, name, "Photo capture failed")
        
        return False
    
    # Save attendance record with photo
    if db.save_attendance_record(nfc_id, name, role, photo_path, user_data):
        # === STATE: SUCCESS ===
        current_state = State.SUCCESS
        success_state(name)
        
        # Notify API server for Socket.IO broadcast
        notify_attendance_success({
            "nfc_id": str(nfc_id),
            "tamtap_id": user_data.get("tamtap_id", "") if user_data else "",
            "name": name,
            "role": role,
            "date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "time": datetime.now().strftime("%H:%M:%S"),
            "session": "AM" if datetime.now().hour < 12 else "PM",
            "photo": os.path.basename(photo_path) if photo_path else None,
            "grade": user_data.get("grade", "") if user_data else "",
            "section": user_data.get("section", "") if user_data else ""
        })
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
    """Main entry point for TAMTAP v7.0"""
    global current_state
    
    logger.info("=" * 50)
    logger.info("🚀 TAMTAP v7.0 - MongoDB + LCD SYNC STARTING")
    logger.info("=" * 50)
    
    # Database status
    if db.use_mongodb:
        logger.info("Database: MongoDB connected")
    else:
        logger.info("Database: JSON fallback mode")
    
    # Startup feedback
    lcd.show("TAMTAP v7.0", "STARTING...")
    led_on(GPIO_GREEN_LED)
    beep(count=2, duration=0.1, pause=0.1)
    time.sleep(0.5)
    led_off(GPIO_GREEN_LED)
    
    # Camera warm-up (required on cold boot)
    lcd.show("WARMING UP", "CAMERA...")
    logger.info("Camera warm-up starting (3 seconds)...")
    
    camera_ready = False
    for attempt in range(2):
        try:
            # Run camera preview for 3 seconds to initialize sensor
            result = subprocess.run(
                ['rpicam-hello', '-t', '3000'],
                capture_output=True,
                timeout=5
            )
            if result.returncode == 0:
                camera_ready = True
                logger.info("Camera warm-up complete")
                break
            else:
                logger.warning("Camera warm-up attempt %d failed", attempt + 1)
        except subprocess.TimeoutExpired:
            logger.warning("Camera warm-up timeout, attempt %d", attempt + 1)
        except Exception as e:
            logger.warning("Camera warm-up error: %s", e)
        
        if attempt < 1:
            time.sleep(1)
    
    if camera_ready:
        lcd.show("CAMERA READY", "OK")
        led_on(GPIO_GREEN_LED)
        beep(count=1, duration=0.1)
        time.sleep(0.5)
        led_off(GPIO_GREEN_LED)
    else:
        lcd.show("CAMERA WARNING", "CHECK HARDWARE")
        led_on(GPIO_RED_LED)
        beep(count=3, duration=0.2, pause=0.1)
        time.sleep(1)
        led_off(GPIO_RED_LED)
        logger.error("Camera warm-up failed - may cause issues")
    
    # Enter IDLE state
    current_state = State.IDLE
    idle_state()
    
    logger.info("System ready - waiting for RFID taps...")
    
    # Main loop with improved RFID stability
    try:
        while current_state != State.SHUTDOWN:
            try:
                # Non-blocking RFID read using RFIDManager (with timeout/reset handling)
                nfc_id, text = rfid_manager.read_card(timeout_ms=100)
                
                if nfc_id:
                    process_card(nfc_id)
                    # Return to IDLE after processing
                    idle_state()
                    
                    # Debounce delay - wait for card to be removed
                    # This prevents duplicate reads of the same card
                    time.sleep(2.0)
                    
                    # Reset reader after successful read cycle
                    rfid_manager._cleanup_after_read()
                
                time.sleep(NFC_POLL_INTERVAL)
                
            except Exception as e:
                if not shutdown_in_progress:
                    logger.error("Main loop error: %s", e)
                    # Reset reader on error
                    rfid_manager.reset_reader()
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
