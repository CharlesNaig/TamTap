#!/usr/bin/env python3
# 🚀 TAMTAP FULL SYSTEM - LCD FIXED (2026-01-14)
# ✅ RFID + LEDs + Buzzer + JSON DB + NO adafruit deps!

import json
import time
import os
from datetime import datetime
import RPi.GPIO as GPIO
from mfrc522 import SimpleMFRC522

# ========================================
# 🔧 HARDWARE CONFIG (YOUR WIRING)
# ========================================
GREEN_LED = 17    # Pin 11
RED_LED = 27      # Pin 13
BUZZER = 18       # Pin 12

GPIO.setwarnings(False)
GPIO.setmode(GPIO.BCM)
GPIO.setup(GREEN_LED, GPIO.OUT, initial=GPIO.LOW)
GPIO.setup(RED_LED, GPIO.OUT, initial=GPIO.LOW)
GPIO.setup(BUZZER, GPIO.OUT, initial=GPIO.LOW)

reader = SimpleMFRC522()
DB_FILE = "tamtap_users.json"
PHOTOS_DIR = "attendance_photos/"

# ========================================
# 📺 SIMPLE LCD (smbus - already installed)
# ========================================
try:
    import smbus
    bus = smbus.SMBus(1)  # I2C bus 1
    LCD_ADDR = 0x27
    
    def lcd_write(cmd):
        bus.write_byte(LCD_ADDR, cmd)
    
    def lcd_clear():
        lcd_write(0x01)
        time.sleep(0.02)
    
    def lcd_show(line1="", line2=""):
        lcd_clear()
        time.sleep(0.02)
        # Simple text display (16x2 LCD)
        for i, char in enumerate(line1[:16]):
            bus.write_byte(LCD_ADDR, ord(char))
        bus.write_byte(LCD_ADDR, 0xC0)  # Line 2
        for i, char in enumerate(line2[:16]):
            bus.write_byte(LCD_ADDR, ord(char))
    
except ImportError:
    print("⚠️ smbus not found - LCD disabled")
    def lcd_show(line1="", line2=""):
        print(f"LCD: {line1} | {line2}")

# ========================================
# 🎨 LED & BUZZER
# ========================================
def led_green_on(): 
    GPIO.output(GREEN_LED, GPIO.HIGH)
    GPIO.output(RED_LED, GPIO.LOW)

def led_red_on():
    GPIO.output(RED_LED, GPIO.HIGH)
    GPIO.output(GREEN_LED, GPIO.LOW)

def led_off():
    GPIO.output(GREEN_LED, GPIO.LOW)
    GPIO.output(RED_LED, GPIO.LOW)

def buzzer_beep(duration=0.2):
    GPIO.output(BUZZER, GPIO.HIGH)
    time.sleep(duration)
    GPIO.output(BUZZER, GPIO.LOW)

# ========================================
# 💾 DATABASE
# ========================================
def load_db():
    if os.path.exists(DB_FILE):
        with open(DB_FILE, 'r') as f:
            return json.load(f)
    return {"students": {}, "teachers": {}, "attendance": []}

def save_db(db):
    with open(DB_FILE, 'w') as f:
        json.dump(db, f, indent=2)

def register_user(uid, name, role):
    db = load_db()
    db[role][str(uid)] = {"name": name, "registered": time.strftime("%Y-%m-%d")}
    save_db(db)

def is_registered(uid, db):
    return str(uid) in db["students"] or str(uid) in db["teachers"]

def get_user_info(uid, db):
    uid_str = str(uid)
    if uid_str in db["students"]:
        return db["students"][uid_str], "student"
    elif uid_str in db["teachers"]:
        return db["teachers"][uid_str], "teacher"
    return None, None

# ========================================
# 📸 PHOTO STUB
# ========================================
def capture_photo(uid):
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    os.makedirs(PHOTOS_DIR, exist_ok=True)
    print(f"📸 Photo: {PHOTOS_DIR}/{timestamp}_{uid}.jpg")
    return f"{timestamp}_{uid}.jpg"

# ========================================
# ✅ ATTENDANCE
# ========================================
def process_attendance(uid):
    db = load_db()
    
    if not is_registered(uid, db):
        lcd_show("❌ Unknown Card", "Register first!")
        led_red_on()
        buzzer_beep(0.5)
        print(f"❌ Unknown UID: {uid}")
        time.sleep(2)
        return
    
    user_info, role = get_user_info(uid, db)
    name = user_info["name"]
    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    
    # Check duplicate (last 5 entries)
    recent = any(
        entry["uid"] == uid and 
        entry["date"].startswith(today)
        for entry in db["attendance"][-5:]
    )
    
    if recent:
        lcd_show("⚠️ Already", "Marked Today!")
        led_red_on()
        buzzer_beep(0.3)
    else:
        attendance = {
            "uid": uid, "name": name, "role": role,
            "date": now.strftime("%Y-%m-%d %H:%M:%S"),
            "photo": capture_photo(uid)
        }
        db["attendance"].append(attendance)
        save_db(db)
        
        lcd_show("✅ Welcome", name[:12])
        led_green_on()
        buzzer_beep(0.1)
        print(f"✅ {role.upper()} {name} - {attendance['date']}")
    
    time.sleep(2)
    led_off()

# ========================================
# 🚀 STARTUP
# ========================================
def startup_sequence():
    print("\n" + "="*60)
    print("🚀 TAMTAP ATTENDANCE SYSTEM")
    print("="*60)
    
    lcd_show("🚀 TAMTAP", "Starting...")
    time.sleep(1)
    
    print(f"📅 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"📊 Database: {DB_FILE}")
    
    db = load_db()
    print(f"👥 {len(db['students'])} students, {len(db['teachers'])} teachers")
    
    print("\n🔧 Hardware:")
    print("   ✅ RFID: RC522")
    print("   ✅ LCD: I2C")
    print("   ✅ LEDs: GPIO 17,27")
    print("   ✅ Buzzer: GPIO 18")
    
    lcd_show("✅ READY!", "Tap card now")
    led_green_on()
    buzzer_beep(0.1)
    time.sleep(2)
    led_off()
    print("✅ System Ready!")
    print("="*60)

# ========================================
# 🔄 MAIN LOOP (NON-BLOCKING)
# ========================================
def main():
    startup_sequence()
    print("\n⏳ Waiting for RFID... (0-4cm)")
    
    try:
        while True:
            start_scan = time.time()
            while time.time() - start_scan < 0.3:
                try:
                    id, text = reader.read_no_block()
                    if id:
                        print(f"\n👆 CARD: {id}")
                        process_attendance(id)
                        break
                except:
                    pass
                time.sleep(0.05)
            
            if time.time() - start_scan > 0.3:
                print(".", end="", flush=True)
                lcd_show("TAMTAP Ready", "Tap card...")
    
    except KeyboardInterrupt:
        print("\n\n👋 Shutting down...")
    finally:
        lcd_show("", "")
        led_off()
        GPIO.cleanup()
        print("✅ Cleanup complete!")

if __name__ == "__main__":
    main()
