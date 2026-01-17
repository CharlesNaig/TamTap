#!/bin/bash
# ============================================================
# TAMTAP Startup Script
# Project: TAMTAP NFC Attendance System
# Purpose:
#  - Activate Python virtual environment (.venv)
#  - Ensure correct working directory
#  - Start the main TAMTAP application
#
# Usage:
#  - Manual: ./startup.sh
#  - Systemd: ExecStart=/home/charles/TamTap/startup.sh
#
# Author: Charles Giann Marcelo et al.
# ============================================================

# Exit immediately on error
set -e

# ============================================================
# ABSOLUTE PATHS ONLY (systemd-safe, no ~ or relative paths)
# ============================================================
PROJECT_DIR="/home/charles/TamTap"
VENV_PATH="$PROJECT_DIR/.venv"
VENV_PYTHON="$VENV_PATH/bin/python"
MAIN_FILE="$PROJECT_DIR/hardware/tamtap.py"

# ============================================================
# Step 1: Change to project directory
# ============================================================
if [ ! -d "$PROJECT_DIR" ]; then
  echo "[ERROR] Project directory not found: $PROJECT_DIR"
  exit 1
fi
cd "$PROJECT_DIR"
echo "[INFO] Working directory: $PROJECT_DIR"

# ============================================================
# Step 2: Verify virtual environment exists
# ============================================================
if [ ! -d "$VENV_PATH" ]; then
  echo "[ERROR] Virtual environment not found at: $VENV_PATH"
  echo "[ERROR] Run: python3 -m venv .venv && source .venv/bin/activate && pip install -r hardware/requirements.txt"
  exit 1
fi

# ============================================================
# Step 3: Verify venv Python executable exists
# ============================================================
if [ ! -f "$VENV_PYTHON" ]; then
  echo "[ERROR] Python executable not found in venv: $VENV_PYTHON"
  exit 1
fi
echo "[INFO] Using Python: $VENV_PYTHON"

# ============================================================
# Step 4: Activate virtual environment
# ============================================================
# shellcheck disable=SC1091
source "$VENV_PATH/bin/activate"
echo "[INFO] Virtual environment activated"

# ============================================================
# Step 5: Verify main application file exists
# ============================================================
if [ ! -f "$MAIN_FILE" ]; then
  echo "[ERROR] Main file not found: $MAIN_FILE"
  exit 1
fi
echo "[INFO] Main file verified: $MAIN_FILE"

# ============================================================
# Step 6: Start TAMTAP application
# ============================================================
echo "[INFO] Starting TAMTAP application..."
"$VENV_PYTHON" "$MAIN_FILE"

# Note: Script will remain running while tamtap.py runs
# systemd handles restart on exit
