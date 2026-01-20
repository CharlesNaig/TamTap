#!/usr/bin/env python3
"""
TAMTAP Button Controller
Controls application lifecycle via GPIO buttons using systemd.

GPIO Layout (BCM):
    - GPIO 5:  START button
    - GPIO 6:  RESTART button
    - GPIO 16: SHUTDOWN button (long press only)

All buttons: Active LOW, internal pull-up, wired to GND.
"""

import subprocess
import logging
import signal
import sys
from time import time
from threading import Lock
from gpiozero import Button

# =============================================================================
# CONFIGURATION
# =============================================================================

GPIO_START = 5
GPIO_RESTART = 6
GPIO_SHUTDOWN = 16

DEBOUNCE_SEC = 0.2
SHUTDOWN_HOLD_SEC = 2.5

SERVICE_NAME = "tamtap.service"

# =============================================================================
# LOGGING
# =============================================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("tamtap-buttons")

# =============================================================================
# STATE
# =============================================================================

action_lock = Lock()
shutdown_press_start = 0.0


def is_service_active() -> bool:
    """Check if tamtap.service is currently running."""
    try:
        result = subprocess.run(
            ["systemctl", "is-active", SERVICE_NAME],
            capture_output=True,
            text=True,
            timeout=5
        )
        return result.stdout.strip() == "active"
    except Exception as e:
        logger.error(f"Failed to check service status: {e}")
        return False


def run_systemctl(action: str) -> bool:
    """Execute systemctl command. Returns True on success."""
    cmd = ["sudo", "systemctl", action, SERVICE_NAME]
    try:
        logger.info(f"Executing: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            logger.info(f"systemctl {action} succeeded")
            return True
        else:
            logger.error(f"systemctl {action} failed: {result.stderr.strip()}")
            return False
    except subprocess.TimeoutExpired:
        logger.error(f"systemctl {action} timed out")
        return False
    except Exception as e:
        logger.error(f"systemctl {action} error: {e}")
        return False


def shutdown_os() -> None:
    """Shutdown the Raspberry Pi."""
    try:
        logger.info("Initiating OS shutdown...")
        subprocess.run(["sudo", "shutdown", "now"], timeout=10)
    except Exception as e:
        logger.error(f"OS shutdown failed: {e}")


# =============================================================================
# BUTTON HANDLERS
# =============================================================================

def on_start_pressed() -> None:
    """START button handler - start service if not running."""
    if not action_lock.acquire(blocking=False):
        logger.warning("Action in progress, ignoring START press")
        return
    try:
        if is_service_active():
            logger.info("Service already running, ignoring START")
            return
        run_systemctl("start")
    finally:
        action_lock.release()


def on_restart_pressed() -> None:
    """RESTART button handler - restart the service."""
    if not action_lock.acquire(blocking=False):
        logger.warning("Action in progress, ignoring RESTART press")
        return
    try:
        run_systemctl("restart")
    finally:
        action_lock.release()


def on_shutdown_held() -> None:
    """SHUTDOWN button held handler - record press start time."""
    global shutdown_press_start
    shutdown_press_start = time()
    logger.info("Shutdown button pressed, hold for 2.5 seconds...")


def on_shutdown_released() -> None:
    """SHUTDOWN button released handler - execute if held long enough."""
    global shutdown_press_start
    
    if shutdown_press_start == 0.0:
        return
    
    held_duration = time() - shutdown_press_start
    shutdown_press_start = 0.0
    
    if held_duration < SHUTDOWN_HOLD_SEC:
        logger.info(f"Shutdown cancelled (held {held_duration:.1f}s, need {SHUTDOWN_HOLD_SEC}s)")
        return
    
    if not action_lock.acquire(blocking=False):
        logger.warning("Action in progress, ignoring SHUTDOWN")
        return
    
    try:
        logger.info(f"Shutdown confirmed (held {held_duration:.1f}s)")
        
        # Step 1: Stop the service
        if is_service_active():
            logger.info("Stopping TAMTAP service...")
            if not run_systemctl("stop"):
                logger.error("Failed to stop service, aborting shutdown")
                return
            
            # Wait for service to fully stop
            import time as t
            for _ in range(10):
                if not is_service_active():
                    break
                t.sleep(0.5)
        
        # Step 2: Shutdown OS
        shutdown_os()
        
    finally:
        action_lock.release()


# =============================================================================
# SIGNAL HANDLERS
# =============================================================================

def graceful_exit(signum, frame) -> None:
    """Handle termination signals."""
    logger.info(f"Received signal {signum}, exiting...")
    sys.exit(0)


# =============================================================================
# MAIN
# =============================================================================

def main() -> None:
    """Initialize buttons and run event loop."""
    logger.info("TAMTAP Button Controller starting...")
    
    # Register signal handlers
    signal.signal(signal.SIGTERM, graceful_exit)
    signal.signal(signal.SIGINT, graceful_exit)
    
    # Initialize buttons with debounce
    # gpiozero handles pull-up and active_low automatically for Button
    btn_start = Button(
        GPIO_START,
        pull_up=True,
        bounce_time=DEBOUNCE_SEC
    )
    
    btn_restart = Button(
        GPIO_RESTART,
        pull_up=True,
        bounce_time=DEBOUNCE_SEC
    )
    
    btn_shutdown = Button(
        GPIO_SHUTDOWN,
        pull_up=True,
        bounce_time=DEBOUNCE_SEC
    )
    
    # Attach handlers
    btn_start.when_pressed = on_start_pressed
    btn_restart.when_pressed = on_restart_pressed
    btn_shutdown.when_pressed = on_shutdown_held
    btn_shutdown.when_released = on_shutdown_released
    
    logger.info(f"Buttons initialized: START(GPIO{GPIO_START}), RESTART(GPIO{GPIO_RESTART}), SHUTDOWN(GPIO{GPIO_SHUTDOWN})")
    logger.info("Waiting for button events...")
    
    # Block forever (event-based, no busy loop)
    signal.pause()


if __name__ == "__main__":
    main()
