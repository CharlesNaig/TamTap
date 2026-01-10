# relay_perfect_test.py
import RPi.GPIO as GPIO
import time

GPIO.setmode(GPIO.BCM)
GPIO.setup(18, GPIO.OUT)

print("🚀 TESTING YOUR PERFECT RELAY!")
for i in range(4):
    print(f"Beep {i+1}...")
    GPIO.output(18, 1)  # Relay ON: LED + CLICK + BEEP
    time.sleep(0.4)
    GPIO.output(18, 0)  # OFF
    time.sleep(0.3)

GPIO.cleanup()
print("✅ SRD-05VDC-SL-C = TAMTAP READY!")
