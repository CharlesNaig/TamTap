#!/usr/bin/env python3
from mfrc522 import SimpleMFRC522
import RPi.GPIO as GPIO
GPIO.setwarnings(False)

reader = SimpleMFRC522()  # ← SimpleMFRC522 OBJECT

try:
    print("🧪 Tap card NOW!")
    id, text = reader.read()  # ← CALL .read() on SimpleMFRC522
    print(f"✅ CARD OK! ID: {id}")
except KeyboardInterrupt:
    pass
finally:
    GPIO.cleanup()
    print("\n👋 Goodbye!")