# 🧰 TAMTAP – Raspberry Pi Necessary Commands Cheat Sheet

**FEU Roosevelt Marikina | Grade 12 ICT Capstone**  
**Purpose:** WiFi management, IP discovery, Python environment setup, and auto-start configuration for TAMTAP.

## naig ip on tamtap
`ssh 10.43.13.49`


## 📶 WiFi Management (nmcli)

### 🔍 List Saved WiFi Connections

```bash
nmcli connection show
```

---

### 🔌 Manually Connect to an Existing Profile

```bash
sudo nmcli connection up "Your_Profile_Name"
```

---

### ⭐ Set WiFi Priority (Auto-Connect Order)

Set **primary network** (higher priority):

```bash
sudo nmcli connection modify "Primary_SSID" connection.autoconnect-priority 100
```

Set **secondary / backup network**:

```bash
sudo nmcli connection modify "tamtap" connection.autoconnect-priority 50
```

> Higher number = higher priority
> Raspberry Pi will always prefer the highest available network.

---

### 🔄 Rescan Available WiFi Networks

```bash
sudo nmcli device wifi rescan
```

---

### ➕ Connect to a New WiFi Network

```bash
sudo nmcli dev wifi connect "Your_Backup_SSID" password "Your_Backup_Password"
```

---

## 🌐 Finding TAMTAP IP Address (LAN)

### 📡 Check Local IP Addresses

```bash
ip addr
```

Look for `wlan0` and note the IP (e.g., `192.168.254.x`).

---

### 🔎 Scan Network for Unknown TAMTAP IP (nmap)

If TAMTAP switched WiFi and IP is unknown:

```bash
sudo nmap -sn 192.168.254.1/24
```

- Scan the subnet of the current router
- Identify the Raspberry Pi hostname or MAC
- Copy the discovered TAMTAP IP address

---

## 🐍 Python Virtual Environment (Recommended)

### 📦 Create Virtual Environment

```bash
python3 -m venv .venv
```

---

### ▶️ Activate Virtual Environment

```bash
source .venv/bin/activate
```
windows 11/10
```
.\venv\Scripts\activate.bat
or
.\venv\Scripts\Activate.ps1

```

Once activated, install packages safely:

```bash
pip install -r requirements.txt
```

> ✅ Keeps system Python clean
> ✅ Prevents package conflicts on Bookworm OS

---

## 🔄 4. GitHub Update & Sync Cheat Sheet (Raspberry Pi)

### 🎯 Purpose

Update the TAMTAP code on the Raspberry Pi when changes were pushed from another device (e.g., laptop or lab PC).

This avoids re-cloning and keeps deployments clean.

---

### 🔍 Check Current Repository Status

```bash
git status
```

* Shows modified files
* Confirms current branch

---

### 🌐 Fetch Latest Changes from GitHub (Safe)

```bash
git fetch origin
```

* Downloads updates
* Does NOT modify local files yet

---

### 📋 View Incoming Changes

```bash
git log HEAD..origin/main --oneline
```

> Replace `main` if your branch name is different.

---

### ⬇️ Pull Latest Updates (Most Common)

```bash
git pull origin main
```

* Fetches + merges latest changes
* Use when Raspberry Pi has **no local edits**

---

### ⚠️ If Local Changes Exist (Safe Update)

```bash
git stash
git pull origin main
git stash pop
```

* Temporarily saves local edits
* Applies updates
* Restores local changes

---

### 🔁 Hard Reset to GitHub Version (Last Resort)

⚠️ **This will discard local changes**

```bash
git fetch origin
git reset --hard origin/main
```

Use only if:

* Code is broken
* Pi must match GitHub exactly

---

### 🧠 Recommended Update Flow for TAMTAP

```bash
cd ~/tamtap
git status
git pull origin main
sudo systemctl restart tamtap
```

---

### 🧪 Verify After Update

```bash
sudo systemctl status tamtap
```

* Confirm service is running
* Check logs if needed

---

## ✅ Git Update Summary

* `git fetch` → check for updates
* `git pull` → apply updates
* `git stash` → protect local changes
* `git reset --hard` → force sync

---

## ⚙️ Auto-Start TAMTAP on Boot (One Plug, Ready to Tap)

### 🎯 Goal

Automatically start:

- Python hardware controller
- Node.js backend
- Dashboard services

---

### 🧾 Create systemd Service

```bash
sudo nano /etc/systemd/system/tamtap.service
```

---

### 🧠 Example systemd Service File

```ini
[Unit]
Description=TAMTAP NFC Attendance System
After=network.target

[Service]
User=pi
WorkingDirectory=/home/pi/tamtap
ExecStart=/home/pi/tamtap/.venv/bin/python main.py
Restart=always

[Install]
WantedBy=multi-user.target
```

---

### 🔄 Reload & Enable Service

```bash
sudo systemctl daemon-reexec
sudo systemctl daemon-reload
sudo systemctl enable tamtap
sudo systemctl start tamtap
```

---

### 🔍 Check Service Status

```bash
sudo systemctl status tamtap
```

---

## 🛑 Stop / Restart TAMTAP (Maintenance)

```bash
sudo systemctl stop tamtap
sudo systemctl restart tamtap
```

---

## ✅ Summary

- 📶 WiFi managed via `nmcli`
- 🌐 IP discovery via `ip addr` + `nmap`
- 🐍 Python isolation using `.venv`
- ⚙️ systemd ensures **plug-and-play readiness**
