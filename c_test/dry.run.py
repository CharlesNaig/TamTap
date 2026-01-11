#!/usr/bin/env python3
# tamtap_dry_run.py - FULL SYSTEM: RFID + Camera + LEDs + Buzzer
import RPi.GPIO as GPIO
import MFRC522
import cv2
import time
import signal
import sys

# GPIO Setup
GPIO.setmode(GPIO.BCM)
GPIO.setup(17, GPIO.OUT)  # Green LED (Success)
GPIO.setup(27, GPIO.OUT)  # Red LED (Error)
GPIO.setup(18, GPIO.OUT)  # Relay Buzzer

# RC522 Setup (Standard pins)
reader = MFRC522.MFRC522()

# Camera Setup
camera = cv2.VideoCapture(0)
camera.set(cv2.CAP_PROP_FRAME_WIDTH, 320)
camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 240)

print("🚀 TAMTAP DRY RUN - FULL SYSTEM")
print("Tap RFID → Camera → LED + Buzzer")
print("Ctrl+C to exit")

def cleanup():
    GPIO.cleanup()
    camera.release()
    cv2.destroyAllWindows()
    sys.exit()

signal.signal(signal.SIGINT, lambda x,y: cleanup())

try:
    while True:
        # 1. WAIT FOR RFID
        print("\n⏳ Waiting RFID tap...")
        GPIO.output(17, 0); GPIO.output(27, 0)  # LEDs off
        
        # Scan RFID
        (status, TagType) = reader.MFRC522_Request(reader.PICC_REQIDL)
        if status != reader.MI_OK:
            time.sleep(0.1)
            continue
            
        (status, uid) = reader.MFRC522_Anticoll()
        if status != reader.MI_OK:
            continue
            
        print(f"✅ RFID READ: {uid.hex()}")
        
        # 2. CAMERA CHECK (Face detect)
        print("📸 Checking face...")
        ret, frame = camera.read()
        if not ret:
            print("❌ Camera error")
            GPIO.output(27, 1); time.sleep(0.5); GPIO.output(27, 0)  # Red flash
            continue
            
        # Simple face detection
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml').detectMultiScale(gray, 1.1, 4)
        
        # 3. SUCCESS or ERROR
        if len(faces) > 0:
            print("✅ FACE DETECTED!")
            # GREEN + SUCCESS BEEP
            GPIO.output(17, 1)
            GPIO.output(18, 1); time.sleep(0.3); GPIO.output(18, 0)
            time.sleep(0.7)
            GPIO.output(17, 0)
            print("🎉 ATTENDANCE RECORDED!")
            
        else:
            print("❌ NO FACE - PROXY!")
            # RED + ERROR BEEPS
            GPIO.output(27, 1)
            for i in range(3):
                GPIO.output(18, 1); time.sleep(0.15); GPIO.output(18, 0); time.sleep(0.1)
            GPIO.output(27, 0)
            print("🔄 Try again")

        time.sleep(1)

except KeyboardInterrupt:
    cleanup()
