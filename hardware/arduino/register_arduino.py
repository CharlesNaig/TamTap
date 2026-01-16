#!/usr/bin/env python3
"""
TAMTAP v6.3 REGISTRATION CLI - ARDUINO VERSION
Student/Teacher Registration + NFC Integration via Arduino Uno
MongoDB with JSON fallback for offline mode
CLI version for Windows/Linux/Mac with Arduino RFID reader

Hardware: Arduino Uno + RC522 RFID Module
Communication: Serial (USB)
"""

import json
import os
import sys
import signal
import logging
import time
from datetime import datetime

# Serial communication for Arduino
try:
    import serial
    import serial.tools.list_ports
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False
    print("[!] pyserial not installed. Run: pip install pyserial")

# MongoDB support (optional - fallback to JSON if unavailable)
try:
    from pymongo import MongoClient
    from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError
    MONGODB_AVAILABLE = True
except ImportError:
    MONGODB_AVAILABLE = False

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
MONGODB_URI = "mongodb://naig:naig1229@162.243.218.87:27017/"
MONGODB_NAME = "tamtap"
MONGODB_TIMEOUT = 3000  # 3 seconds connection timeout

# Arduino Serial settings
ARDUINO_BAUD_RATE = 9600
ARDUINO_TIMEOUT = 2  # seconds for serial read timeout

