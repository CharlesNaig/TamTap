#!/usr/bin/env python3
# test_leds.py - Save and run FIRST
import RPi.GPIO as GPIO
import time

GPIO.setmode(GPIO.BCM)
GPIO.setup(17, GPIO.OUT)  # Green LED (Pin 11)
GPIO.setup(27, GPIO.OUT)  # Red LED (Pin 13)

print("🟢🟡 TESTING 200Ω LEDS")
print("Green = SUCCESS, Red = ERROR")

# Green test
print("Green LED (Attendance OK)...")
for i in range(3):
    GPIO.output(17, 1); time.sleep(0.5); GPIO.output(17, 0); time.sleep(0.2)

# Red test  
print("Red LED (Try again)...")
for i in range(3):
    GPIO.output(27, 1); time.sleep(0.5); GPIO.output(27, 0); time.sleep(0.2)

GPIO.cleanup()
print("✅ LEDs = BRIGHT + WORKING!")
