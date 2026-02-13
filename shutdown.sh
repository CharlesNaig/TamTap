#!/bin/bash
# ============================================================
# TAMTAP Full Shutdown Script
# Shuts down Raspberry Pi AND 52Pi UPS Plus (EP-0136)
# Use when UPS physical button is broken.
#
# UPS I2C Address: 0x17
# Register 0x18 (24): Shutdown Countdown (10-255 seconds)
# Register 0x19 (25): Back-To-AC Auto Power Up (0=off, 1=on)
#
# Usage: sudo bash shutdown.sh
# ============================================================

set -e

DEVICE_ADDR=0x17
SHUTDOWN_COUNTDOWN=30   # seconds after Pi halts before UPS cuts power

echo "============================================"
echo "  TAMTAP - Full System Shutdown"
echo "============================================"

# Must run as root
if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: This script must be run as root (sudo)."
    exit 1
fi

# Check i2c-tools availability
if ! command -v i2cset &> /dev/null; then
    echo "ERROR: i2cset not found. Install with: sudo apt install i2c-tools"
    exit 1
fi

# Verify UPS is reachable on I2C bus
if ! i2cdetect -y 1 | grep -q "17"; then
    echo "WARNING: UPS not detected on I2C bus at 0x17."
    echo "Proceeding with Pi shutdown only (UPS will NOT power off)."
    shutdown -h now
    exit 0
fi

# Read battery level for logging (registers 0x13-0x14)
BAT_LOW=$(i2cget -y 1 $DEVICE_ADDR 0x13)
BAT_HIGH=$(i2cget -y 1 $DEVICE_ADDR 0x14)
BAT_PERCENT=$(( (BAT_HIGH << 8) | BAT_LOW ))
echo "Battery level: ${BAT_PERCENT}%"

# Set UPS shutdown countdown
# After the Pi halts, UPS waits this many seconds then cuts 5V output
echo "Setting UPS shutdown countdown to ${SHUTDOWN_COUNTDOWN}s..."
i2cset -y 1 $DEVICE_ADDR 0x18 $SHUTDOWN_COUNTDOWN

# Verify the write
READBACK=$(i2cget -y 1 $DEVICE_ADDR 0x18)
echo "UPS shutdown register confirmed: ${READBACK}"

echo ""
echo "Pi shutting down now..."
echo "UPS will cut power in ${SHUTDOWN_COUNTDOWN} seconds after halt."
echo "============================================"

# Halt the Pi
shutdown -h now
