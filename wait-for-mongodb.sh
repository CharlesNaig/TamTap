#!/bin/bash
# ============================================================
# TAMTAP - Wait for MongoDB (Docker Container)
# Purpose:
#   Blocks until the MongoDB Docker container is running
#   AND accepting connections. Used as ExecStartPre in
#   tamtap-server.service to enforce boot order:
#
#   Docker → MongoDB ready → Server → Hardware → Buttons
#
# Container: tamtap-mongodb (mongo:4.4.18)
# Timeout: 60 seconds (configurable below)
#
# Author: Charles Giann Marcelo et al.
# ============================================================

set -e

CONTAINER_NAME="tamtap-mongodb"
MAX_WAIT=20
POLL_INTERVAL=5

echo "[TAMTAP] Waiting for MongoDB container '${CONTAINER_NAME}' to be ready..."

elapsed=0

# Phase 1: Wait for Docker container to be running
while [ $elapsed -lt $MAX_WAIT ]; do
    # Check if container exists and is running
    STATUS=$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || echo "false")
    
    if [ "$STATUS" = "true" ]; then
        echo "[TAMTAP] Container '${CONTAINER_NAME}' is running (${elapsed}s)"
        break
    fi
    
    echo "[TAMTAP] Container not ready yet... (${elapsed}s/${MAX_WAIT}s)"
    sleep $POLL_INTERVAL
    elapsed=$((elapsed + POLL_INTERVAL))
done

if [ $elapsed -ge $MAX_WAIT ]; then
    echo "[TAMTAP] WARNING: Container '${CONTAINER_NAME}' did not start within ${MAX_WAIT}s"
    echo "[TAMTAP] Server will start with fallback database (cloud MongoDB or JSON)"
    exit 0
fi

# Phase 2: Wait for MongoDB to accept connections (ping)
while [ $elapsed -lt $MAX_WAIT ]; do
    # mongo 4.4 uses 'mongo' command, not 'mongosh'
    if docker exec "$CONTAINER_NAME" mongo --quiet --eval "db.adminCommand('ping')" >/dev/null 2>&1; then
        echo "[TAMTAP] MongoDB is accepting connections (${elapsed}s)"
        echo "[TAMTAP] Database ready — proceeding with server startup"
        exit 0
    fi
    
    echo "[TAMTAP] MongoDB not accepting connections yet... (${elapsed}s/${MAX_WAIT}s)"
    sleep $POLL_INTERVAL
    elapsed=$((elapsed + POLL_INTERVAL))
done

echo "[TAMTAP] WARNING: MongoDB did not respond to ping within ${MAX_WAIT}s"
echo "[TAMTAP] Server will start with fallback database (cloud MongoDB or JSON)"
exit 0
