# TAMTAP Necessary Commands Cheat Sheet

---

## 📁 Hardware Folder (`/hardware`)

### Main Application

```bash
python3 tamtap.py              # Start main NFC attendance system (state machine)
```

### Registration CLI

```bash
python3 register.py            # Interactive CLI to register students/teachers
```

### Admin Tools

```bash
python3 tamtap_admin.py        # Admin management interface
```

### Attendance Archiving

```bash
# Interactive menu
python3 archive_attendance.py

# Quick commands
python3 archive_attendance.py --today      # Archive & clear today's records
python3 archive_attendance.py --all        # Archive & clear all records
python3 archive_attendance.py --clear      # Just clear today (no archive)
python3 archive_attendance.py --list       # View archives
```

### Database Module

> `database.py` - Shared module (MongoDB + JSON sync), imported by other scripts

---

## 📁 Software Folder (`/software`)

### Node.js Backend Server

```bash
cd software
npm install                    # Install dependencies
npm start                      # Start Express + Socket.IO server
node server.js                 # Alternative direct start
```

### Purpose

- Express.js API server
- Socket.IO for real-time dashboard updates
- Routes: `/routes/attendance.js`, `/routes/stats.js`, `/routes/students.js`
- Dashboard: `/public/index.html`

---

## 📁 Test Folder (`/test`)

### Hardware Component Tests

```bash
cd test
python3 test_rfid.py           # Test NFC/RFID reader (RC522)
python3 test_lcd.py            # Test I2C LCD 16x2 display
python3 test_leds.py           # Test Green/Red LEDs
python3 test_buzzer.py         # Test buzzer output
python3 test_dry_run.py        # Full system dry run (no hardware)
```

### Utility Scripts

```bash
python3 excel_id.py            # Excel ID generation/export utility
```

---

## 🚀 Startup (Systemd Service)

```bash
./startup.sh                   # Manual start via script
sudo systemctl start tamtap    # Start via systemd
g   # Check service status
sudo systemctl restart tamtap  # Restart after code update
```


# checking back logs:
```
# Check all 3 services
sudo systemctl status tamtap-buttons.service
sudo systemctl status tamtap.service
sudo systemctl status tamtap-server.service

# View live button logs
journalctl -u tamtap-buttons.service -f
```