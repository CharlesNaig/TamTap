#!/usr/bin/env python3
"""
TAMTAP Database Module v7.1
Unified database handler with MongoDB primary and JSON fallback/cache.

Sync Strategy:
1. MongoDB is PRIMARY - always use when available
2. JSON is CACHE/BACKUP - stores last known good state
3. On startup: If MongoDB connects → pull latest → update JSON cache
4. On disconnect: Use JSON with last synced data
5. On reconnect: Push pending changes → pull latest updates

Usage:
    from database import Database
    db = Database()
"""

import json
import os
import logging
import threading
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime
from dotenv import load_dotenv

# Load .env from project root
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(_PROJECT_ROOT, ".env"))

# MongoDB support (optional - fallback to JSON if unavailable)
try:
    from pymongo import MongoClient
    from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError
    MONGODB_AVAILABLE = True
except ImportError:
    MONGODB_AVAILABLE = False

# ========================================
# LOGGING
# ========================================
logger = logging.getLogger('TAMTAP_DB')

# ========================================
# CONSTANTS
# ========================================
# JSON file path - in database/ folder relative to project root
DEFAULT_DB_FILE = os.path.join(_PROJECT_ROOT, "database", "tamtap_users.json")

# MongoDB from .env
MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017/")
MONGODB_NAME = os.getenv("MONGODB_NAME", "tamtap")
MONGODB_TIMEOUT = 3000  # 3 seconds connection timeout

# API Server URL for schedule fetch
API_SERVER_URL = os.getenv("API_URL", "http://localhost:3000")
API_TIMEOUT = 2  # seconds

# Default schedule thresholds (used if API unavailable)
DEFAULT_START_TIME = "07:00"
DEFAULT_END_TIME = "17:00"
DEFAULT_GRACE_PERIOD = 20  # minutes after start = late
DEFAULT_ABSENT_THRESHOLD = 60  # minutes after start = absent
EARLY_BUFFER_MINUTES = 30  # Allow tap this many minutes before class starts


# Decline reasons for hardware
class DeclineReason:
    NO_CLASSES_TODAY = "NO_CLASSES_TODAY"
    TOO_EARLY = "TOO_EARLY"
    CLASSES_ENDED = "CLASSES_ENDED"


def time_to_minutes(time_str):
    """Convert HH:MM or HH:MM:SS to minutes since midnight"""
    if not time_str:
        return 0
    parts = str(time_str).split(":")
    hours = int(parts[0])
    minutes = int(parts[1]) if len(parts) > 1 else 0
    return hours * 60 + minutes


def get_day_name():
    """Get current day name in lowercase (matches JS Date.getDay() convention)"""
    # Python weekday(): 0=Monday, 6=Sunday
    # JS getDay(): 0=Sunday, 6=Saturday
    # We use the same names as the API: monday, tuesday, etc.
    days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    return days[datetime.now().weekday()]


def fetch_section_schedule(section):
    """
    Fetch today's schedule for a section from the API.
    Returns: dict with schedule (start/end), grace_period_minutes, absent_threshold_minutes
    """
    if not section:
        return None
    
    try:
        url = f"{API_SERVER_URL}/api/schedules/today/{urllib.parse.quote(section)}"
        req = urllib.request.Request(url, method='GET')
        
        with urllib.request.urlopen(req, timeout=API_TIMEOUT) as response:
            if response.status == 200:
                data = json.loads(response.read().decode('utf-8'))
                if data.get('success'):
                    logger.debug("Fetched schedule for %s: %s", section, data)
                    return data
    except Exception as e:
        logger.debug("Failed to fetch schedule for %s: %s", section, e)
    
    return None


