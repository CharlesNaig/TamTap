#!/bin/bash
# ============================================================
# TAMTAP Update Script
# Project: TAMTAP NFC Attendance System
# Purpose:
#  - Pull latest changes from GitHub
#  - Update dependencies if requirements.txt changed
#  - Restart TAMTAP service
#
# Usage: Manual execution only (NOT for boot)
#  ./update.sh
#
# Behavior: Aborts if local changes exist (no auto-stash)
#
# Author: Charles Giann Marcelo et al.
# ============================================================

# Exit immediately on error
set -e

# ============================================================
# ABSOLUTE PATHS ONLY
# ============================================================
PROJECT_DIR="/home/charles/TamTap"
VENV_PATH="$PROJECT_DIR/.venv"
VENV_PIP="$VENV_PATH/bin/pip"
REQUIREMENTS_FILE="$PROJECT_DIR/hardware/requirements.txt"
SERVICE_NAME="tamtap"

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
# Step 2: Verify Git repository
# ============================================================
if [ ! -d "$PROJECT_DIR/.git" ]; then
  echo "[ERROR] Not a Git repository: $PROJECT_DIR"
  exit 1
fi
echo "[INFO] Git repository verified"

# ============================================================
# Step 3: Check for local uncommitted changes
# ============================================================
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[ERROR] Local changes detected. Commit or stash before updating."
  echo "[ERROR] Run: git status"
  exit 1
fi
echo "[INFO] Working tree is clean"

# ============================================================
# Step 4: Get hash of requirements.txt before pull
# ============================================================
REQ_HASH_BEFORE=""
if [ -f "$REQUIREMENTS_FILE" ]; then
  REQ_HASH_BEFORE=$(md5sum "$REQUIREMENTS_FILE" | awk '{print $1}')
fi

# ============================================================
# Step 5: Fetch and pull latest changes
# ============================================================
echo "[INFO] Fetching latest changes from origin..."
git fetch origin

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
LOCAL_HASH=$(git rev-parse HEAD)
REMOTE_HASH=$(git rev-parse "origin/$CURRENT_BRANCH")

if [ "$LOCAL_HASH" = "$REMOTE_HASH" ]; then
  echo "[INFO] Already up to date. No changes to pull."
else
  echo "[INFO] Pulling changes from origin/$CURRENT_BRANCH..."
  git pull origin "$CURRENT_BRANCH"
  echo "[INFO] Pull complete"
fi

# ============================================================
# Step 6: Update dependencies if requirements.txt changed
# ============================================================
REQ_HASH_AFTER=""
if [ -f "$REQUIREMENTS_FILE" ]; then
  REQ_HASH_AFTER=$(md5sum "$REQUIREMENTS_FILE" | awk '{print $1}')
fi

if [ "$REQ_HASH_BEFORE" != "$REQ_HASH_AFTER" ]; then
  echo "[INFO] requirements.txt changed. Updating dependencies..."
  
  if [ ! -f "$VENV_PIP" ]; then
    echo "[ERROR] pip not found in venv: $VENV_PIP"
    exit 1
  fi
  
  "$VENV_PIP" install -r "$REQUIREMENTS_FILE"
  echo "[INFO] Dependencies updated"
else
  echo "[INFO] requirements.txt unchanged. Skipping pip install."
fi

# ============================================================
# Step 7: Restart TAMTAP service
# ============================================================
echo "[INFO] Restarting TAMTAP service..."
if systemctl is-active --quiet "$SERVICE_NAME"; then
  sudo systemctl restart "$SERVICE_NAME"
  echo "[INFO] Service '$SERVICE_NAME' restarted successfully"
else
  echo "[WARN] Service '$SERVICE_NAME' was not running. Starting now..."
  sudo systemctl start "$SERVICE_NAME"
  echo "[INFO] Service '$SERVICE_NAME' started"
fi

# ============================================================
# Done
# ============================================================
echo "[INFO] =========================================="
echo "[INFO] TAMTAP update complete!"
echo "[INFO] =========================================="