# ========================================
# DATABASE CLASS (MongoDB + JSON Fallback)
# ========================================
class Database:
    """Database handler with MongoDB primary and JSON fallback"""
    
    def __init__(self):
        self.mongo_client = None
        self.mongo_db = None
        self.use_mongodb = False
        self._init_mongodb()
    
    def _init_mongodb(self):
        """Initialize MongoDB connection"""
        if not MONGODB_AVAILABLE:
            logger.warning("PyMongo not installed - using JSON fallback")
            return
        
        try:
            self.mongo_client = MongoClient(
                MONGODB_URI,
                serverSelectionTimeoutMS=MONGODB_TIMEOUT
            )
            # Test connection
            self.mongo_client.admin.command('ping')
            self.mongo_db = self.mongo_client[MONGODB_NAME]
            self.use_mongodb = True
            logger.info("MongoDB connected successfully")
            
            # Create indexes
            self._create_indexes()
            
            # Sync pending JSON data to MongoDB
            self._sync_json_to_mongodb()
            
        except (ConnectionFailure, ServerSelectionTimeoutError) as e:
            logger.warning("MongoDB connection failed: %s - using JSON fallback", e)
            self.use_mongodb = False
        except Exception as e:
            logger.error("MongoDB init error: %s - using JSON fallback", e)
            self.use_mongodb = False
    
    def _create_indexes(self):
        """Create required indexes in MongoDB"""
        if not self.use_mongodb:
            return
        try:
            self.mongo_db.students.create_index("nfc_id", unique=True)
            self.mongo_db.teachers.create_index("nfc_id", unique=True)
            self.mongo_db.attendance.create_index([("uid", 1), ("date", 1)])
            logger.info("MongoDB indexes created")
        except Exception as e:
            logger.warning("Index creation warning: %s", e)
    
    def _sync_json_to_mongodb(self):
        """Sync pending JSON data to MongoDB when connection restored"""
        if not self.use_mongodb or not os.path.exists(DB_FILE):
            return
        
        try:
            with open(DB_FILE, 'r') as f:
                json_data = json.load(f)
            
            synced_count = 0
            
            # Sync students
            for nfc_id, data in json_data.get("students", {}).items():
                if not self.mongo_db.students.find_one({"nfc_id": nfc_id}):
                    doc = {"nfc_id": nfc_id, **data}
                    self.mongo_db.students.insert_one(doc)
                    synced_count += 1
            
            # Sync teachers
            for nfc_id, data in json_data.get("teachers", {}).items():
                if not self.mongo_db.teachers.find_one({"nfc_id": nfc_id}):
                    doc = {"nfc_id": nfc_id, **data}
                    self.mongo_db.teachers.insert_one(doc)
                    synced_count += 1
            
            # Sync pending attendance (offline records)
            pending = json_data.get("pending_attendance", [])
            for record in pending:
                # Check if already exists
                exists = self.mongo_db.attendance.find_one({
                    "uid": record.get("uid"),
                    "date": {"$regex": f"^{record.get('date', '')[:10]}"}
                })
                if not exists:
                    self.mongo_db.attendance.insert_one(record)
                    synced_count += 1
            
            if synced_count > 0:
                logger.info("Synced %d records from JSON to MongoDB", synced_count)
                # Clear pending attendance after sync
                json_data["pending_attendance"] = []
                with open(DB_FILE, 'w') as f:
                    json.dump(json_data, f, indent=2)
                    
        except Exception as e:
            logger.error("JSON to MongoDB sync error: %s", e)
    
    def _load_json(self):
        """Load data from JSON file"""
        try:
            if os.path.exists(DB_FILE):
                with open(DB_FILE, 'r') as f:
                    return json.load(f)
        except Exception as e:
            logger.error("JSON load error: %s", e)
        return {
            "students": {},
            "teachers": {},
            "attendance": [],
            "pending_attendance": [],
            "next_tamtap_id": 1
        }
    
    def _save_json(self, data):
        """Save data to JSON file"""
        try:
            with open(DB_FILE, 'w') as f:
                json.dump(data, f, indent=2)
            return True
        except Exception as e:
            logger.error("JSON save error: %s", e)
            return False
    
    def is_connected(self):
        """Check if MongoDB is connected"""
        if not self.use_mongodb:
            return False
        try:
            self.mongo_client.admin.command('ping')
            return True
        except Exception:
            self.use_mongodb = False
            return False
    
    def get_user(self, nfc_id):
        """Get user by NFC ID"""
        nfc_str = str(nfc_id)
        
        if self.is_connected():
            try:
                # Check students
                student = self.mongo_db.students.find_one({"nfc_id": nfc_str})
                if student:
                    return student, "student"
                
                # Check teachers
                teacher = self.mongo_db.teachers.find_one({"nfc_id": nfc_str})
                if teacher:
                    return teacher, "teacher"
                
                return None, None
            except Exception as e:
                logger.error("MongoDB get_user error: %s", e)
        
        # Fallback to JSON
        data = self._load_json()
        if nfc_str in data.get("students", {}):
            return data["students"][nfc_str], "student"
        if nfc_str in data.get("teachers", {}):
            return data["teachers"][nfc_str], "teacher"
        
        return None, None
    
    def user_exists(self, nfc_id):
        """Check if user exists"""
        user, role = self.get_user(nfc_id)
        return user is not None
    
    def tamtap_id_exists(self, tamtap_id):
        """Check if tamtap_id already exists"""
        tamtap_str = str(tamtap_id).zfill(3)
        
        if self.is_connected():
            try:
                if self.mongo_db.students.find_one({"tamtap_id": tamtap_str}):
                    return True
                if self.mongo_db.teachers.find_one({"tamtap_id": tamtap_str}):
                    return True
            except Exception as e:
                logger.error("MongoDB tamtap_id check error: %s", e)
        
        # Check JSON
        data = self._load_json()
        for user in data.get("students", {}).values():
            if user.get("tamtap_id") == tamtap_str:
                return True
        for user in data.get("teachers", {}).values():
            if user.get("tamtap_id") == tamtap_str:
                return True
        
        return False
    
    def get_next_tamtap_id(self):
        """Get next available tamtap_id (auto-increment)"""
        next_id = 1
        
        # Get from MongoDB
        if self.is_connected():
            try:
                # Find highest tamtap_id
                for collection in ['students', 'teachers']:
                    cursor = self.mongo_db[collection].find({}, {"tamtap_id": 1}).sort("tamtap_id", -1).limit(1)
                    for doc in cursor:
                        try:
                            doc_id = int(doc.get("tamtap_id", "0"))
                            next_id = max(next_id, doc_id + 1)
                        except ValueError:
                            pass
            except Exception as e:
                logger.error("MongoDB get_next_tamtap_id error: %s", e)
        
        # Also check JSON
        data = self._load_json()
        json_next = data.get("next_tamtap_id", 1)
        next_id = max(next_id, json_next)
        
        # Check all existing IDs to be safe
        for user in data.get("students", {}).values():
            try:
                user_id = int(user.get("tamtap_id", "0"))
                next_id = max(next_id, user_id + 1)
            except ValueError:
                pass
        for user in data.get("teachers", {}).values():
            try:
                user_id = int(user.get("tamtap_id", "0"))
                next_id = max(next_id, user_id + 1)
            except ValueError:
                pass
        
        return next_id
    
    def _update_next_tamtap_id(self, used_id):
        """Update next_tamtap_id counter after saving"""
        data = self._load_json()
        try:
            used_int = int(used_id)
            current_next = data.get("next_tamtap_id", 1)
            if used_int >= current_next:
                data["next_tamtap_id"] = used_int + 1
                self._save_json(data)
        except ValueError:
            pass

    def add_user(self, nfc_id, user_data, role):
        """Add new user (student or teacher)"""
        nfc_str = str(nfc_id)
        collection = "students" if role == "student" else "teachers"
        
        # Always save to JSON as backup
        json_data = self._load_json()
        json_data[collection][nfc_str] = user_data
        self._save_json(json_data)
        
        # Update next_tamtap_id counter
        if "tamtap_id" in user_data:
            self._update_next_tamtap_id(user_data["tamtap_id"])
        
        # Try to save to MongoDB
        if self.is_connected():
            try:
                doc = {"nfc_id": nfc_str, **user_data}
                self.mongo_db[collection].insert_one(doc)
                logger.info("User saved to MongoDB: %s", nfc_str)
                return True
            except Exception as e:
                logger.warning("MongoDB save failed: %s - saved to JSON", e)
        
        logger.info("User saved to JSON: %s", nfc_str)
        return True
    
    def delete_user(self, nfc_id):
        """Delete user by NFC ID"""
        nfc_str = str(nfc_id)
        deleted = False
        
        # Delete from JSON
        json_data = self._load_json()
        if nfc_str in json_data.get("students", {}):
            del json_data["students"][nfc_str]
            deleted = True
        elif nfc_str in json_data.get("teachers", {}):
            del json_data["teachers"][nfc_str]
            deleted = True
        
        if deleted:
            self._save_json(json_data)
        
        # Delete from MongoDB
        if self.is_connected():
            try:
                result = self.mongo_db.students.delete_one({"nfc_id": nfc_str})
                if result.deleted_count == 0:
                    self.mongo_db.teachers.delete_one({"nfc_id": nfc_str})
                logger.info("User deleted from MongoDB: %s", nfc_str)
            except Exception as e:
                logger.warning("MongoDB delete error: %s", e)
        
        return deleted
    
    def get_all_users(self):
        """Get all users"""
        if self.is_connected():
            try:
                students = list(self.mongo_db.students.find({}, {"_id": 0}))
                teachers = list(self.mongo_db.teachers.find({}, {"_id": 0}))
                return students, teachers
            except Exception as e:
                logger.error("MongoDB get_all_users error: %s", e)
        
        # Fallback to JSON
        json_data = self._load_json()
        students = [{"nfc_id": k, **v} for k, v in json_data.get("students", {}).items()]
        teachers = [{"nfc_id": k, **v} for k, v in json_data.get("teachers", {}).items()]
        return students, teachers
    
    def close(self):
        """Close database connection"""
        if self.mongo_client:
            self.mongo_client.close()
            logger.info("MongoDB connection closed")


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
    print("=" * 50)
    print("   TAMTAP v6.3 - REGISTRATION SYSTEM")
    print("   NFC-Based Attendance | Arduino CLI Version")
    db_status = "[MongoDB]" if db.is_connected() else "[JSON Fallback]"
    arduino_status = f"[Arduino: {nfc_reader.port}]" if nfc_reader.connected else "[Arduino: NOT CONNECTED]"
    print(f"   Database: {db_status}")
    print(f"   Reader:   {arduino_status}")
    print("=" * 50)

