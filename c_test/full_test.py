#!/usr/bin/env python3
# tamtap_complete.py - ALL COMPONENTS INTEGRATED
# RC522 RFID + I2C LCD + Camera + Face Detection + LEDs + Buzzer

import RPi.GPIO as GPIO
import subprocess
import os
import time
import datetime
import glob
import json
import cv2
from mfrc522 import SimpleMFRC522
from RPLCD.i2c import CharLCD

# ========== GPIO SETUP ==========
GPIO.setwarnings(False)
GPIO.setmode(GPIO.BCM)

# Pin assignments
GREEN_LED = 17  # Success
RED_LED = 27    # Fail
BUZZER = 18     # Audio feedback

GPIO.setup(GREEN_LED, GPIO.OUT)
GPIO.setup(RED_LED, GPIO.OUT)
GPIO.setup(BUZZER, GPIO.OUT)
GPIO.output(GREEN_LED, 0)
GPIO.output(RED_LED, 0)
GPIO.output(BUZZER, 0)

# ========== HARDWARE INIT ==========
reader = SimpleMFRC522()

# LCD Setup (change 0x27 to 0x3F if needed)
try:
    lcd = CharLCD(i2c_expander='PCF8574', address=0x27, port=1,
                  cols=16, rows=2, dotsize=8)
    lcd.clear()
    LCD_ENABLED = True
except:
    print("⚠️ LCD not found - continuing without LCD")
    LCD_ENABLED = False

# Face detection
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

# ========== DIRECTORIES & FILES ==========
PHOTO_DIR = "attendance_photos"
DB_FILE = "tamtap_users.json"
os.makedirs(PHOTO_DIR, exist_ok=True)

# ========== DATABASE FUNCTIONS ==========
def load_database():
    """Load user database"""
    if os.path.exists(DB_FILE):
        with open(DB_FILE, 'r') as f:
            return json.load(f)
    return {"students": {}, "teachers": {}}

def verify_card(card_uid):
    """Check if card is registered"""
    db = load_database()
    card_key = str(card_uid)
    
    if card_key in db["students"]:
        return True, db["students"][card_key]
    elif card_key in db["teachers"]:
        return True, db["teachers"][card_key]
    return False, None

def log_attendance(user_data, has_face):
    """Save attendance record"""
    log_file = f"attendance_{datetime.datetime.now().strftime('%Y%m')}.json"
    log = []
    if os.path.exists(log_file):
        with open(log_file, 'r') as f:
            log = json.load(f)
    
    log.append({
        "timestamp": datetime.datetime.now().isoformat(),
        "user_id": user_data["id"],
        "name": user_data["name"],
        "type": user_data["type"],
        "face_detected": has_face,
        "status": "SUCCESS" if has_face else "PROXY_ATTEMPT"
    })
    
    with open(log_file, 'w') as f:
        json.dump(log, f, indent=2)

# ========== CAMERA & FACE DETECTION ==========
def take_photo(card_id):
    """Capture photo from Pi camera"""
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{PHOTO_DIR}/card_{card_id}_{timestamp}.jpg"
    cmd = ['rpicam-still', '-t', '1000', '--width', '1024', '--height', '768', 
           '--nopreview', '-o', filename]
    try:
        subprocess.run(cmd, timeout=3, capture_output=True)
        if os.path.exists(filename) and os.path.getsize(filename) > 5000:
            return filename
    except Exception as e:
        print(f"📸 Camera error: {e}")
    return None

def detect_face(filename):
    """Analyze photo for face detection"""
    if not filename or not os.path.exists(filename):
        return False, 0
    
    try:
        img = cv2.imread(filename)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Detect faces
        faces = face_cascade.detectMultiScale(
            gray, 
            scaleFactor=1.1, 
            minNeighbors=5, 
            minSize=(30, 30)
        )
        
        face_count = len(faces)
        
        # Draw rectangles (for debugging)
        if face_count > 0:
            for (x, y, w, h) in faces:
                cv2.rectangle(img, (x, y), (x+w, y+h), (0, 255, 0), 2)
            analyzed_file = filename.replace('.jpg', '_analyzed.jpg')
            cv2.imwrite(analyzed_file, img)
        
        return face_count >= 1, face_count
    except Exception as e:
        print(f"👤 Face detection error: {e}")
        return False, 0

# ========== LCD DISPLAY FUNCTIONS ==========
def lcd_show(line1, line2=""):
    """Display message on LCD"""
    if LCD_ENABLED:
        try:
            lcd.clear()
            lcd.write_string(line1[:16])
            if line2:
                lcd.cursor_pos = (1, 0)
                lcd.write_string(line2[:16])
        except:
            pass

# ========== FEEDBACK FUNCTIONS ==========
def success_feedback():
    """Green LED + short beep"""
    GPIO.output(GREEN_LED, 1)
    GPIO.output(BUZZER, 1)
    time.sleep(0.3)
    GPIO.output(BUZZER, 0)
    time.sleep(1)
    GPIO.output(GREEN_LED, 0)

