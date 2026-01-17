#!/usr/bin/env python3
"""
TAMTAP v7.1 - Registration CLI (Raspberry Pi)
Uses shared Database module with MongoDB + JSON sync
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
    print("   TAMTAP v7.0 - REGISTRATION SYSTEM")
    print("   NFC-Based Attendance | CLI Version")
    db_status = "[MongoDB]" if db.is_connected() else "[JSON Fallback]"
    print(f"   Database: {db_status}")
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

def validate_email(email):
    """Basic email validation"""
    if not email:
        return True  # Email is optional
    if '@' in email and '.' in email.split('@')[-1]:
        return True
    return False

def register_user(role, db, nfc_reader):
    """Register a new student or teacher"""
    clear_screen()
    print_header(db)
    
    role_upper = role.upper()
    print(f"\n[REGISTER {role_upper}]")
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
    
    # Step 2: Get user details with new schema
    print(f"\nStep 2: Enter {role_upper} Details")
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
    
    # Email (optional)
    while True:
        email = get_input("> Email (optional, press Enter to skip): ", required=False)
        if email is None:
            return False
        if validate_email(email):
            break
        print("[!] Invalid email format")
    
    # First Name
    first_name = get_input("> First Name: ")
    if first_name is None:
        return False
    
    # Last Name
    last_name = get_input("> Last Name: ")
    if last_name is None:
        return False
    
    # Grade
    grade = get_input("> Grade (e.g., 12): ", required=False)
    if grade is None:
        grade = ""
    
    # Section
    section = get_input("> Section (e.g., ICT B): ", required=False)
    if section is None:
        section = ""
    
    # Confirm registration
    full_name = f"{first_name} {last_name}"
    grade_section = f"{grade} {section}".strip() if grade or section else "N/A"
    
    print("\n" + "=" * 35)
    print("CONFIRM REGISTRATION")
    print("=" * 35)
    print(f"  TAMTAP ID: {tamtap_id}")
    print(f"  Role:      {role_upper}")
    print(f"  NFC ID:    {nfc_id}")
    print(f"  Email:     {email if email else 'N/A'}")
    print(f"  Name:      {full_name}")
    print(f"  Grade:     {grade if grade else 'N/A'}")
    print(f"  Section:   {section if section else 'N/A'}")
    print("=" * 35)
    
    confirm = get_input("\n> Save this user? (y/n): ", required=False)
    
    if confirm and confirm.lower() in ['y', 'yes']:
        # Build user data with new schema
        user_data = {
            "tamtap_id": tamtap_id,
            "email": email,
            "first_name": first_name,
            "last_name": last_name,
            "name": full_name,  # Keep combined name for display
            "grade": grade,
            "section": section,
            "registered": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        
        if db.add_user(nfc_id, user_data, role):
            print(f"\n[SUCCESS] {full_name} registered as {role_upper}!")
            logger.info("User registered: %s (NFC: %s, Role: %s)", full_name, nfc_id, role)
        else:
            print("\n[ERROR] Failed to save user")
            return False
    else:
        print("\n[!] Registration cancelled")
        return False
    
    input("\nPress Enter to continue...")
    return True

def list_users(db):
    """List all registered users"""
    clear_screen()
    print_header(db)
    print("\n[REGISTERED USERS]")
    print("-" * 60)
    
    students, teachers = db.get_all_users()
    
    # List students
    print(f"\nSTUDENTS ({len(students)})")
    print("-" * 55)
    if students:
        for user in students:
            tamtap_id = user.get("tamtap_id", "---")
            nfc_id = user.get("nfc_id", "?")
            name = user.get("name", f"{user.get('first_name', '')} {user.get('last_name', '')}".strip())
            grade = user.get("grade", "")
            section = user.get("section", "")
            grade_sec = f"{grade} {section}".strip() if grade or section else "N/A"
            email = user.get("email", "")
            
            print(f"  [ID: {tamtap_id}] NFC: {nfc_id}")
            print(f"    Name:    {name}")
            print(f"    Grade:   {grade_sec}")
            if email:
                print(f"    Email:   {email}")
            print()
    else:
        print("  No students registered\n")
    
    # List teachers
    print(f"TEACHERS ({len(teachers)})")
    print("-" * 55)
    if teachers:
        for user in teachers:
            tamtap_id = user.get("tamtap_id", "---")
            nfc_id = user.get("nfc_id", "?")
            name = user.get("name", f"{user.get('first_name', '')} {user.get('last_name', '')}".strip())
            email = user.get("email", "")
            
            print(f"  [ID: {tamtap_id}] NFC: {nfc_id}")
            print(f"    Name:  {name}")
            if email:
                print(f"    Email: {email}")
            print()
    else:
        print("  No teachers registered\n")
    
    print("-" * 60)
    print(f"Total Users: {len(students) + len(teachers)}")
    
    input("\nPress Enter to continue...")

def delete_user(db, nfc_reader):
    """Delete a registered user"""
    clear_screen()
    print_header(db)
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
    user_data, role = db.get_user(nfc_id)
    
    if not user_data:
        print(f"\n[ERROR] NFC ID {nfc_id} not found")
        input("\nPress Enter to continue...")
        return False
    
    # Get display name
    name = user_data.get("name", f"{user_data.get('first_name', '')} {user_data.get('last_name', '')}".strip())
    
    # Confirm deletion
    print("\n" + "=" * 30)
    print("USER FOUND")
    print("=" * 30)
    print(f"  NFC ID: {nfc_id}")
    print(f"  Name:   {name}")
    print(f"  Role:   {role.upper()}")
    print("=" * 30)
    
    confirm = get_input("\n> DELETE this user? (type 'DELETE' to confirm): ", required=False)
    
    if confirm == 'DELETE':
        if db.delete_user(nfc_id):
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
    logger.info("Starting TAMTAP v7.0 Registration CLI...")
    
    # Initialize database (MongoDB with JSON fallback)
    db = Database()
    
    # Initialize NFC reader
    nfc_reader = NFCReader()
    
    try:
        while True:
            clear_screen()
            print_header(db)
            print_menu()
            
            choice = get_input("\n> Select option (1-5): ", required=False)
            
            if choice is None:
                continue
            
            if choice == '1':
                register_user("student", db, nfc_reader)
            elif choice == '2':
                register_user("teacher", db, nfc_reader)
            elif choice == '3':
                list_users(db)
            elif choice == '4':
                delete_user(db, nfc_reader)
            elif choice == '5':
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
