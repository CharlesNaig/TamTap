#!/usr/bin/env python3
"""
TAMTAP v8.0 - Student Registration CLI (Arduino Version)
Uses shared Database module with MongoDB + JSON sync

Features:
  - Single student registration (NFC scan via Arduino)
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
import time
from datetime import datetime

# Add parent directory to path for database import
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Serial communication for Arduino
try:
    import serial
    import serial.tools.list_ports
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False
    print("[!] pyserial not installed. Run: pip install pyserial")

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

# Arduino Serial settings
ARDUINO_BAUD_RATE = 9600
ARDUINO_TIMEOUT = 2  # seconds for serial read timeout


# ========================================
# ARDUINO NFC READER (Serial Communication)
# ========================================
class ArduinoNFCReader:
    """Arduino-based NFC Reader via Serial communication"""
    
    def __init__(self, port=None):
        self.serial = None
        self.port = port
        self.connected = False
        
        if not SERIAL_AVAILABLE:
            logger.error("pyserial not available - install with: pip install pyserial")
            return
        
        self._connect(port)
    
    def _find_arduino_port(self):
        """Auto-detect Arduino port"""
        ports = serial.tools.list_ports.comports()
        
        # Common Arduino identifiers
        arduino_keywords = ['arduino', 'ch340', 'ch341', 'usb serial', 'usb-serial', 'ftdi']
        
        for port in ports:
            port_desc = f"{port.description} {port.manufacturer or ''}".lower()
            for keyword in arduino_keywords:
                if keyword in port_desc:
                    logger.info("Found Arduino on: %s (%s)", port.device, port.description)
                    return port.device
        
        # If no Arduino found, list all ports
        if ports:
            logger.warning("Arduino not auto-detected. Available ports:")
            for port in ports:
                logger.info("  - %s: %s", port.device, port.description)
            # Return first available port as fallback
            return ports[0].device
        
        return None
    
    def _connect(self, port=None):
        """Connect to Arduino"""
        if not SERIAL_AVAILABLE:
            return
        
        try:
            # Find port if not specified
            if port is None:
                port = self._find_arduino_port()
            
            if port is None:
                logger.error("No serial ports found!")
                return
            
            self.port = port
            self.serial = serial.Serial(
                port=port,
                baudrate=ARDUINO_BAUD_RATE,
                timeout=ARDUINO_TIMEOUT
            )
            
            # Wait for Arduino reset (Arduino resets on serial connect)
            # Raspberry Pi may need longer wait time
            logger.info("Waiting for Arduino to reset...")
            time.sleep(3)
            
            # Clear buffer
            self.serial.reset_input_buffer()
            
            # Send a newline to clear any partial commands
            self.serial.write(b"\n")
            time.sleep(0.2)
            self.serial.reset_input_buffer()
            
            # Wait for READY message
            logger.info("Waiting for READY signal...")
            start_time = time.time()
            while time.time() - start_time < 5:
                if self.serial.in_waiting:
                    response = self.serial.readline().decode('utf-8', errors='ignore').strip()
                    logger.info("Arduino says: %s", response)
                    if response == "READY":
                        self.connected = True
                        logger.info("Arduino connected on %s", port)
                        return
                    elif response.startswith("INFO:"):
                        logger.info("Arduino: %s", response)
                    elif response.startswith("ERROR:"):
                        logger.error("Arduino: %s", response)
                time.sleep(0.1)
            
            # Try sending PING to verify connection
            logger.info("No READY received, trying PING...")
            self.serial.write(b"PING\n")
            time.sleep(0.3)
            if self.serial.in_waiting:
                response = self.serial.readline().decode('utf-8', errors='ignore').strip()
                if response == "PONG":
                    logger.info("Arduino responded to PING - connected!")
                    self.connected = True
                    return
            
            logger.warning("Arduino connected but no READY/PONG received")
            self.connected = True  # Proceed anyway
            
        except serial.SerialException as e:
            logger.error("Serial connection failed: %s", e)
            self.serial = None
        except Exception as e:
            logger.error("Arduino connection error: %s", e)
            self.serial = None
    
    def is_connected(self):
        """Check if Arduino is connected"""
        if not self.serial or not self.connected:
            return False
        try:
            self.serial.write(b"PING\n")
            time.sleep(0.1)
            if self.serial.in_waiting:
                response = self.serial.readline().decode('utf-8', errors='ignore').strip()
                return response == "PONG"
        except Exception:
            self.connected = False
        return False
    
    def scan_blocking(self, timeout=30):
        """Blocking NFC scan with timeout"""
        if not self.serial or not self.connected:
            logger.error("Arduino not connected")
            return None
        
        print(f"\n[*] Tap NFC card now... (waiting {timeout}s)")
        print("[*] Press Ctrl+C to cancel\n")
        
        try:
            # Clear buffer
            self.serial.reset_input_buffer()
            
            # Send scan command with retry
            for attempt in range(3):
                self.serial.write(b"SCAN\n")
                
                # Wait for ACK
                ack_start = time.time()
                while time.time() - ack_start < 1:
                    if self.serial.in_waiting:
                        response = self.serial.readline().decode('utf-8', errors='ignore').strip()
                        logger.info("Arduino response: %s", response)
                        if response == "ACK:SCANNING":
                            logger.info("ACK received, scanning...")
                            break
                        elif response.startswith("CARD:"):
                            # Card already detected!
                            nfc_id = response.split(":", 1)[1]
                            logger.info("NFC scanned: %s", nfc_id)
                            return nfc_id
                    time.sleep(0.05)
                else:
                    # No ACK received, retry
                    if attempt < 2:
                        logger.warning("No ACK (attempt %d), retrying...", attempt + 1)
                        time.sleep(0.3)
                        continue
                    else:
                        logger.warning("No ACK after 3 attempts, proceeding anyway")
                break
            
            # Wait for card
            start_time = time.time()
            while time.time() - start_time < timeout:
                if self.serial.in_waiting:
                    response = self.serial.readline().decode('utf-8', errors='ignore').strip()
                    
                    if response.startswith("CARD:"):
                        nfc_id = response.split(":", 1)[1]
                        logger.info("NFC scanned: %s", nfc_id)
                        return nfc_id
                
                time.sleep(0.05)
            
            # Timeout - stop scanning
            self.serial.write(b"STOP\n")
            print("[!] Timeout - no card detected")
            return None
            
        except KeyboardInterrupt:
            print("\n[!] Scan cancelled")
            if self.serial:
                self.serial.write(b"STOP\n")
            return None
        except Exception as e:
            logger.error("NFC scan error: %s", e)
            return None
    
    def close(self):
        """Close serial connection"""
        if self.serial:
            try:
                self.serial.write(b"STOP\n")
                self.serial.close()
            except Exception:
                pass
            logger.info("Arduino connection closed")


# ========================================
# CLI INTERFACE
# ========================================
def clear_screen():
    """Clear terminal screen"""
    os.system('cls' if os.name == 'nt' else 'clear')

def print_header(db, nfc_reader):
    """Print application header with DB and Arduino status"""
    print("=" * 55)
    print("   TAMTAP v8.0 - STUDENT REGISTRATION")
    print("   NFC-Based Attendance | Arduino CLI Version")
    db_status = "[MongoDB]" if db.is_connected() else "[JSON Fallback]"
    arduino_status = f"[Arduino: {nfc_reader.port}]" if nfc_reader.connected else "[Arduino: NOT CONNECTED]"
    print(f"   Database: {db_status}")
    print(f"   Reader:   {arduino_status}")
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
    print("  5. Reconnect Arduino")
    print("  6. Sync Database (Force)")
    print("  7. Exit")
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

def register_single(db, nfc_reader):
    """Register a single student via NFC card"""
    clear_screen()
    print_header(db, nfc_reader)
    
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
        if not nfc_reader.connected:
            print("[!] Arduino not connected. Use 'manual' mode or reconnect.")
            input("\nPress Enter to continue...")
            return False
        
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
    print_header(db, nfc_reader)
    
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
            if not nfc_reader.connected:
                print("[!] Arduino not connected. Type 'manual' to enter ID manually.")
                skipped += 1
                continue
            
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

def list_students(db, nfc_reader):
    """List all registered students, grouped by section"""
    clear_screen()
    print_header(db, nfc_reader)
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

def delete_student(db, nfc_reader):
    """Delete a registered student"""
    clear_screen()
    print_header(db, nfc_reader)
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
        if not nfc_reader.connected:
            print("[!] Arduino not connected. Use 'manual' mode or reconnect.")
            input("\nPress Enter to continue...")
            return False
        
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
    
    print("\n  [1] Archive (can restore later)")
    print("  [2] Permanent delete (no recovery)")
    choice = get_input("\n> Choose action (1/2): ", required=False)
    
    if choice == '1':
        confirm = get_input("\n> ARCHIVE this student? (type 'YES' to confirm): ", required=False)
        if confirm == 'YES':
            success, role = db.archive_user(nfc_id)
            if success:
                print(f"\n[SUCCESS] Student archived: {name}")
                logger.info("Student archived: %s (NFC: %s)", name, nfc_id)
            else:
                print("\n[ERROR] Failed to archive student")
                return False
        else:
            print("\n[!] Archive cancelled")
    elif choice == '2':
        confirm = get_input("\n> PERMANENTLY DELETE this student? (type 'DELETE' to confirm): ", required=False)
        if confirm == 'DELETE':
            success, role = db.delete_user(nfc_id)
            if success:
                print(f"\n[SUCCESS] Student permanently deleted: {name}")
                logger.info("Student permanently deleted: %s (NFC: %s)", name, nfc_id)
            else:
                print("\n[ERROR] Failed to delete student")
                return False
        else:
            print("\n[!] Deletion cancelled")
    else:
        print("\n[!] Cancelled")
    
    input("\nPress Enter to continue...")
    return True

def reconnect_arduino(nfc_reader):
    """Reconnect to Arduino"""
    clear_screen()
    print("\n[RECONNECT ARDUINO]")
    print("-" * 30)
    
    # List available ports
    if SERIAL_AVAILABLE:
        ports = serial.tools.list_ports.comports()
        if ports:
            print("\nAvailable ports:")
            for i, port in enumerate(ports, 1):
                print(f"  {i}. {port.device} - {port.description}")
            print()
            
            choice = get_input("> Enter port number (or press Enter for auto): ", required=False)
            
            if choice is None:
                return nfc_reader
            
            selected_port = None
            if choice:
                try:
                    idx = int(choice) - 1
                    if 0 <= idx < len(ports):
                        selected_port = ports[idx].device
                except ValueError:
                    # Treat as port name
                    selected_port = choice
            
            # Close existing connection
            nfc_reader.close()
            
            # Create new connection
            new_reader = ArduinoNFCReader(port=selected_port)
            
            if new_reader.connected:
                print(f"\n[SUCCESS] Connected to {new_reader.port}")
            else:
                print("\n[ERROR] Failed to connect")
            
            input("\nPress Enter to continue...")
            return new_reader
        else:
            print("\n[ERROR] No serial ports found")
    else:
        print("\n[ERROR] pyserial not installed")
    
    input("\nPress Enter to continue...")
    return nfc_reader

def main():
    """Main entry point"""
    logger.info("Starting TAMTAP v8.0 Registration CLI (Arduino Version)...")
    
    # Initialize database (MongoDB with JSON fallback)
    db = Database()
    
    # Initialize Arduino NFC reader
    nfc_reader = ArduinoNFCReader()
    
    try:
        while True:
            clear_screen()
            print_header(db, nfc_reader)
            print_menu()
            
            choice = get_input("\n> Select option (1-7): ", required=False)
            
            if choice is None:
                continue
            
            if choice == '1':
                register_single(db, nfc_reader)
            elif choice == '2':
                register_batch(db, nfc_reader)
            elif choice == '3':
                list_students(db, nfc_reader)
            elif choice == '4':
                delete_student(db, nfc_reader)
            elif choice == '5':
                nfc_reader = reconnect_arduino(nfc_reader)
            elif choice == '6':
                print("\n[*] Forcing database sync...")
                if db.force_sync():
                    print("[OK] Sync complete (MongoDB -> JSON)")
                else:
                    print("[!] MongoDB not available — nothing to sync")
                input("\nPress Enter to continue...")
            elif choice == '7':
                print("\n[*] Goodbye!")
                break
            else:
                print("\n[!] Invalid option")
                input("Press Enter to continue...")
                
    except KeyboardInterrupt:
        print("\n\n[*] Interrupted - Exiting...")
    finally:
        db.close()
        nfc_reader.close()
        logger.info("Registration CLI closed")


# ========================================
# SIGNAL HANDLER
# ========================================
def signal_handler(sig, frame):
    """Handle shutdown signals"""
    print("\n\n[*] Shutdown signal received")
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)


# ========================================
# RUN
# ========================================
if __name__ == "__main__":
    main()