def fail_feedback():
    """Red LED + triple beep"""
    GPIO.output(RED_LED, 1)
    for _ in range(3):
        GPIO.output(BUZZER, 1)
        time.sleep(0.15)
        GPIO.output(BUZZER, 0)
        time.sleep(0.15)
    time.sleep(0.5)
    GPIO.output(RED_LED, 0)

def error_feedback():
    """Quick error beep"""
    for _ in range(2):
        GPIO.output(BUZZER, 1)
        time.sleep(0.1)
        GPIO.output(BUZZER, 0)
        time.sleep(0.1)

# ========== MAIN ATTENDANCE FLOW ==========
def process_attendance(card_uid):
    """Complete attendance verification process"""
    
    # Step 1: Verify card registration
    lcd_show("Checking card...", "Please wait")
    is_registered, user_data = verify_card(card_uid)
    
    if not is_registered:
        print(f"❌ UNREGISTERED CARD: {card_uid}")
        lcd_show("Access Denied!", "Unregistered")
        fail_feedback()
        time.sleep(2)
        return
    
    # Step 2: Display user info
    print(f"✅ {user_data['name']} ({user_data['type'].upper()})")
    lcd_show(user_data['name'][:16], "Taking photo...")
    
    # Step 3: Take photo
    filename = take_photo(card_uid)
    
    if not filename:
        print("📸 Camera failed!")
        lcd_show("Camera Error!", "Try again")
        error_feedback()
        time.sleep(2)
        return
    
    print(f"📸 Photo saved: {filename}")
    
    # Step 4: Face detection
    lcd_show(user_data['name'][:16], "Analyzing face...")
    has_face, face_count = detect_face(filename)
    
    print(f"👤 {face_count} face(s) detected")
    
    # Step 5: Final decision
    if has_face:
        print(f"✅ ATTENDANCE LOGGED!")
        log_attendance(user_data, True)
        lcd_show("Success!", f"{user_data['name'][:16]}")
        success_feedback()
    else:
        print(f"❌ NO FACE DETECTED - PROXY ATTEMPT!")
        log_attendance(user_data, False)
        lcd_show("No Face!", "Show your face")
        fail_feedback()
    
    time.sleep(2)

# ========== STARTUP ==========
def startup_sequence():
    """System initialization"""
    print("\n" + "=" * 60)
    print("🚀 TAMTAP ATTENDANCE SYSTEM")
    print("=" * 60)
    print(f"📅 {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"📊 Database: {DB_FILE}")
    print(f"📸 Photos: {PHOTO_DIR}/")
    
    db = load_database()
    student_count = len(db.get("students", {}))
    teacher_count = len(db.get("teachers", {}))
    print(f"👥 Registered: {student_count} students, {teacher_count} teachers")
    
    # LCD welcome
    lcd_show("TAMTAP System", "Initializing...")
    time.sleep(2)
    
    # Test hardware
    print("\n🔧 Hardware Check:")
    print(f"   ✅ RFID Reader: RC522")
    print(f"   {'✅' if LCD_ENABLED else '⚠️'} LCD Display: I2C")
    print(f"   ✅ Camera: Pi Camera")
    print(f"   ✅ LEDs: GPIO {GREEN_LED}, {RED_LED}")
    print(f"   ✅ Buzzer: GPIO {BUZZER}")
    
    # LED test
    GPIO.output(GREEN_LED, 1)
    time.sleep(0.2)
    GPIO.output(GREEN_LED, 0)
    GPIO.output(RED_LED, 1)
    time.sleep(0.2)
    GPIO.output(RED_LED, 0)
    GPIO.output(BUZZER, 1)
    time.sleep(0.1)
    GPIO.output(BUZZER, 0)
    
    print("\n✅ System Ready!")
    print("=" * 60)
    lcd_show("Ready!", "Tap your card")

# ========== MAIN LOOP ==========
def main():
    """Main attendance loop"""
    startup_sequence()
    
    try:
        while True:
            print("\n⏳ Waiting for RFID card...")
            lcd_show("TAMTAP Ready", "Tap your card")
            
            # Read RFID
            card_uid, card_data = reader.read()
            print(f"\n👆 CARD DETECTED: #{card_uid}")
            
            # Process attendance
            process_attendance(card_uid)
            
            # Brief pause
            time.sleep(1)
            
    except KeyboardInterrupt:
        print("\n\n👋 Shutting down TAMTAP...")
        lcd_show("System", "Shutting down")
        time.sleep(1)
        
    finally:
        # Cleanup
        lcd_show("", "")
        GPIO.cleanup()
        print("✅ GPIO cleanup complete")

# ========== RUN ==========
if __name__ == "__main__":
    main()
