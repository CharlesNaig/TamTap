#!/usr/bin/env python3
# quick_c4.py - Quick 10 Second Countdown
import RPi.GPIO as GPIO
import time

GPIO.setwarnings(False)
GPIO.setmode(GPIO.BCM)
GPIO.setup(18, GPIO.OUT)

print("💣 C4 ARMED - 10 SECONDS!")
for i in range(10, 0, -1):
    print(f"   {i}...")
    GPIO.output(18, 1)
    time.sleep(0.1)
    GPIO.output(18, 0)
    time.sleep(0.9 - (0.08 * (10-i)))  # Speed up

print("💥 BOOM!")
for _ in range(5):
    GPIO.output(18, 1)
    time.sleep(0.3)
    GPIO.output(18, 0)
    time.sleep(0.1)

GPIO.cleanup()
