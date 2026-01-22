#!/usr/bin/env python3
"""
TAMTAP v7.2 - Student Registration CLI (Raspberry Pi)
Uses shared Database module with MongoDB + JSON sync

NOTE: This CLI registers STUDENTS only (NFC card users).
      Teachers are registered via Admin Panel (web interface)
      with username/password for dashboard login.
"""
import os
import sys
import signal
import logging
from datetime import datetime

import RPi.GPIO as GPIO
from mfrc522 import SimpleMFRC522

# Shared Database module
from database import Database

# ========================================
# LOGGING CONFIGURATION
# ========================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('TAMTAP_REG')

# GPIO setup for RFID
GPIO.setwarnings(False)
GPIO.setmode(GPIO.BCM)

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

def print_header(db):
    """Print application header with DB status"""
    print("=" * 50)
    print("   TAMTAP v7.2 - STUDENT REGISTRATION")
    print("   NFC-Based Attendance | CLI Version")
    db_status = "[MongoDB]" if db.is_connected() else "[JSON Fallback]"
    print(f"   Database: {db_status}")
    print("=" * 50)
    print("\n   NOTE: Teachers are registered via Admin Panel")
    print("         (web interface with username/password)")

def print_menu():
    """Print main menu"""
    print("\n[MAIN MENU]")
    print("-" * 30)
    print("  1. Register Student (NFC)")
    print("  2. List All Students")
    print("  3. Delete Student")
    print("  4. Exit")
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

