#!/usr/bin/env python3
# lcd_test.py - Test I2C LCD Display
import time
try:
    from RPLCD.i2c import CharLCD
except ImportError:
    print("📦 Installing RPLCD library...")
    import subprocess
    subprocess.run(['pip', 'install', 'RPLCD'])
    from RPLCD.i2c import CharLCD

# 🔧 Common I2C addresses: 0x27 or 0x3F
# Try 0x27 first (most common)
LCD_ADDRESS = 0x27

print("🖥️ I2C LCD TEST")
print("=" * 50)

try:
    # Initialize LCD (16x2 standard)
    lcd = CharLCD(i2c_expander='PCF8574', address=LCD_ADDRESS, port=1,
                  cols=16, rows=2, dotsize=8)
    
    print(f"✅ LCD found at address {hex(LCD_ADDRESS)}")
    
    # Test 1: Clear screen
    lcd.clear()
    print("✅ Test 1: Screen cleared")
    time.sleep(1)
    
    # Test 2: Display text
    lcd.write_string('TAMTAP System')
    print("✅ Test 2: Text displayed (Line 1)")
    time.sleep(2)
    
    # Test 3: Move to line 2
    lcd.cursor_pos = (1, 0)  # Row 1, Col 0
    lcd.write_string('LCD Working!')
    print("✅ Test 3: Text on Line 2")
    time.sleep(2)
    
    # Test 4: Scrolling text
    lcd.clear()
    messages = [
        ('Hello TAMTAP!', 'Ready to log'),
        ('Student Ready', 'Tap your card'),
        ('Face Detection', 'System Active')
    ]
    
    print("✅ Test 4: Scrolling messages...")
    for line1, line2 in messages:
        lcd.clear()
        lcd.write_string(line1)
        lcd.cursor_pos = (1, 0)
        lcd.write_string(line2)
        time.sleep(2)
    
    # Test 5: Backlight toggle
    print("✅ Test 5: Backlight test...")
    for i in range(3):
        lcd.backlight_enabled = False
        time.sleep(0.5)
        lcd.backlight_enabled = True
        time.sleep(0.5)
    
    # Final message
    lcd.clear()
    lcd.write_string('LCD Test Pass!')
    lcd.cursor_pos = (1, 0)
    lcd.write_string('TAMTAP Ready!')
    
    print("\n🎉 ALL TESTS PASSED!")
    print("=" * 50)
    
except OSError as e:
    print(f"\n❌ LCD NOT FOUND at {hex(LCD_ADDRESS)}")
    print("\n🔧 TROUBLESHOOTING:")
    print("1. Check I2C address:")
    print("   Run: sudo i2cdetect -y 1")
    print("   Look for: 27 or 3f")
    print("\n2. If you see different address (e.g., 0x3F):")
    print("   Edit lcd_test.py → LCD_ADDRESS = 0x3F")
    print("\n3. Check wiring:")
    print("   LCD SDA → GPIO2 (Pin 3)")
    print("   LCD SCL → GPIO3 (Pin 5)")
    print("   LCD VCC → 5V (Pin 2/4)")
    print("   LCD GND → GND (Pin 6)")
    
except Exception as e:
    print(f"❌ Error: {e}")
    
finally:
    print("\n👋 Test complete")