def validate_tap_time(section, arrival_time_str=None):
    """
    Validate if a student can tap at this time based on schedule.
    
    Returns:
        tuple: (is_valid, decline_reason or None, schedule_data)
        - is_valid: True if tap is allowed
        - decline_reason: DeclineReason constant if declined, None if allowed
        - schedule_data: The schedule data for further processing
    """
    if not arrival_time_str:
        arrival_time_str = datetime.now().strftime("%H:%M:%S")
    
    arrival_minutes = time_to_minutes(arrival_time_str)
    schedule_data = fetch_section_schedule(section)
    
    if not schedule_data:
        # No schedule found - use defaults, allow tap
        return True, None, {
            'schedule': {'start': DEFAULT_START_TIME, 'end': DEFAULT_END_TIME},
            'grace_period_minutes': DEFAULT_GRACE_PERIOD,
            'absent_threshold_minutes': DEFAULT_ABSENT_THRESHOLD
        }
    
    today_schedule = schedule_data.get('schedule')
    
    # No classes today (Sunday or Saturday with no schedule)
    if not today_schedule or not today_schedule.get('start'):
        logger.info("No classes scheduled for section %s today", section)
        return False, DeclineReason.NO_CLASSES_TODAY, schedule_data
    
    start_time = today_schedule.get('start')
    end_time = today_schedule.get('end')
    
    start_minutes = time_to_minutes(start_time)
    end_minutes = time_to_minutes(end_time) if end_time else start_minutes + 600  # Default 10 hours
    
    # Check if too early (more than EARLY_BUFFER before class)
    if arrival_minutes < start_minutes - EARLY_BUFFER_MINUTES:
        logger.info("Too early for section %s: arrived %s, class starts %s", 
                   section, arrival_time_str, start_time)
        return False, DeclineReason.TOO_EARLY, schedule_data
    
    # Check if classes ended
    if arrival_minutes > end_minutes:
        logger.info("Classes ended for section %s: arrived %s, class ended %s",
                   section, arrival_time_str, end_time)
        return False, DeclineReason.CLASSES_ENDED, schedule_data
    
    # Tap is valid
    return True, None, schedule_data


def calculate_attendance_status(section, arrival_time_str=None, schedule_data=None):
    """
    Calculate attendance status based on section schedule and arrival time.
    
    Args:
        section: Student's section name
        arrival_time_str: HH:MM:SS format, defaults to current time
        schedule_data: Pre-fetched schedule data (optional, to avoid duplicate API call)
    
    Returns:
        str: 'on_time', 'late', or 'absent'
    """
    if not arrival_time_str:
        arrival_time_str = datetime.now().strftime("%H:%M:%S")
    
    arrival_minutes = time_to_minutes(arrival_time_str)
    
    # Use provided schedule data or fetch
    if not schedule_data:
        schedule_data = fetch_section_schedule(section)
    
    if schedule_data and schedule_data.get('schedule'):
        start_time = schedule_data['schedule'].get('start', DEFAULT_START_TIME)
        grace_period = schedule_data.get('grace_period_minutes', DEFAULT_GRACE_PERIOD)
        absent_threshold = schedule_data.get('absent_threshold_minutes', DEFAULT_ABSENT_THRESHOLD)
    else:
        start_time = DEFAULT_START_TIME
        grace_period = DEFAULT_GRACE_PERIOD
        absent_threshold = DEFAULT_ABSENT_THRESHOLD
    
    start_minutes = time_to_minutes(start_time)
    late_cutoff = start_minutes + grace_period
    absent_cutoff = start_minutes + absent_threshold
    
    if arrival_minutes <= late_cutoff:
        status = "on_time"
    elif arrival_minutes <= absent_cutoff:
        status = "late"
    else:
        status = "absent"
    
    logger.debug(
        "Status: section=%s, arrival=%s (%dm), start=%s (%dm), grace=%dm → %s",
        section, arrival_time_str, arrival_minutes, start_time, start_minutes, 
        grace_period, status
    )
    
    return status


