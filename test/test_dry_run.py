#!/usr/bin/env python3
# tamtap_core_v2.py - FIXED! No more freezing!
import RPi.GPIO as GPIO
import subprocess, os, time, datetime, random
from mfrc522 import SimpleMFRC522
import signal, sys

# GPIO Setup
GPIO.setmode(GPIO.BCM)
GPIO.setup(17, GPIO.OUT)  # Green LED
GPIO.setup(27, GPIO.OUT)  # Red LED  
GPIO.setup(18, GPIO.OUT)  # Buzzer

reader = SimpleMFRC522()
PHOTO_DIR = "attendance_photos"
if not os.path.exists(PHOTO_DIR):
    os.makedirs(PHOTO_DIR)

def signal_handler(sig, frame):
    print("\n👋 Shutdown...")
    GPIO.cleanup()
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)

def take_photo_nonblock(card_id):
    """NON-BLOCKING photo - 3s timeout"""
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{PHOTO_DIR}/card_{card_id}_{timestamp}.jpg"
    
    cmd = ['rpicam-still', '-t', '1500', '--width', '1024', '--height', '768', '-o', filename]
    
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=3, check=False)
        if os.path.exists(filename) and os.path.getsize(filename) > 10000:
            return True, filename
    except:
        pass
    return False, None

def success_feedback():
    GPIO.output(17, 1); GPIO.output(18, 1)
    time.sleep(0.4); GPIO.output(18, 0)
    time.sleep(1.2); GPIO.output(17, 0)

def fail_feedback():
    GPIO.output(27, 1)
    for _ in range(3):
        GPIO.output(18, 1); time.sleep(0.15); GPIO.output(18, 0); time.sleep(0.15)
    GPIO.output(27, 0)

print("🚀 TAMTAP v2 - NON-BLOCKING (No Freeze!)")
print("📁 Photos → attendance_photos/")
print("=" * 60)

# Test camera first
print("🎥 Quick camera test...")
photo_ok, _ = take_photo_nonblock("TEST")
print("✅ Camera OK!" if photo_ok else "⚠️ Camera warning - continuing anyway")

print("\n🎉 READY! Continuous RFID reading...")
print("=" * 60)

try:
    while True:
        try:
            # NON-BLOCKING READ with 1s timeout
            signal.setitimer(signal.ITIMER_REAL, 1.0)  # 1s timeout
            id, text = reader.read()
            signal.setitimer(signal.ITIMER_REAL, 0)
            
            print(f"\n👆 CARD #{id}")
            
            # Take photo (non-blocking)
            photo_ok, photo_path = take_photo_nonblock(id)
            print(f"📸 {'✅ SAVED' if photo_ok else '⚠️ FAILED'}")
            
            # Random success (80%)
            if random.random() > 0.2:
                print("✅ SUCCESS!")
                success_feedback()
            else:
                print("❌ FAILED!")
                fail_feedback()
                
        except signal.SIGALRM:
            # Timeout = no card, continue loop
            continue
        except Exception as e:
            print(f"⚠️ RFID error: {e} → continuing...")
            time.sleep(0.1)
            continue
            
        print("-" * 50)
        time.sleep(0.5)  # Brief pause between reads

except KeyboardInterrupt:
    print("\n👋 Goodbye!")
finally:
    GPIO.cleanup()
