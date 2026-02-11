#!/usr/bin/env python3
"""
TAMTAP v8.0 - Student Registration CLI (Raspberry Pi)
Uses shared Database module with MongoDB + JSON sync

Features:
  - Single student registration (NFC scan)
  - Batch section registration (multiple students, auto-increment TAMTAP ID)
  - List / Delete students

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
# CLI HELPERS
# ========================================
def clear_screen():
    """Clear terminal screen"""
    os.system('clear' if os.name != 'nt' else 'cls')

def print_header(db):
    """Print application header with DB status"""
    print("=" * 55)
    print("   TAMTAP v8.0 - STUDENT REGISTRATION")
    print("   NFC-Based Attendance | CLI Version")
    db_status = "[MongoDB]" if db.is_connected() else "[JSON Fallback]"
    print(f"   Database: {db_status}")
    print("=" * 55)
    print("\n   NOTE: Teachers are registered via Admin Panel")
    print("         (web interface with username/password)")

def print_menu():
    """Print main menu"""
    print("\n[MAIN MENU]")
    print("-" * 35)
    print("  1. Register Single Student")
    print("  2. Register Batch (Whole Section)")
    print("  3. List All Students")
    print("  4. Delete Student")
    print("  5. Sync Database (Force)")
    print("  6. Exit")
    print("-" * 35)

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

def get_int_input(prompt, min_val=1, max_val=999):
    """Get integer input with range validation"""
    while True:
        value = get_input(prompt)
        if value is None:
            return None
        try:
            num = int(value)
            if num < min_val or num > max_val:
                print(f"[!] Must be between {min_val} and {max_val}")
                continue
            return num
        except ValueError:
            print("[!] Please enter a valid number")

# ========================================
# SINGLE STUDENT REGISTRATION
# ========================================
def register_single(db, nfc_reader):
    """Register a single student via NFC card"""
    clear_screen()
    print_header(db)
    
    print("\n[REGISTER SINGLE STUDENT]")
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
    
    # Student info
    first_name = get_input("> First Name: ")
    if first_name is None:
        return False
    
    last_name = get_input("> Last Name: ")
    if last_name is None:
        return False
    
    grade = get_input("> Grade (e.g., 11, 12): ")
    if grade is None:
        return False
    
    section = get_input("> Section (e.g., ICT-A, STEM-B): ")
    if section is None:
        return False
    
    # Confirm
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

# ========================================
# BATCH SECTION REGISTRATION
# ========================================
def register_batch(db, nfc_reader):
    """Register multiple students in one section with auto-increment TAMTAP ID"""
    clear_screen()
    print_header(db)
    
    print("\n[BATCH REGISTRATION - WHOLE SECTION]")
    print("-" * 45)
    print("  Register multiple students at once.")
    print("  All students share the same Grade & Section.")
    print("  TAMTAP IDs auto-increment from your starting number.")
    print("-" * 45)
    
    # Step 1: Section details (shared for all students)
    print("\nStep 1: Section Details (shared for all students)")
    
    grade = get_input("> Grade (e.g., 11, 12): ")
    if grade is None:
        return False
    
    section = get_input("> Section (e.g., ICT-A, STEM-B, ACADEMIC 1): ")
    if section is None:
        return False
    
    # Step 2: How many students?
    print("\nStep 2: Student Count")
    student_count = get_int_input("> How many students to register? (1-100): ", min_val=1, max_val=100)
    if student_count is None:
        return False
    
    # Step 3: Starting TAMTAP ID
    next_id = db.get_next_tamtap_id()
    next_id_str = str(next_id).zfill(3)
    
    print(f"\nStep 3: Starting TAMTAP ID")
    print(f"  Next available: {next_id_str}")
    print(f"  If you choose {next_id_str}, IDs will be: {next_id_str} -> {str(next_id + student_count - 1).zfill(3)}")
    
    while True:
        start_input = get_input(f"> Starting TAMTAP ID (Enter for {next_id_str}): ", required=False)
        if start_input is None:
            return False
        
        if not start_input:
            start_tamtap = next_id
            break
        else:
            try:
                start_tamtap = int(start_input)
                if start_tamtap < 1:
                    print("[!] Must be a positive number")
                    continue
                
                # Check if any IDs in the range are taken
                conflicts = []
                for i in range(student_count):
                    tid = str(start_tamtap + i).zfill(3)
                    if db.tamtap_id_exists(tid):
                        conflicts.append(tid)
                
                if conflicts:
                    print(f"[!] These TAMTAP IDs are already taken: {', '.join(conflicts)}")
                    print("[!] Choose a different starting number.")
                    continue
                
                break
            except ValueError:
                print("[!] Please enter a valid number")
                continue
    
    end_tamtap = start_tamtap + student_count - 1
    
    # Confirm batch setup
    print("\n" + "=" * 45)
    print("       BATCH REGISTRATION SETUP")
    print("=" * 45)
    print(f"  Grade:        {grade}")
    print(f"  Section:      {section}")
    print(f"  Students:     {student_count}")
    print(f"  TAMTAP IDs:   {str(start_tamtap).zfill(3)} -> {str(end_tamtap).zfill(3)}")
    print("=" * 45)
    
    confirm = get_input("\n> Start batch registration? (y/n): ", required=False)
    if not confirm or confirm.lower() not in ['y', 'yes']:
        print("[!] Batch registration cancelled")
        input("\nPress Enter to continue...")
        return False
    
    # Step 4: Register each student
    registered = 0
    skipped = 0
    
    for i in range(student_count):
        current_tamtap = str(start_tamtap + i).zfill(3)
        current_num = i + 1
        
        print(f"\n{'=' * 45}")
        print(f"  STUDENT {current_num}/{student_count}  |  TAMTAP ID: {current_tamtap}")
        print(f"  Grade: {grade}  |  Section: {section}")
        print(f"{'=' * 45}")
        
        # Scan NFC
        print("\n  Scan NFC card (or type 'skip' to skip, 'stop' to stop)")
        
        choice = get_input("> Press Enter to scan, 'skip', 'manual', or 'stop': ", required=False)
        
        if choice is None or choice.lower() == 'stop':
            print(f"\n[!] Batch stopped at student {current_num}/{student_count}")
            break
        
        if choice.lower() == 'skip':
            print(f"[!] Skipped student {current_num}")
            skipped += 1
            continue
        
        # Scan card
        if choice.lower() == 'manual':
            nfc_id = get_input("> Enter NFC ID manually: ")
            if nfc_id is None:
                break
        else:
            nfc_id = nfc_reader.scan_blocking()
            if nfc_id is None:
                print("[!] No card detected - skipping")
                skipped += 1
                continue
            print(f"[OK] Card: {nfc_id}")
        
        # Check duplicate NFC
        if db.user_exists(nfc_id):
            user, _ = db.get_user(nfc_id)
            existing_name = user.get("name", "Unknown") if user else "Unknown"
            print(f"[!] NFC already registered to: {existing_name}")
            print("[!] Skipping this card")
            skipped += 1
            continue
        
        # Get name
        first_name = get_input("> First Name: ")
        if first_name is None:
            break
        
        last_name = get_input("> Last Name: ")
        if last_name is None:
            break
        
        full_name = f"{first_name} {last_name}"
        
        # Save student
        user_data = {
            "nfc_id": nfc_id,
            "tamtap_id": current_tamtap,
            "first_name": first_name,
            "last_name": last_name,
            "name": full_name,
            "grade": grade,
            "section": section,
            "registered": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        
        if db.add_user(nfc_id, user_data, "student"):
            registered += 1
            print(f"[OK] #{current_tamtap} {full_name} — SAVED ({registered}/{student_count})")
            logger.info("Batch registered: %s (NFC: %s, ID: %s)", full_name, nfc_id, current_tamtap)
        else:
            print(f"[ERROR] Failed to save {full_name}")
            skipped += 1
    
    # Summary
    print(f"\n{'=' * 45}")
    print(f"  BATCH REGISTRATION COMPLETE")
    print(f"{'=' * 45}")
    print(f"  Section:     {grade} {section}")
    print(f"  Registered:  {registered}")
    print(f"  Skipped:     {skipped}")
    print(f"  Total:       {student_count}")
    print(f"{'=' * 45}")
    
    logger.info("Batch complete: %d registered, %d skipped for %s %s", registered, skipped, grade, section)
    
    input("\nPress Enter to continue...")
    return True

# ========================================
# LIST STUDENTS
# ========================================
def list_students(db):
    """List all registered students, grouped by section"""
    clear_screen()
    print_header(db)
    print("\n[REGISTERED STUDENTS]")
    print("-" * 60)
    
    students, _ = db.get_all_users()
    
    if not students:
        print("\n  No students registered yet.")
        print("\n  Use option 1 or 2 to register students.")
        print("-" * 60)
        input("\nPress Enter to continue...")
        return
    
    # Group by section
    sections = {}
    for user in students:
        sec_key = f"{user.get('grade', '?')} {user.get('section', 'Unknown')}"
        if sec_key not in sections:
            sections[sec_key] = []
        sections[sec_key].append(user)
    
    print(f"\nTotal Students: {len(students)}  |  Sections: {len(sections)}")
    
    for sec_name in sorted(sections.keys()):
        sec_students = sorted(sections[sec_name], key=lambda s: s.get("tamtap_id", "999"))
        print(f"\n  [{sec_name}] — {len(sec_students)} student(s)")
        print("  " + "-" * 50)
        
        for user in sec_students:
            tamtap_id = user.get("tamtap_id", "---")
            nfc_id = user.get("nfc_id", "?")
            name = user.get("name", f"{user.get('first_name', '')} {user.get('last_name', '')}".strip())
            
            print(f"    [{tamtap_id}] {name:<25} NFC: {nfc_id}")
    
    print("\n" + "-" * 60)
    print(f"Total: {len(students)} student(s) across {len(sections)} section(s)")
    print("\nNOTE: Teachers are managed via Admin Panel (web)")
    
    input("\nPress Enter to continue...")

# ========================================
# DELETE STUDENT
# ========================================
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

# ========================================
# MAIN
# ========================================
def main():
    """Main entry point"""
    logger.info("Starting TAMTAP v8.0 Student Registration CLI...")
    
    # Initialize database (MongoDB with JSON fallback)
    db = Database()
    
    # Initialize NFC reader
    nfc_reader = NFCReader()
    
    try:
        while True:
            clear_screen()
            print_header(db)
            print_menu()
            
            choice = get_input("\n> Select option (1-6): ", required=False)
            
            if choice is None:
                continue
            
            if choice == '1':
                register_single(db, nfc_reader)
            elif choice == '2':
                register_batch(db, nfc_reader)
            elif choice == '3':
                list_students(db)
            elif choice == '4':
                delete_student(db, nfc_reader)
            elif choice == '5':
                print("\n[*] Forcing database sync...")
                if db.force_sync():
                    print("[OK] Sync complete (MongoDB -> JSON)")
                else:
                    print("[!] MongoDB not available — nothing to sync")
                input("\nPress Enter to continue...")
            elif choice == '6':
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
