#!/bin/bash
# ============================================================
# TAMTAP Startup Script
# Project: TAMTAP NFC Attendance System
# Purpose:
#  - Activate Python virtual environment (.venv)
#  - Ensure correct working directory
#  - Start the main TAMTAP application
#
# This script is designed for:
#  - Manual execution
#  - systemd auto-start usage
#
# Author: Charles Giann Marcelo et al.
# ============================================================

# Exit immediately if a command fails
set -e

# Define project directory
PROJECT_DIR="/home/charles/TamTap"

# Define virtual environment path
VENV_PATH="$PROJECT_DIR/.venv"

# Define main Python entry file
MAIN_FILE="$PROJECT_DIR/main.py"

# ------------------------------------------------------------
# Step 1: Change to project directory
# ------------------------------------------------------------
cd "$PROJECT_DIR" || {
  echo "[ERROR] Project directory not found: $PROJECT_DIR"
  exit 1
}

# ------------------------------------------------------------
# Step 2: Verify virtual environment exists
# ------------------------------------------------------------
if [ ! -d "$VENV_PATH" ]; then
  echo "[ERROR] Virtual environment not found."
  echo "Run: python3 -m venv .venv && pip install -r requirements.txt"
  exit 1
fi

# ------------------------------------------------------------
# Step 3: Activate virtual environment
# ------------------------------------------------------------
# shellcheck disable=SC1091
source "$VENV_PATH/bin/activate"

# ------------------------------------------------------------
# Step 4: Verify main application file exists
# ------------------------------------------------------------
if [ ! -f "$MAIN_FILE" ]; then
  echo "[ERROR] main.py not found in project directory."
  deactivate
  exit 1
fi

# ------------------------------------------------------------
# Step 5: Start TAMTAP
# ------------------------------------------------------------
echo "[INFO] Starting TAMTAP application..."
python "$MAIN_FILE"

# ------------------------------------------------------------
# Step 6: Deactivate virtual environment on exit
# ------------------------------------------------------------
deactivate
