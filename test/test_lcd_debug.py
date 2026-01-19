#!/usr/bin/env python3
"""
test_lcd_debug.py - LCD Troubleshooting & Diagnostics
Run this to identify LCD issues step by step
"""
import time
import sys

print("=" * 60)
print("🔍 TAMTAP LCD DIAGNOSTIC TOOL")
print("=" * 60)

# ========================================
# STEP 1: Check I2C Bus
# ========================================
print("\n[STEP 1] Checking I2C bus availability...")

try:
    import smbus
    bus = smbus.SMBus(1)
    print("✅ SMBus initialized on I2C-1")
except Exception as e:
    print(f"❌ SMBus failed: {e}")
    print("\n🔧 FIX: Enable I2C in raspi-config")
    print("   sudo raspi-config → Interface Options → I2C → Enable")
    sys.exit(1)

# ========================================
# STEP 2: Scan for I2C Devices
# ========================================
print("\n[STEP 2] Scanning I2C bus for devices...")

found_devices = []
for addr in range(0x03, 0x78):
    try:
        bus.read_byte(addr)
        found_devices.append(hex(addr))
    except:
        pass

if found_devices:
    print(f"✅ Found devices at: {', '.join(found_devices)}")
    
    # Check for LCD addresses
    if '0x27' in found_devices:
        LCD_ADDRESS = 0x27
        print("   → LCD likely at 0x27 (PCF8574)")
    elif '0x3f' in found_devices:
        LCD_ADDRESS = 0x3F
        print("   → LCD likely at 0x3F (PCF8574A)")
    else:
        print("   ⚠️  No standard LCD address found (0x27 or 0x3F)")
        LCD_ADDRESS = int(found_devices[0], 16)
        print(f"   → Will try first found: {found_devices[0]}")
else:
    print("❌ No I2C devices found!")
    print("\n🔧 CHECK WIRING:")
    print("   SDA → GPIO2 (Pin 3)")
    print("   SCL → GPIO3 (Pin 5)")
    print("   VCC → 5V (Pin 2 or 4)")
    print("   GND → Ground (Pin 6)")
    print("\n🔧 CHECK CONNECTIONS:")
    print("   - Are jumper wires firmly connected?")
    print("   - Is the I2C backpack soldered properly?")
    sys.exit(1)

# ========================================
# STEP 3: Check I2C Speed
# ========================================
print("\n[STEP 3] Checking I2C bus speed...")

try:
    with open('/sys/class/i2c-adapter/i2c-1/of_node/clock-frequency', 'r') as f:
        freq = int(f.read().strip())
        print(f"   Current I2C speed: {freq} Hz ({freq//1000} kHz)")
        if freq > 50000:
            print("   ⚠️  Speed may be too fast for noisy lines")
            print("   💡 Recommended: 10000 Hz (10 kHz)")
except:
    print("   ℹ️  Could not read I2C frequency (checking config...)")
    try:
        with open('/boot/firmware/config.txt', 'r') as f:
            config = f.read()
            if 'i2c_arm_baudrate' in config:
                for line in config.split('\n'):
                    if 'i2c_arm_baudrate' in line and not line.strip().startswith('#'):
                        print(f"   Found: {line.strip()}")
            else:
                print("   ⚠️  No custom baudrate set (default 100kHz)")
    except:
        pass

# ========================================
# STEP 4: Test Raw I2C Communication
# ========================================
print("\n[STEP 4] Testing raw I2C communication...")

BACKLIGHT = 0x08
errors = 0

for i in range(5):
    try:
        # Toggle backlight as simple test
        bus.write_byte(LCD_ADDRESS, BACKLIGHT)
        time.sleep(0.1)
        bus.write_byte(LCD_ADDRESS, 0x00)
        time.sleep(0.1)
    except Exception as e:
        errors += 1
        print(f"   ❌ Write error #{i+1}: {e}")

if errors == 0:
    print("✅ Raw I2C writes successful (backlight toggled)")
else:
    print(f"❌ {errors}/5 writes failed - unstable connection")
    print("\n🔧 POSSIBLE CAUSES:")
    print("   - Loose wires (wiggle test them)")
    print("   - Long cables (keep under 30cm)")
    print("   - Electrical noise (add 10µF capacitor on VCC)")

# ========================================
# STEP 5: LCD Initialization with SLOW timing
# ========================================
print("\n[STEP 5] Testing LCD with EXTRA SLOW timing...")

# Ultra-conservative timing for debugging
E_PULSE = 0.005    # 5ms enable pulse (very slow)
E_DELAY = 0.005    # 5ms delay
INIT_DELAY = 0.1   # 100ms init delay

LCD_CMD = 0
LCD_CHR = 1
ENABLE = 0b00000100
LCD_LINE_1 = 0x80
LCD_LINE_2 = 0xC0

