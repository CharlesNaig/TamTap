#!/usr/bin/env python3
"""
TAMTAP v6.2 REGISTRATION CLI
Student/Teacher Registration + NFC Integration
Synced with tamtap_v6.2.py database schema
CLI version for headless Raspberry Pi
"""

import json
import os
import sys
import signal
import logging
from datetime import datetime

import RPi.GPIO as GPIO
from mfrc522 import SimpleMFRC522

# ========================================
# LOGGING CONFIGURATION
# ========================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('TAMTAP_REG')

# ========================================
# CONSTANTS
# ========================================
DB_FILE = "tamtap_users.json"

# GPIO setup for RFID
GPIO.setwarnings(False)
GPIO.setmode(GPIO.BCM)

# ========================================
# DATABASE FUNCTIONS (SYNCED WITH v6.2)
# ========================================
def load_db():
    """Load database - synced with tamtap_v6.2.py schema"""
    try:
        if os.path.exists(DB_FILE):
            with open(DB_FILE, 'r') as f:
                return json.load(f)
    except json.JSONDecodeError as e:
        logger.error("Database JSON error: %s", e)
    except Exception as e:
        logger.error("Database load error: %s", e)
    return {"students": {}, "teachers": {}, "attendance": []}

def save_db(db):
    """Save database to JSON file"""
    try:
        with open(DB_FILE, 'w') as f:
            json.dump(db, f, indent=2)
        logger.info("Database saved successfully")
        return True
    except Exception as e:
        logger.error("Failed to save database: %s", e)
        return False

# ========================================
# NFC READER
# ========================================
class NFCReader:
    """NFC Reader wrapper with error handling"""
    
    def __init__(self):
        self.reader = None
        try:
            self.reader = SimpleMFRC522()
            logger.info("NFC reader initialized")
        except Exception as e:
            logger.error("NFC reader init failed: %s", e)
    
    def scan_blocking(self, timeout=30):
        """Blocking NFC scan with timeout message"""
        if not self.reader:
            return None
        
        print(f"\n[*] Tap NFC card now... (waiting {timeout}s)")
        print("[*] Press Ctrl+C to cancel\n")
        
        try:
            nfc_id, text = self.reader.read()
            if nfc_id:
                logger.info("NFC scanned: %s", nfc_id)
                return str(nfc_id)
        except KeyboardInterrupt:
            print("\n[!] Scan cancelled")
            return None
        except Exception as e:
            logger.error("NFC scan error: %s", e)
        
        return None

# ========================================
# CLI INTERFACE
# ========================================
def clear_screen():
    """Clear terminal screen"""
    os.system('clear' if os.name != 'nt' else 'cls')

def print_header():
    """Print application header"""
    print("=" * 50)
    print("   TAMTAP v6.2 - REGISTRATION SYSTEM")
    print("   NFC-Based Attendance | CLI Version")
    print("=" * 50)

def print_menu():
    """Print main menu"""
    print("\n[MAIN MENU]")
    print("-" * 30)
    print("  1. Register Student")
    print("  2. Register Teacher")
    print("  3. List All Users")
    print("  4. Delete User")
    print("  5. Exit")
    print("-" * 30)

def get_input(prompt, required=True, max_length=50):
    """Get user input with validation"""
    while True:
        try:
            value = input(prompt).strip()
            if required and not value:
                print("[!] This field is required")
                continue
            if len(value) > max_length:
                print(f"[!] Maximum {max_length} characters allowed")
                continue
            return value
        except KeyboardInterrupt:
            print("\n[!] Cancelled")
            return None

