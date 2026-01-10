#!/usr/bin/env python3
import RPi.GPIO as GPIO
import time

GPIO.setmode(GPIO.BCM)
GPIO.setup(18, GPIO.OUT)  # Pi Pin 12 = GPIO18

print("🔔 JQC3F RELAY + BUZZER TEST")
print("Expected: LED light + CLICK + BEEP x 3")

for i in range(3):
    print(f"Test {i+1}: ON")
    GPIO.output(18, 1)  # Relay ON
    time.sleep(0.5)
    
    print(f"Test {i+1}: OFF")
    GPIO.output(18, 0)  # Relay OFF
    time.sleep(0.3)

GPIO.cleanup()
print("✅ BUZZER CONTROLLED BY RELAY!")
