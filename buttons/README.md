# TAMTAP Button Controller

GPIO button controller for TAMTAP application lifecycle.

## Wiring

| Button   | GPIO (BCM) | Wiring          |
|----------|------------|-----------------|
| START    | 5          | GPIO 5 → Button → GND |
| RESTART  | 6          | GPIO 6 → Button → GND |
| STOP     | 13         | GPIO 13 → Button → GND |

Internal pull-up resistors are enabled. No external resistors needed.

## Button Functions

Controls **BOTH** hardware (NFC reader) and software (Node.js server):

- **START (GPIO 5)**: Starts `tamtap.service` + `tamtap-server.service`
- **RESTART (GPIO 6)**: Restarts both services
- **STOP (GPIO 13)**: Hold 2.5 seconds → Stops both services

## Installation

```bash
# Copy ALL service files
sudo cp tamtap-buttons.service /etc/systemd/system/
sudo cp tamtap-server.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable all services on boot
sudo systemctl enable tamtap-buttons.service
sudo systemctl enable tamtap-server.service
sudo systemctl enable tamtap.service

# Start button controller now
sudo systemctl start tamtap-buttons.service
```

## Check Status

```bash
# Button controller
sudo systemctl status tamtap-buttons.service

# Hardware service
sudo systemctl status tamtap.service

# Software service
sudo systemctl status tamtap-server.service

# View logs
journalctl -u tamtap-buttons.service -f
```

## Dependencies

```bash
sudo apt install -y python3-gpiozero python3-lgpio
```

`gpiozero` should be pre-installed on Raspberry Pi OS.