def pulse_enable_slow(data):
    """Ultra-slow enable pulse for debugging"""
    time.sleep(E_DELAY)
    bus.write_byte(LCD_ADDRESS, data | ENABLE)
    time.sleep(E_PULSE)
    bus.write_byte(LCD_ADDRESS, data & ~ENABLE)
    time.sleep(E_DELAY)

def write_4bits_slow(data):
    """Write 4 bits with slow timing"""
    byte = (data & 0xF0) | BACKLIGHT
    bus.write_byte(LCD_ADDRESS, byte)
    pulse_enable_slow(byte)

def write_byte_slow(bits, mode):
    """Write byte with slow timing"""
    high = mode | (bits & 0xF0) | BACKLIGHT
    bus.write_byte(LCD_ADDRESS, high)
    pulse_enable_slow(high)
    
    low = mode | ((bits << 4) & 0xF0) | BACKLIGHT
    bus.write_byte(LCD_ADDRESS, low)
    pulse_enable_slow(low)

try:
    print("   Initializing LCD (slow mode)...")
    time.sleep(INIT_DELAY)
    
    # HD44780 init sequence
    write_4bits_slow(0x30)
    time.sleep(0.005)
    write_4bits_slow(0x30)
    time.sleep(0.005)
    write_4bits_slow(0x30)
    time.sleep(0.005)
    write_4bits_slow(0x20)  # 4-bit mode
    time.sleep(0.005)
    
    write_byte_slow(0x28, LCD_CMD)  # 4-bit, 2 lines
    time.sleep(0.002)
    write_byte_slow(0x0C, LCD_CMD)  # Display on
    time.sleep(0.002)
    write_byte_slow(0x01, LCD_CMD)  # Clear
    time.sleep(0.005)
    write_byte_slow(0x06, LCD_CMD)  # Entry mode
    time.sleep(0.002)
    
    print("✅ LCD initialized successfully")
    
except Exception as e:
    print(f"❌ LCD init failed: {e}")
    sys.exit(1)

# ========================================
# STEP 6: Display Test Pattern
# ========================================
print("\n[STEP 6] Displaying test pattern...")

def show_slow(line1, line2):
    """Display with slow timing"""
    write_byte_slow(LCD_LINE_1, LCD_CMD)
    for char in line1.ljust(16)[:16]:
        write_byte_slow(ord(char), LCD_CHR)
    
    write_byte_slow(LCD_LINE_2, LCD_CMD)
    for char in line2.ljust(16)[:16]:
        write_byte_slow(ord(char), LCD_CHR)

try:
    # Clear first
    write_byte_slow(0x01, LCD_CMD)
    time.sleep(0.005)
    
    # Test 1: Simple text
    print("   Test A: Simple text...")
    show_slow("ABCDEFGHIJKLMNOP", "1234567890123456")
    time.sleep(3)
    
    # Test 2: TAMTAP message
    print("   Test B: TAMTAP message...")
    show_slow("TAMTAP SYSTEM", "LCD TEST OK")
    time.sleep(3)
    
    # Test 3: Rapid update (stress test)
    print("   Test C: Rapid updates (watch for glitches)...")
    for i in range(5):
        show_slow(f"Counter: {i}", f"Update #{i+1}")
        time.sleep(0.5)
    
    print("✅ Display tests complete")
    
except Exception as e:
    print(f"❌ Display test failed: {e}")

# ========================================
# RESULTS & RECOMMENDATIONS
# ========================================
print("\n" + "=" * 60)
print("📋 DIAGNOSTIC RESULTS")
print("=" * 60)

print(f"""
LCD Address: {hex(LCD_ADDRESS)}
I2C Devices: {', '.join(found_devices)}
I2C Errors:  {errors}/5 writes

🔧 IF LCD STILL SHOWS RANDOM CHARACTERS:

1. ADJUST CONTRAST:
   - Find the blue potentiometer on LCD backpack
   - Turn it slowly with small screwdriver
   - Look for text to become visible

2. CHECK POWER:
   - Use 5V pin (not 3.3V) for LCD VCC
   - Try different 5V pin (Pin 2 or Pin 4)
   - Add 10µF capacitor between VCC and GND

3. CHECK WIRING:
   - Reseat all jumper wires
   - Use shorter wires (under 20cm)
   - Check for bent/broken pins

4. SLOW DOWN I2C:
   Edit /boot/firmware/config.txt:
   
   dtparam=i2c_arm=on
   dtparam=i2c_arm_baudrate=10000
   
   Then: sudo reboot

5. IF NOTHING WORKS:
   - Try a different LCD module
   - The I2C backpack may be faulty
""")

print("=" * 60)
print("👋 Diagnostic complete")