class Database:
    """
    Database handler with MongoDB primary and JSON fallback/cache.
    
    Priority: MongoDB → JSON fallback
    Sync: Bidirectional (push pending, pull latest)
    """
    
    def __init__(self, json_file=None, enable_background_reconnect=True):
        self.json_file = json_file or DEFAULT_DB_FILE
        self.mongo_client = None
        self.mongo_db = None
        self.use_mongodb = False
        self.last_sync = None
        self._reconnect_interval = 30  # seconds
        self._stop_reconnect = threading.Event()
        self._reconnect_thread = None
        
        # Initialize
        self._ensure_json_exists()
        self._connect_mongodb()
        
        # Start background reconnect thread
        if enable_background_reconnect:
            self._start_reconnect_thread()
    
    # ========================================
    # INITIALIZATION
    # ========================================
    def _ensure_json_exists(self):
        """Create JSON file if it doesn't exist"""
        if not os.path.exists(self.json_file):
            self._save_json(self._empty_structure())
            logger.info("Created new JSON database file: %s", self.json_file)
    
    def _empty_structure(self):
        """Return empty database structure"""
        return {
            "students": {},
            "teachers": {},
            "attendance": [],
            "pending_attendance": [],
            "next_tamtap_id": 1,
            "last_sync": None
        }
    
    def _connect_mongodb(self):
        """Attempt to connect to MongoDB"""
        if not MONGODB_AVAILABLE:
            logger.warning("pymongo not installed - using JSON fallback only")
            return False
        
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
            
            # SYNC: Push pending changes THEN pull latest data
            self._push_pending_to_mongodb()
            self._pull_from_mongodb()
            
            return True
            
        except (ConnectionFailure, ServerSelectionTimeoutError) as e:
            logger.warning("MongoDB connection failed: %s - using JSON fallback", e)
            self.use_mongodb = False
            return False
        except Exception as e:
            logger.error("MongoDB init error: %s - using JSON fallback", e)
            self.use_mongodb = False
            return False
    
    def _create_indexes(self):
        """Create required indexes in MongoDB"""
        if not self.use_mongodb:
            return
        try:
            self.mongo_db.students.create_index("nfc_id", unique=True)
            self.mongo_db.students.create_index("tamtap_id")
            self.mongo_db.teachers.create_index("nfc_id", unique=True)
            self.mongo_db.teachers.create_index("tamtap_id")
            self.mongo_db.attendance.create_index([("nfc_id", 1), ("date", 1)])
            self.mongo_db.attendance.create_index("date")
        except Exception as e:
            logger.debug("Index creation note: %s", e)
    
    def _check_mongodb(self):
        """Check if MongoDB is available, attempt reconnect if needed"""
        if not MONGODB_AVAILABLE:
            return False
        
        if self.use_mongodb:
            try:
                self.mongo_client.admin.command('ping')
                return True
            except Exception:
                logger.warning("MongoDB connection lost - switching to JSON fallback")
                self.use_mongodb = False
        else:
            # Try to reconnect periodically
            if self._connect_mongodb():
                logger.info("MongoDB reconnected - syncing data")
                return True
        
        return False
    
    # ========================================
    # SYNC: PUSH (JSON → MongoDB)
    # ========================================
    def _push_pending_to_mongodb(self):
        """Push pending changes from JSON to MongoDB"""
        if not self.use_mongodb:
            return
        
        data = self._load_json()
        synced = 0
        
        # Push pending attendance
        pending = data.get("pending_attendance", [])
        still_pending = []
        
        for record in pending:
            try:
                nfc_id = str(record.get("nfc_id", record.get("uid", "")))
                date_str = record.get("date", "")[:10]
                
                # Check if exists
                existing = self.mongo_db.attendance.find_one({
                    "nfc_id": nfc_id,
                    "date": {"$regex": f"^{date_str}"}
                })
                
                if not existing:
                    self.mongo_db.attendance.insert_one(record)
                synced += 1
            except Exception as e:
                logger.error("Failed to push attendance: %s", e)
                still_pending.append(record)
        
        # Push students not in MongoDB
        for nfc_id, user_data in data.get("students", {}).items():
            try:
                if not self.mongo_db.students.find_one({"nfc_id": nfc_id}):
                    doc = {"nfc_id": nfc_id, **user_data}
                    self.mongo_db.students.insert_one(doc)
                    synced += 1
            except Exception as e:
                logger.debug("Student push note: %s", e)
        
        # Push teachers not in MongoDB
        for nfc_id, user_data in data.get("teachers", {}).items():
            try:
                if not self.mongo_db.teachers.find_one({"nfc_id": nfc_id}):
                    doc = {"nfc_id": nfc_id, **user_data}
                    self.mongo_db.teachers.insert_one(doc)
                    synced += 1
            except Exception as e:
                logger.debug("Teacher push note: %s", e)
        
        # Update JSON
        data["pending_attendance"] = still_pending
        self._save_json(data)
        
        if synced > 0:
            logger.info("Pushed %d records to MongoDB", synced)
    
    # ========================================
    # SYNC: PULL (MongoDB → JSON)
    # ========================================
    def _pull_from_mongodb(self):
        """Pull latest data from MongoDB to JSON cache"""
        if not self.use_mongodb:
            return
        
        try:
            data = self._load_json()
            pulled = 0
            
            # Pull all students from MongoDB
            mongo_students = {}
            for doc in self.mongo_db.students.find({}):
                nfc_id = doc.get("nfc_id")
                if nfc_id:
                    # Remove MongoDB _id for JSON
                    doc_copy = {k: v for k, v in doc.items() if k != "_id"}
                    mongo_students[nfc_id] = doc_copy
                    pulled += 1
            
            # Pull all teachers from MongoDB
            mongo_teachers = {}
            for doc in self.mongo_db.teachers.find({}):
                nfc_id = doc.get("nfc_id")
                if nfc_id:
                    doc_copy = {k: v for k, v in doc.items() if k != "_id"}
                    mongo_teachers[nfc_id] = doc_copy
                    pulled += 1
            
            # Update JSON with MongoDB data (MongoDB is source of truth)
            data["students"] = mongo_students
            data["teachers"] = mongo_teachers
            data["last_sync"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            
            self._save_json(data)
            self.last_sync = data["last_sync"]
            
            if pulled > 0:
                logger.info("Pulled %d users from MongoDB to JSON cache", pulled)
            
        except Exception as e:
            logger.error("Pull from MongoDB failed: %s", e)
    
    # ========================================
    # JSON FILE OPERATIONS
    # ========================================
    def _load_json(self):
        """Load data from JSON file"""
        try:
            if os.path.exists(self.json_file):
                with open(self.json_file, 'r') as f:
                    data = json.load(f)
                    # Ensure all required keys exist
                    for key in ["students", "teachers", "attendance", "pending_attendance"]:
                        data.setdefault(key, {} if key in ["students", "teachers"] else [])
                    data.setdefault("next_tamtap_id", 1)
                    return data
        except Exception as e:
            logger.error("JSON load error: %s", e)
        return self._empty_structure()
    
    def _save_json(self, data):
        """Save data to JSON file"""
        try:
            with open(self.json_file, 'w') as f:
                json.dump(data, f, indent=2)
            return True
        except Exception as e:
            logger.error("JSON save error: %s", e)
            return False
    
    # ========================================
    # STATUS
    # ========================================
    def is_connected(self):
        """Check if MongoDB is currently connected"""
        return self.use_mongodb and self._check_mongodb()
    
    def get_status(self):
        """Get database status info"""
        data = self._load_json()
        return {
            "mongodb_connected": self.use_mongodb,
            "last_sync": data.get("last_sync"),
            "students_count": len(data.get("students", {})),
            "teachers_count": len(data.get("teachers", {})),
            "pending_count": len(data.get("pending_attendance", []))
        }
    
    def force_sync(self):
        """Force a full sync (push then pull)"""
        if self._check_mongodb():
            self._push_pending_to_mongodb()
            self._pull_from_mongodb()
            return True
        return False
    
    # ========================================
    # USER OPERATIONS
    # ========================================
    def get_user(self, nfc_id):
        """
        Look up user by NFC ID.
        Returns: (user_data, role) or (None, None)
        """
        nfc_str = str(nfc_id)
        
        # Try MongoDB first
        if self._check_mongodb():
            try:
                student = self.mongo_db.students.find_one({"nfc_id": nfc_str})
                if student:
                    return {k: v for k, v in student.items() if k != "_id"}, "student"
                
                teacher = self.mongo_db.teachers.find_one({"nfc_id": nfc_str})
                if teacher:
                    return {k: v for k, v in teacher.items() if k != "_id"}, "teacher"
                
                return None, None
            except Exception as e:
                logger.error("MongoDB user lookup error: %s", e)
        
        # Fallback to JSON cache
        data = self._load_json()
        
        if nfc_str in data.get("students", {}):
            return data["students"][nfc_str], "student"
        
        if nfc_str in data.get("teachers", {}):
            return data["teachers"][nfc_str], "teacher"
        
        return None, None
    
    def user_exists(self, nfc_id):
        """Check if user exists"""
        user, _ = self.get_user(nfc_id)
        return user is not None
    
    def add_user(self, nfc_id, user_data, role):
        """
        Add a new user (student or teacher).
        Saves to MongoDB if available, always saves to JSON.
        """
        nfc_str = str(nfc_id)
        collection = "students" if role == "student" else "teachers"
        
        # Prepare user document
        doc = {
            "nfc_id": nfc_str,
            **user_data,
            "registered": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        
        # Try MongoDB first
        if self._check_mongodb():
            try:
                mongo_collection = self.mongo_db[collection]
                mongo_collection.insert_one(doc.copy())
                logger.info("User saved to MongoDB: %s", user_data.get("name", nfc_str))
            except Exception as e:
                logger.error("MongoDB user save error: %s", e)
        
        # Always save to JSON (cache)
        data = self._load_json()
        # Remove nfc_id from doc for JSON structure (nfc_id is the key)
        json_doc = {k: v for k, v in doc.items() if k != "nfc_id"}
        data[collection][nfc_str] = json_doc
        self._save_json(data)
        
        return True
    
    def delete_user(self, nfc_id):
        """
        Delete a user by NFC ID.
        Returns: (success, role) or (False, None)
        """
        nfc_str = str(nfc_id)
        deleted_role = None
        
        # Try MongoDB
        if self._check_mongodb():
            try:
                # Try students
                result = self.mongo_db.students.delete_one({"nfc_id": nfc_str})
                if result.deleted_count > 0:
                    deleted_role = "student"
                else:
                    # Try teachers
                    result = self.mongo_db.teachers.delete_one({"nfc_id": nfc_str})
                    if result.deleted_count > 0:
                        deleted_role = "teacher"
            except Exception as e:
                logger.error("MongoDB delete error: %s", e)
        
        # Also delete from JSON
        data = self._load_json()
        
        if nfc_str in data.get("students", {}):
            del data["students"][nfc_str]
            deleted_role = deleted_role or "student"
        elif nfc_str in data.get("teachers", {}):
            del data["teachers"][nfc_str]
            deleted_role = deleted_role or "teacher"
        
        self._save_json(data)
        
        return deleted_role is not None, deleted_role
    
    def get_all_users(self):
        """
        Get all users.
        Returns: (students_list, teachers_list)
        """
        # Try MongoDB first
        if self._check_mongodb():
            try:
                students = list(self.mongo_db.students.find({}))
                teachers = list(self.mongo_db.teachers.find({}))
                
                # Remove _id
                students = [{k: v for k, v in s.items() if k != "_id"} for s in students]
                teachers = [{k: v for k, v in t.items() if k != "_id"} for t in teachers]
                
                return students, teachers
            except Exception as e:
                logger.error("MongoDB get all users error: %s", e)
        
        # Fallback to JSON
        data = self._load_json()
        
        students = []
        for nfc_id, user in data.get("students", {}).items():
            students.append({"nfc_id": nfc_id, **user})
        
        teachers = []
        for nfc_id, user in data.get("teachers", {}).items():
            teachers.append({"nfc_id": nfc_id, **user})
        
        return students, teachers
    
    # ========================================
    # TAMTAP ID OPERATIONS
    # ========================================
    def get_next_tamtap_id(self):
        """Get the next available TAMTAP ID"""
        max_id = 0
        
        # Check MongoDB
        if self._check_mongodb():
            try:
                # Find max from students
                pipeline = [
                    {"$group": {"_id": None, "max_id": {"$max": {"$toInt": {"$ifNull": ["$tamtap_id", "0"]}}}}}
                ]
                result = list(self.mongo_db.students.aggregate(pipeline))
                if result and result[0].get("max_id"):
                    max_id = max(max_id, result[0]["max_id"])
                
                # Find max from teachers
                result = list(self.mongo_db.teachers.aggregate(pipeline))
                if result and result[0].get("max_id"):
                    max_id = max(max_id, result[0]["max_id"])
            except Exception as e:
                logger.debug("TAMTAP ID lookup note: %s", e)
        
        # Also check JSON
        data = self._load_json()
        
        for user in data.get("students", {}).values():
            try:
                tid = int(user.get("tamtap_id", 0))
                max_id = max(max_id, tid)
            except (ValueError, TypeError):
                pass
        
        for user in data.get("teachers", {}).values():
            try:
                tid = int(user.get("tamtap_id", 0))
                max_id = max(max_id, tid)
            except (ValueError, TypeError):
                pass
        
        # Check stored next_tamtap_id
        stored_next = data.get("next_tamtap_id", 1)
        
        return max(max_id + 1, stored_next)
    
    def tamtap_id_exists(self, tamtap_id):
        """Check if a TAMTAP ID is already in use"""
        tid_str = str(tamtap_id).zfill(3)
        
        # Check MongoDB
        if self._check_mongodb():
            try:
                if self.mongo_db.students.find_one({"tamtap_id": tid_str}):
                    return True
                if self.mongo_db.teachers.find_one({"tamtap_id": tid_str}):
                    return True
            except Exception:
                pass
        
        # Check JSON
        data = self._load_json()
        
        for user in data.get("students", {}).values():
            if user.get("tamtap_id") == tid_str:
                return True
        
        for user in data.get("teachers", {}).values():
            if user.get("tamtap_id") == tid_str:
                return True
        
        return False
    
    # ========================================
    # ATTENDANCE OPERATIONS
    # ========================================
    def is_already_logged_today(self, nfc_id):
        """Check if user already has attendance today"""
        nfc_str = str(nfc_id)
        today = datetime.now().strftime("%Y-%m-%d")
        
        # Try MongoDB
        if self._check_mongodb():
            try:
                existing = self.mongo_db.attendance.find_one({
                    "nfc_id": nfc_str,
                    "date": {"$regex": f"^{today}"}
                })
                if existing:
                    return True
            except Exception as e:
                logger.error("MongoDB attendance check error: %s", e)
        
        # Check JSON (both attendance and pending)
        data = self._load_json()
        
        for record in data.get("attendance", []):
            rec_nfc = str(record.get("nfc_id", record.get("uid", "")))
            rec_date = record.get("date", "")[:10]
            if rec_nfc == nfc_str and rec_date == today:
                return True
        
        for record in data.get("pending_attendance", []):
            rec_nfc = str(record.get("nfc_id", record.get("uid", "")))
            rec_date = record.get("date", "")[:10]
            if rec_nfc == nfc_str and rec_date == today:
                return True
        
        return False
    
    def save_attendance(self, nfc_id, name, role, photo_path=None, user_data=None):
        """
        Save attendance record.
        Returns: True if saved (MongoDB or JSON), False if already logged
        """
        if self.is_already_logged_today(nfc_id):
            logger.info("User %s already logged today", name)
            return False
        
        now = datetime.now()
        photo_filename = os.path.basename(photo_path) if photo_path else None
        time_str = now.strftime("%H:%M:%S")
        
        # Get section for status calculation
        section = user_data.get("section", "") if user_data else ""
        
        # Calculate status based on section schedule
        status = calculate_attendance_status(section, time_str)
        
        # Build record
        record = {
            "nfc_id": str(nfc_id),
            "name": name,
            "role": role,
            "date": now.strftime("%Y-%m-%d %H:%M:%S"),
            "time": time_str,
            "photo": photo_filename,
            "photo_path": photo_path,
            "session": "AM" if now.hour < 12 else "PM",
            "status": status
        }
        
        # Add user details if available
        if user_data:
            record["tamtap_id"] = user_data.get("tamtap_id", "")
            record["email"] = user_data.get("email", "")
            record["first_name"] = user_data.get("first_name", "")
            record["last_name"] = user_data.get("last_name", "")
            record["grade"] = user_data.get("grade", "")
            record["section"] = user_data.get("section", "")
        
        # Try MongoDB first
        if self._check_mongodb():
            try:
                self.mongo_db.attendance.insert_one(record.copy())
                logger.info("Attendance saved to MongoDB: %s (%s)", name, role)
                
                # Also save to JSON as backup
                data = self._load_json()
                data["attendance"].append(record)
                self._save_json(data)
                
                return True
            except Exception as e:
                logger.error("MongoDB attendance save error: %s", e)
        
        # Fallback: Save to JSON pending queue
        data = self._load_json()
        data["pending_attendance"].append(record)
        self._save_json(data)
        logger.info("Attendance saved to JSON (pending sync): %s (%s)", name, role)
        
        return True
    
    def get_attendance(self, date_filter=None):
        """
        Get attendance records.
        date_filter: YYYY-MM-DD format or None for all
        """
        records = []
        
        # Try MongoDB
        if self._check_mongodb():
            try:
                query = {}
                if date_filter:
                    query["date"] = {"$regex": f"^{date_filter}"}
                
                cursor = self.mongo_db.attendance.find(query).sort("date", -1)
                for doc in cursor:
                    records.append({k: v for k, v in doc.items() if k != "_id"})
                return records
            except Exception as e:
                logger.error("MongoDB get attendance error: %s", e)
        
        # Fallback to JSON
        data = self._load_json()
        all_records = data.get("attendance", []) + data.get("pending_attendance", [])
        
        if date_filter:
            records = [r for r in all_records if r.get("date", "").startswith(date_filter)]
        else:
            records = all_records
        
        return sorted(records, key=lambda x: x.get("date", ""), reverse=True)
    
    # ========================================
    # BACKGROUND RECONNECT
    # ========================================
    def _start_reconnect_thread(self):
        """Start background thread to reconnect to MongoDB"""
        if self._reconnect_thread and self._reconnect_thread.is_alive():
            return  # Already running
        
        self._stop_reconnect.clear()
        self._reconnect_thread = threading.Thread(
            target=self._reconnect_loop,
            daemon=True,
            name="MongoDB-Reconnect"
        )
        self._reconnect_thread.start()
        logger.info("Background reconnect thread started (interval: %ds)", self._reconnect_interval)
    
    def _reconnect_loop(self):
        """Background loop to check and reconnect to MongoDB"""
        while not self._stop_reconnect.is_set():
            # Wait for interval (interruptible)
            if self._stop_reconnect.wait(timeout=self._reconnect_interval):
                break  # Stop signal received
            
            # Skip if already connected
            if self.use_mongodb:
                # Verify connection is still alive
                try:
                    if self.mongo_client:
                        self.mongo_client.admin.command('ping')
                        continue  # Still connected, nothing to do
                except Exception:
                    logger.warning("MongoDB connection lost, will attempt reconnect")
                    self.use_mongodb = False
            
            # Attempt reconnect
            if not self.use_mongodb:
                logger.info("Attempting MongoDB reconnect...")
                try:
                    if self.mongo_client:
                        try:
                            self.mongo_client.close()
                        except Exception:
                            pass
                    
                    self.mongo_client = MongoClient(
                        MONGODB_URI,
                        serverSelectionTimeoutMS=MONGODB_TIMEOUT
                    )
                    self.mongo_client.admin.command('ping')
                    self.mongo_db = self.mongo_client[MONGODB_NAME]
                    self.use_mongodb = True
                    
                    logger.info("MongoDB reconnected successfully!")
                    
                    # Sync on reconnect
                    self._push_pending_to_mongodb()
                    self._pull_from_mongodb()
                    
                except Exception as e:
                    logger.debug("MongoDB reconnect failed: %s", e)
                    self.use_mongodb = False
    
    def stop_reconnect(self):
        """Stop the background reconnect thread"""
        self._stop_reconnect.set()
        if self._reconnect_thread and self._reconnect_thread.is_alive():
            self._reconnect_thread.join(timeout=2)
            logger.info("Background reconnect thread stopped")
    
    # ========================================
    # STATUS & UTILITIES
    # ========================================
    def get_status(self):
        """Get database status information"""
        data = self._load_json()
        
        return {
            "mongodb_connected": self._check_mongodb(),
            "last_sync": self.last_sync,
            "pending_count": len(data.get("pending_attendance", [])),
            "json_file": self.json_file
        }
    
    def is_connected(self):
        """Check if MongoDB is connected (alias for _check_mongodb)"""
        return self._check_mongodb()
    
    # ========================================
    # CLEANUP
    # ========================================
    def close(self):
        """Close database connections and stop background thread"""
        # Stop reconnect thread first
        self.stop_reconnect()
        
        # Close MongoDB connection
        if self.mongo_client:
            try:
                self.mongo_client.close()
            except Exception:
                pass
        
        logger.info("Database closed")
