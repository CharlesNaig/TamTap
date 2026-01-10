#!/usr/bin/env python3
# test_lcd_fixed.py - Uses RPLCD (SIMPLE!)
from RPLCD.i2c import CharLCD
import time

lcd = CharLCD(i2c_addr=0x27, port=1, cols=16, rows=2)  # Try 0x3f if no display

lcd.clear()
lcd.write_string("TAMTAP LCD TEST")
time.sleep(2)
lcd.clear()
lcd.write_string("LEDs+Buzzer OK!")
time.sleep(2)
lcd.clear()
print("✅ LCD WORKING!")
