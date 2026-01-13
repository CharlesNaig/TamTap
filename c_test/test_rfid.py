#!/usr/bin/env python3
from csv import reader
import RPi.GPIO as GPIO
from mfrc522 import SimpleMFRC522
GPIO.setwarnings(False)

reade = SimpleMFRC522()
print("🔖 RFID TEST")

try:
    id, text = reader.read()
    print(f"✅ Card detected! ID: {id}, Text: '{text.strip()}'")
except Exception as e:
    print(f"❌ Error reading RFID: {e}")
finally:
    GPIO.cleanup()