def register_user(role, db, nfc_reader):
    """Register a new student via NFC card"""
    clear_screen()
    print_header(db)
    
    print("\n[REGISTER STUDENT]")
    print("-" * 30)
    
    # Step 1: Get NFC ID
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
    if db.user_exists(nfc_id):
        print(f"\n[ERROR] NFC ID {nfc_id} is already registered!")
        logger.warning("Duplicate NFC ID attempted: %s", nfc_id)
        input("\nPress Enter to continue...")
        return False
    
    # Step 2: Get student details
    print("\nStep 2: Enter STUDENT Details")
    print("-" * 30)
    
    # TAMTAP ID (auto or manual)
    next_id = db.get_next_tamtap_id()
    next_id_str = str(next_id).zfill(3)
    print(f"\n  Next available TAMTAP ID: {next_id_str}")
    
    while True:
        tamtap_input = get_input(f"> TAMTAP ID (Enter for {next_id_str}, or type custom): ", required=False)
        if tamtap_input is None:
            return False
        
        if not tamtap_input:
            tamtap_id = next_id_str
            break
        else:
            try:
                tamtap_num = int(tamtap_input)
                if tamtap_num < 1:
                    print("[!] ID must be a positive number")
                    continue
                tamtap_id = str(tamtap_num).zfill(3)
                
                if db.tamtap_id_exists(tamtap_id):
                    print(f"[!] TAMTAP ID {tamtap_id} already exists!")
                    continue
                break
            except ValueError:
                print("[!] Please enter a valid number")
                continue
    
    # First Name (required)
    first_name = get_input("> First Name: ")
    if first_name is None:
        return False
    
    # Last Name (required)
    last_name = get_input("> Last Name: ")
    if last_name is None:
        return False
    
    # Grade (required for students)
    grade = get_input("> Grade (e.g., 11, 12): ")
    if grade is None:
        return False
    
    # Section (required for students)
    section = get_input("> Section (e.g., ICT-A, STEM-B): ")
    if section is None:
        return False
    
    # Confirm registration
    full_name = f"{first_name} {last_name}"
    
    print("\n" + "=" * 40)
    print("       CONFIRM STUDENT REGISTRATION")
    print("=" * 40)
    print(f"  TAMTAP ID:  {tamtap_id}")
    print(f"  NFC ID:     {nfc_id}")
    print(f"  Name:       {full_name}")
    print(f"  Grade:      {grade}")
    print(f"  Section:    {section}")
    print("=" * 40)
    
    confirm = get_input("\n> Save this student? (y/n): ", required=False)
    
    if confirm and confirm.lower() in ['y', 'yes']:
        # Build student data matching admin.js schema
        user_data = {
            "nfc_id": nfc_id,
            "tamtap_id": tamtap_id,
            "first_name": first_name,
            "last_name": last_name,
            "name": full_name,
            "grade": grade,
            "section": section,
            "registered": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        
        if db.add_user(nfc_id, user_data, "student"):
            print(f"\n[SUCCESS] {full_name} registered!")
            print(f"          TAMTAP ID: {tamtap_id}")
            print(f"          Section: {grade} {section}")
            logger.info("Student registered: %s (NFC: %s, ID: %s)", full_name, nfc_id, tamtap_id)
        else:
            print("\n[ERROR] Failed to save student")
            return False
    else:
        print("\n[!] Registration cancelled")
        return False
    
    input("\nPress Enter to continue...")
    return True

def list_students(db):
    """List all registered students"""
    clear_screen()
    print_header(db)
    print("\n[REGISTERED STUDENTS]")
    print("-" * 60)
    
    students, _ = db.get_all_users()
    
    if not students:
        print("\n  No students registered yet.")
        print("\n  Use option 1 to register students with NFC cards.")
        print("-" * 60)
        input("\nPress Enter to continue...")
        return
    
    print(f"\nTotal Students: {len(students)}")
    print("-" * 60)
    
    for user in students:
        tamtap_id = user.get("tamtap_id", "---")
        nfc_id = user.get("nfc_id", "?")
        name = user.get("name", f"{user.get('first_name', '')} {user.get('last_name', '')}".strip())
        grade = user.get("grade", "")
        section = user.get("section", "")
        
        print(f"\n  [{tamtap_id}] {name}")
        print(f"        NFC: {nfc_id}")
        print(f"        Grade/Section: {grade} {section}".strip())
    
    print("\n" + "-" * 60)
    print(f"Total: {len(students)} student(s)")
    print("\nNOTE: Teachers are managed via Admin Panel (web)")
    
    input("\nPress Enter to continue...")

def delete_student(db, nfc_reader):
    """Delete a registered student"""
    clear_screen()
    print_header(db)
    print("\n[DELETE STUDENT]")
    print("-" * 30)
    
    print("\nScan student's NFC card or enter ID manually")
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
    
    # Find student
    user_data, role = db.get_user(nfc_id)
    
    if not user_data:
        print(f"\n[ERROR] NFC ID {nfc_id} not found")
        input("\nPress Enter to continue...")
        return False
    
    if role != "student":
        print(f"\n[ERROR] This NFC ID belongs to a {role}, not a student.")
        print("        Teachers are managed via Admin Panel (web).")
        input("\nPress Enter to continue...")
        return False
    
    # Get display info
    name = user_data.get("name", f"{user_data.get('first_name', '')} {user_data.get('last_name', '')}".strip())
    tamtap_id = user_data.get("tamtap_id", "---")
    grade = user_data.get("grade", "")
    section = user_data.get("section", "")
    
    # Confirm deletion
    print("\n" + "=" * 35)
    print("       STUDENT FOUND")
    print("=" * 35)
    print(f"  TAMTAP ID:  {tamtap_id}")
    print(f"  NFC ID:     {nfc_id}")
    print(f"  Name:       {name}")
    print(f"  Grade:      {grade}")
    print(f"  Section:    {section}")
    print("=" * 35)
    
    confirm = get_input("\n> DELETE this student? (type 'DELETE' to confirm): ", required=False)
    
    if confirm == 'DELETE':
        if db.delete_user(nfc_id):
            print(f"\n[SUCCESS] Student deleted: {name}")
            logger.info("Student deleted: %s (NFC: %s)", name, nfc_id)
        else:
            print("\n[ERROR] Failed to delete student")
            return False
    else:
        print("\n[!] Deletion cancelled")
    
    input("\nPress Enter to continue...")
    return True

def main():
    """Main entry point"""
    logger.info("Starting TAMTAP v7.2 Student Registration CLI...")
    
    # Initialize database (MongoDB with JSON fallback)
    db = Database()
    
    # Initialize NFC reader
    nfc_reader = NFCReader()
    
    try:
        while True:
            clear_screen()
            print_header(db)
            print_menu()
            
            choice = get_input("\n> Select option (1-4): ", required=False)
            
            if choice is None:
                continue
            
            if choice == '1':
                register_user("student", db, nfc_reader)
            elif choice == '2':
                list_students(db)
            elif choice == '3':
                delete_student(db, nfc_reader)
            elif choice == '4':
                print("\n[*] Goodbye!")
                break
            else:
                print("\n[!] Invalid option")
                input("Press Enter to continue...")
                
    except KeyboardInterrupt:
        print("\n\n[*] Interrupted - Exiting...")
    finally:
        db.close()
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
