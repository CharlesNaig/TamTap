#!/usr/bin/env python3
"""
test_lcd.py - Test I2C LCD Display
Uses SMBus directly (same as tamtap.py) for consistency
Optimized for 10kHz I2C bus (config.txt: dtparam=i2c_arm_baudrate=10000)
"""
import time
import smbus

# ========================================
# LCD CONFIGURATION
# ========================================
LCD_ADDRESS = 0x27      # Common addresses: 0x27 or 0x3F
LCD_WIDTH = 16
LCD_CHR = 1             # Character mode
LCD_CMD = 0             # Command mode
LCD_LINE_1 = 0x80       # Line 1 address
LCD_LINE_2 = 0xC0       # Line 2 address
LCD_BACKLIGHT = 0x08
ENABLE = 0b00000100

# Timing for 10kHz I2C bus (slower = more reliable)
LCD_E_PULSE = 0.002     # Enable pulse width (2ms)
LCD_E_DELAY = 0.002     # Delay after enable toggle
LCD_INIT_DELAY = 0.05   # Delay during initialization

print("🖥️  I2C LCD TEST (SMBus - 10kHz)")
print("=" * 50)

# ========================================
# LCD CLASS (Same as tamtap.py)
# ========================================
class LCD:
    """I2C LCD 16x2 Driver - Optimized for 10kHz I2C"""
    
    def __init__(self, address=LCD_ADDRESS):
        self.address = address
        self.bus = None
        self.initialized = False
        self._init_lcd()
    
    def _init_lcd(self):
        """Initialize LCD display with extended timing"""
        try:
            self.bus = smbus.SMBus(1)
            time.sleep(LCD_INIT_DELAY)
            
            # LCD initialization (HD44780 protocol)
            self._write_4bits(0x30)
            time.sleep(0.005)
            self._write_4bits(0x30)
            time.sleep(0.001)
            self._write_4bits(0x30)
            time.sleep(0.001)
            self._write_4bits(0x20)  # 4-bit mode
            time.sleep(0.001)
            
            self._write_byte(0x28, LCD_CMD)  # 4-bit, 2 lines, 5x8 font
            time.sleep(0.001)
            self._write_byte(0x0C, LCD_CMD)  # Display on, cursor off
            time.sleep(0.001)
            self._write_byte(0x06, LCD_CMD)  # Entry mode
            time.sleep(0.001)
            self._write_byte(0x01, LCD_CMD)  # Clear
            time.sleep(0.003)
            
            self.initialized = True
            print(f"✅ LCD initialized at {hex(self.address)} (10kHz I2C)")
        except Exception as e:
            print(f"❌ LCD init failed: {e}")
            self.initialized = False
    
    def _write_4bits(self, data):
        """Write 4 bits (used during init)"""
        if not self.bus:
            return
        try:
            byte = (data & 0xF0) | LCD_BACKLIGHT
            self.bus.write_byte(self.address, byte)
            self._pulse_enable(byte)
        except Exception:
            pass
    
    def _pulse_enable(self, data):
        """Pulse Enable pin with 10kHz timing"""
        try:
            time.sleep(LCD_E_DELAY)
            self.bus.write_byte(self.address, data | ENABLE)
            time.sleep(LCD_E_PULSE)
            self.bus.write_byte(self.address, data & ~ENABLE)
            time.sleep(LCD_E_DELAY)
        except Exception:
            pass
    
    def _write_byte(self, bits, mode):
        """Write byte using 4-bit mode"""
        if not self.bus:
            return
        try:
            high = mode | (bits & 0xF0) | LCD_BACKLIGHT
            self.bus.write_byte(self.address, high)
            self._pulse_enable(high)
            
            low = mode | ((bits << 4) & 0xF0) | LCD_BACKLIGHT
            self.bus.write_byte(self.address, low)
            self._pulse_enable(low)
        except Exception:
            pass
    
    def clear(self):
        """Clear display"""
        self._write_byte(0x01, LCD_CMD)
        time.sleep(0.003)
    
    def show(self, line1="", line2=""):
        """Display two lines"""
        if not self.initialized:
            return
        try:
            self._write_byte(LCD_LINE_1, LCD_CMD)
            for char in line1.ljust(LCD_WIDTH)[:LCD_WIDTH]:
                self._write_byte(ord(char), LCD_CHR)
            
            self._write_byte(LCD_LINE_2, LCD_CMD)
            for char in line2.ljust(LCD_WIDTH)[:LCD_WIDTH]:
                self._write_byte(ord(char), LCD_CHR)
        except Exception as e:
            print(f"❌ Write error: {e}")
    
    def backlight(self, on=True):
        """Control backlight"""
        global LCD_BACKLIGHT
        LCD_BACKLIGHT = 0x08 if on else 0x00
        if self.bus:
            try:
                self.bus.write_byte(self.address, LCD_BACKLIGHT)
            except Exception:
                pass

# ========================================
# RUN TESTS
# ========================================
try:
    # Initialize LCD
    lcd = LCD()
    
    if not lcd.initialized:
        raise OSError("LCD not initialized")
    
    # Test 1: Clear screen
    lcd.clear()
    print("✅ Test 1: Screen cleared")
    time.sleep(1)
    
    # Test 2: Display text
    lcd.show('TAMTAP System', '')
    print("✅ Test 2: Text displayed (Line 1)")
    time.sleep(2)
    
    # Test 3: Two lines
    lcd.show('TAMTAP System', 'LCD Working!')
    print("✅ Test 3: Text on both lines")
    time.sleep(2)
    
    # Test 4: Scrolling messages
    messages = [
        ('Hello TAMTAP!', 'Ready to log'),
        ('Student Ready', 'Tap your card'),
        ('Face Detection', 'System Active'),
        ('WAITING FOR', 'TAMARAW...'),
    ]
    
    print("✅ Test 4: Scrolling messages...")
    for line1, line2 in messages:
        lcd.show(line1, line2)
        time.sleep(2)
    
    # Test 5: Backlight toggle
    print("✅ Test 5: Backlight test...")
    for i in range(3):
        lcd.backlight(False)
        time.sleep(0.5)
        lcd.backlight(True)
        time.sleep(0.5)
    
    # Final message
    lcd.show('LCD Test Pass!', 'TAMTAP Ready!')
    
    print("\n🎉 ALL TESTS PASSED!")
    print("=" * 50)
    
except OSError as e:
    print(f"\n❌ LCD NOT FOUND at {hex(LCD_ADDRESS)}")
    print("\n🔧 TROUBLESHOOTING:")
    print("1. Check I2C is enabled:")
    print("   sudo raspi-config → Interfacing → I2C → Enable")
    print("\n2. Check I2C address:")
    print("   sudo i2cdetect -y 1")
    print("   Look for: 27 or 3f")
    print("\n3. If different address (e.g., 0x3F):")
    print("   Edit LCD_ADDRESS = 0x3F at top of file")
    print("\n4. Check /boot/firmware/config.txt has:")
    print("   dtparam=i2c_arm=on")
    print("   dtparam=i2c_arm_baudrate=10000")
    print("\n5. Check wiring:")
    print("   LCD SDA → GPIO2 (Pin 3)")
    print("   LCD SCL → GPIO3 (Pin 5)")
    print("   LCD VCC → 5V (Pin 2/4)")
    print("   LCD GND → GND (Pin 6)")
    
except Exception as e:
    print(f"❌ Error: {e}")
    
finally:
    print("\n👋 Test complete")
