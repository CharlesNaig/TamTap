# TAMTAP Button Controller

GPIO button controller for TAMTAP application lifecycle.

## Wiring

| Button   | GPIO (BCM) | Wiring          |
|----------|------------|-----------------|
| START    | 5          | GPIO 5 → Button → GND |
| RESTART  | 6          | GPIO 6 → Button → GND |
| SHUTDOWN | 16         | GPIO 16 → Button → GND |

Internal pull-up resistors are enabled. No external resistors needed.

## Button Functions

- **START**: Starts `tamtap.service` (ignored if already running)
- **RESTART**: Restarts `tamtap.service`
- **SHUTDOWN**: Hold 2.5 seconds → stops service → shuts down Pi

## Installation

```bash
# Copy service file
sudo cp tamtap-buttons.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable on boot
sudo systemctl enable tamtap-buttons.service

# Start now
sudo systemctl start tamtap-buttons.service
```

## Check Status

```bash
sudo systemctl status tamtap-buttons.service
journalctl -u tamtap-buttons.service -f
```

## Dependencies

```bash
pip3 install gpiozero
```

`gpiozero` should be pre-installed on Raspberry Pi OS.
