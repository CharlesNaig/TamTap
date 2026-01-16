#!/usr/bin/env python3
"""
TAMTAP v6.3 REGISTRATION CLI
Student/Teacher Registration + NFC Integration
MongoDB with JSON fallback for offline mode
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

# GPIO setup for RFID
GPIO.setwarnings(False)
GPIO.setmode(GPIO.BCM)

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
            "pending_attendance": []
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
    
    def add_user(self, nfc_id, user_data, role):
        """Add new user (student or teacher)"""
        nfc_str = str(nfc_id)
        collection = "students" if role == "student" else "teachers"
        
        # Always save to JSON as backup
        json_data = self._load_json()
        json_data[collection][nfc_str] = user_data
        self._save_json(json_data)
        
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
    print("   TAMTAP v6.3 - REGISTRATION SYSTEM")
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
            nfc_id = user.get("nfc_id", "?")
            name = user.get("name", f"{user.get('first_name', '')} {user.get('last_name', '')}".strip())
            grade = user.get("grade", "")
            section = user.get("section", "")
            grade_sec = f"{grade} {section}".strip() if grade or section else "N/A"
            email = user.get("email", "")
            
            print(f"  [{nfc_id}]")
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
            nfc_id = user.get("nfc_id", "?")
            name = user.get("name", f"{user.get('first_name', '')} {user.get('last_name', '')}".strip())
            email = user.get("email", "")
            
            print(f"  [{nfc_id}]")
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
    logger.info("Starting TAMTAP v6.3 Registration CLI...")
    
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