def register_user(role, nfc_reader):
    """Register a new student or teacher"""
    clear_screen()
    print_header()
    
    role_upper = role.upper()
    print(f"\n[REGISTER {role_upper}]")
    print("-" * 30)
    
    # Get NFC ID
    print("\nStep 1: Scan NFC Card")
    print("  (or type 'manual' to enter ID manually)")
    
    choice = get_input("\n> Press Enter to scan or type 'manual': ", required=False)
    
    if choice is None:
        return False
    
    if choice.lower() == 'manual':
        nfc_id = get_input("\n> Enter NFC ID: ")
        if nfc_id is None:
            return False
    else:
        nfc_id = nfc_reader.scan_blocking()
        if nfc_id is None:
            print("[!] No card detected")
            input("\nPress Enter to continue...")
            return False
        print(f"[OK] Card detected: {nfc_id}")
    
    # Check if NFC ID already exists
    db = load_db()
    if nfc_id in db.get("students", {}) or nfc_id in db.get("teachers", {}):
        print(f"\n[ERROR] NFC ID {nfc_id} is already registered!")
        logger.warning("Duplicate NFC ID attempted: %s", nfc_id)
        input("\nPress Enter to continue...")
        return False
    
    # Get user details
    print(f"\nStep 2: Enter {role_upper} Details")
    print("-" * 30)
    
    name = get_input("> Full Name: ")
    if name is None:
        return False
    
    grade = get_input("> Grade/Section (e.g., 12 ICT B): ", required=False)
    if grade is None:
        grade = ""
    
    # Confirm registration
    print("\n" + "=" * 30)
    print("CONFIRM REGISTRATION")
    print("=" * 30)
    print(f"  Role:    {role_upper}")
    print(f"  NFC ID:  {nfc_id}")
    print(f"  Name:    {name}")
    print(f"  Grade:   {grade if grade else 'N/A'}")
    print("=" * 30)
    
    confirm = get_input("\n> Save this user? (y/n): ", required=False)
    
    if confirm and confirm.lower() in ['y', 'yes']:
        # Save to database with v6.2 schema
        collection = "students" if role == "student" else "teachers"
        db[collection][nfc_id] = {
            "name": name,
            "grade": grade,
            "registered": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        
        if save_db(db):
            print(f"\n[SUCCESS] {name} registered as {role_upper}!")
            logger.info("User registered: %s (NFC: %s, Role: %s)", name, nfc_id, role)
        else:
            print("\n[ERROR] Failed to save user")
            return False
    else:
        print("\n[!] Registration cancelled")
        return False
    
    input("\nPress Enter to continue...")
    return True

def list_users():
    """List all registered users"""
    clear_screen()
    print_header()
    print("\n[REGISTERED USERS]")
    print("-" * 50)
    
    db = load_db()
    students = db.get("students", {})
    teachers = db.get("teachers", {})
    
    # List students
    print(f"\nSTUDENTS ({len(students)})")
    print("-" * 40)
    if students:
        for nfc_id, data in students.items():
            name = data.get("name", "Unknown")
            grade = data.get("grade", "N/A")
            print(f"  [{nfc_id}] {name} - {grade}")
    else:
        print("  No students registered")
    
    # List teachers
    print(f"\nTEACHERS ({len(teachers)})")
    print("-" * 40)
    if teachers:
        for nfc_id, data in teachers.items():
            name = data.get("name", "Unknown")
            print(f"  [{nfc_id}] {name}")
    else:
        print("  No teachers registered")
    
    print("\n" + "-" * 50)
    print(f"Total Users: {len(students) + len(teachers)}")
    
    input("\nPress Enter to continue...")

def delete_user(nfc_reader):
    """Delete a registered user"""
    clear_screen()
    print_header()
    print("\n[DELETE USER]")
    print("-" * 30)
    
    print("\nScan NFC card or enter ID manually")
    choice = get_input("\n> Press Enter to scan or type 'manual': ", required=False)
    
    if choice is None:
        return False
    
    if choice.lower() == 'manual':
        nfc_id = get_input("\n> Enter NFC ID to delete: ")
        if nfc_id is None:
            return False
    else:
        nfc_id = nfc_reader.scan_blocking()
        if nfc_id is None:
            print("[!] No card detected")
            input("\nPress Enter to continue...")
            return False
        print(f"[OK] Card detected: {nfc_id}")
    
    # Find user
    db = load_db()
    user_data = None
    collection = None
    
    if nfc_id in db.get("students", {}):
        user_data = db["students"][nfc_id]
        collection = "students"
    elif nfc_id in db.get("teachers", {}):
        user_data = db["teachers"][nfc_id]
        collection = "teachers"
    
    if not user_data:
        print(f"\n[ERROR] NFC ID {nfc_id} not found")
        input("\nPress Enter to continue...")
        return False
    
    # Confirm deletion
    print("\n" + "=" * 30)
    print("USER FOUND")
    print("=" * 30)
    print(f"  NFC ID: {nfc_id}")
    print(f"  Name:   {user_data.get('name', 'Unknown')}")
    print(f"  Role:   {collection.upper()}")
    print("=" * 30)
    
    confirm = get_input("\n> DELETE this user? (type 'DELETE' to confirm): ", required=False)
    
    if confirm == 'DELETE':
        del db[collection][nfc_id]
        if save_db(db):
            print(f"\n[SUCCESS] User deleted!")
            logger.info("User deleted: NFC %s", nfc_id)
        else:
            print("\n[ERROR] Failed to delete user")
            return False
    else:
        print("\n[!] Deletion cancelled")
    
    input("\nPress Enter to continue...")
    return True

def main():
    """Main entry point"""
    logger.info("Starting TAMTAP v6.2 Registration CLI...")
    
    # Initialize NFC reader
    nfc_reader = NFCReader()
    
    try:
        while True:
            clear_screen()
            print_header()
            print_menu()
            
            choice = get_input("\n> Select option (1-5): ", required=False)
            
            if choice is None:
                continue
            
            if choice == '1':
                register_user("student", nfc_reader)
            elif choice == '2':
                register_user("teacher", nfc_reader)
            elif choice == '3':
                list_users()
            elif choice == '4':
                delete_user(nfc_reader)
            elif choice == '5':
                print("\n[*] Goodbye!")
                break
            else:
                print("\n[!] Invalid option")
                input("Press Enter to continue...")
                
    except KeyboardInterrupt:
        print("\n\n[*] Interrupted - Exiting...")
    finally:
        GPIO.cleanup()
        logger.info("Registration CLI closed")

# ========================================
# SIGNAL HANDLER
# ========================================
def signal_handler(sig, frame):
    """Handle shutdown signals"""
    print("\n\n[*] Shutdown signal received")
    GPIO.cleanup()
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# ========================================
# RUN
# ========================================
if __name__ == "__main__":
    main()