def print_menu():
    """Print main menu"""
    print("\n[MAIN MENU]")
    print("-" * 30)
    print("  1. Register Student")
    print("  2. Register Teacher")
    print("  3. List All Users")
    print("  4. Delete User")
    print("  5. Reconnect Arduino")
    print("  6. Exit")
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
    print_header(db, nfc_reader)
    
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
            # Use auto-generated ID
            tamtap_id = next_id_str
            break
        else:
            # Validate manual input (must be numeric)
            try:
                tamtap_num = int(tamtap_input)
                if tamtap_num < 1:
                    print("[!] ID must be a positive number")
                    continue
                tamtap_id = str(tamtap_num).zfill(3)
                
                # Check if already exists
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

def list_users(db, nfc_reader):
    """List all registered users"""
    clear_screen()
    print_header(db, nfc_reader)
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
    print_header(db, nfc_reader)
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
    logger.info("Starting TAMTAP v6.3 Registration CLI (Arduino Version)...")
    
    # Initialize database (MongoDB with JSON fallback)
    db = Database()
    
    # Initialize Arduino NFC reader
    nfc_reader = ArduinoNFCReader()
    
    try:
        while True:
            clear_screen()
            print_header(db, nfc_reader)
            print_menu()
            
            choice = get_input("\n> Select option (1-6): ", required=False)
            
            if choice is None:
                continue
            
            if choice == '1':
                register_user("student", db, nfc_reader)
            elif choice == '2':
                register_user("teacher", db, nfc_reader)
            elif choice == '3':
                list_users(db, nfc_reader)
            elif choice == '4':
                delete_user(db, nfc_reader)
            elif choice == '5':
                nfc_reader = reconnect_arduino(nfc_reader)
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
