#!/usr/bin/env python3
"""
TAMTAP v7.1 ADMIN CLI
Administrative Tools for TAMTAP Attendance System
Uses shared Database module with MongoDB + JSON sync
- Archive attendance records
- Manage users (students/teachers)
- View/export data
- System maintenance
"""

import json
import os
import sys
import signal
import logging
import shutil
from datetime import datetime, timedelta

# Shared Database module
from database import Database as SharedDatabase

# ========================================
# LOGGING CONFIGURATION
# ========================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('TAMTAP_ADMIN')

# ========================================
# CONSTANTS
# ========================================
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCHIVE_DIR = os.path.join(_PROJECT_ROOT, "database", "archives")
PHOTO_DIR = os.path.join(_PROJECT_ROOT, "assets", "attendance_photos")

# Create directories
os.makedirs(ARCHIVE_DIR, exist_ok=True)
os.makedirs(PHOTO_DIR, exist_ok=True)


# ========================================
# DATABASE CLASS (Extended)
# ========================================
class Database(SharedDatabase):
    """Extended Database with admin-specific methods"""
    
    def archive_attendance(self, date_str):
        """Archive attendance records for a specific date"""
        records = self.get_attendance(date_str)
        
        if not records:
            return 0, None
        
        # Create archive file
        archive_filename = os.path.join(ARCHIVE_DIR, f"attendance_{date_str.replace('-', '')}.json")
        
        # Load existing archive if exists
        existing = []
        if os.path.exists(archive_filename):
            try:
                with open(archive_filename, 'r') as f:
                    existing = json.load(f)
            except Exception:
                pass
        
        # Merge records (avoid duplicates)
        existing_ids = {(r.get("nfc_id"), r.get("date")) for r in existing}
        for record in records:
            key = (record.get("nfc_id"), record.get("date"))
            if key not in existing_ids:
                existing.append(record)
        
        # Save archive
        with open(archive_filename, 'w') as f:
            json.dump(existing, f, indent=2)
        
        return len(records), archive_filename
    
    def clear_attendance(self, date_str=None, clear_all=False):
        """Clear attendance records from both MongoDB and JSON"""
        deleted_count = 0
        
        # Clear from MongoDB
        if self._check_mongodb():
            try:
                if clear_all:
                    result = self.mongo_db.attendance.delete_many({})
                elif date_str:
                    result = self.mongo_db.attendance.delete_many({"date": {"$regex": f"^{date_str}"}})
                else:
                    result = None
                
                if result:
                    deleted_count = result.deleted_count
            except Exception as e:
                logger.error("MongoDB clear error: %s", e)
        
        # Clear from JSON
        data = self._load_json()
        original_count = len(data.get("attendance", [])) + len(data.get("pending_attendance", []))
        
        if clear_all:
            data["attendance"] = []
            data["pending_attendance"] = []
        elif date_str:
            data["attendance"] = [r for r in data.get("attendance", []) 
                                  if not r.get("date", "").startswith(date_str)]
            data["pending_attendance"] = [r for r in data.get("pending_attendance", []) 
                                          if not r.get("date", "").startswith(date_str)]
        
        new_count = len(data.get("attendance", [])) + len(data.get("pending_attendance", []))
        deleted_count = max(deleted_count, original_count - new_count)
        
        self._save_json(data)
        
        return deleted_count
    
    def get_stats(self):
        """Get database statistics"""
        students, teachers = self.get_all_users()
        
        today = datetime.now().strftime("%Y-%m-%d")
        today_attendance = self.get_attendance(today)
        total_attendance = len(self.get_attendance())
        
        # Get status from parent
        status = self.get_status()
        
        return {
            "students": len(students),
            "teachers": len(teachers),
            "today_attendance": len(today_attendance),
            "total_attendance": total_attendance,
            "pending_sync": status.get("pending_count", 0),
            "mongodb_connected": status.get("mongodb_connected", False),
            "last_sync": status.get("last_sync")
        }
    
    def delete_all_users(self, role=None):
        """Delete all users (or by role)"""
        deleted = 0
        
        # Delete from MongoDB
        if self._check_mongodb():
            try:
                if role == "student" or role is None:
                    result = self.mongo_db.students.delete_many({})
                    deleted += result.deleted_count
                if role == "teacher" or role is None:
                    result = self.mongo_db.teachers.delete_many({})
                    deleted += result.deleted_count
            except Exception as e:
                logger.error("MongoDB delete all error: %s", e)
        
        # Delete from JSON
        data = self._load_json()
        if role == "student" or role is None:
            deleted = max(deleted, len(data.get("students", {})))
            data["students"] = {}
        if role == "teacher" or role is None:
            deleted = max(deleted, len(data.get("teachers", {})))
            data["teachers"] = {}
        
        self._save_json(data)
        
        return deleted


# ========================================
# CLI HELPER FUNCTIONS
# ========================================
def clear_screen():
    """Clear terminal screen"""
    os.system('cls' if os.name == 'nt' else 'clear')

def get_input(prompt, required=True, max_length=100):
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

def print_header(db):
    """Print application header"""
    stats = db.get_stats()
    print("=" * 60)
    print("   TAMTAP v7.0 - ADMIN CLI")
    print("   System Administration & Maintenance Tools")
    db_status = "[MongoDB]" if stats["mongodb_connected"] else "[JSON Fallback]"
    print(f"   Database: {db_status}")
    print("=" * 60)
    print(f"   Students: {stats['students']} | Teachers: {stats['teachers']}")
    print(f"   Today's Attendance: {stats['today_attendance']}")
    print(f"   Total Records: {stats['total_attendance']} | Pending Sync: {stats['pending_sync']}")
    print("=" * 60)

def print_main_menu():
    """Print main menu"""
    print("\n[MAIN MENU]")
    print("-" * 40)
    print("  1. 📋 View Today's Attendance")
    print("  2. 📊 View Attendance by Date")
    print("  3. 📦 Archive Attendance Records")
    print("  4. 🗑️  Clear Attendance Records")
    print("  5. 👥 Manage Users")
    print("  6. 📤 Export Data")
    print("  7. 🔧 System Maintenance")
    print("  8. 📈 View Statistics")
    print("  9. ❌ Exit")
    print("-" * 40)


# ========================================
# MENU FUNCTIONS
# ========================================
def view_today_attendance(db):
    """View today's attendance records"""
    clear_screen()
    print_header(db)
    
    today = datetime.now().strftime("%Y-%m-%d")
    print(f"\n[TODAY'S ATTENDANCE - {today}]")
    print("-" * 60)
    
    records = db.get_attendance(today)
    
    if not records:
        print("\n  No attendance records for today.\n")
    else:
        print(f"\n{'No.':<4} {'Time':<10} {'ID':<8} {'Name':<25} {'Role':<10}")
        print("-" * 60)
        for i, record in enumerate(records, 1):
            time_str = record.get("time", "")[:8]
            tamtap_id = record.get("tamtap_id", "---")
            name = record.get("name", "Unknown")[:24]
            role = record.get("role", "?")
            session = record.get("session", "")
            print(f"{i:<4} {time_str:<10} {tamtap_id:<8} {name:<25} {role:<10} [{session}]")
        print("-" * 60)
        print(f"Total: {len(records)} records")
    
    input("\nPress Enter to continue...")


def view_attendance_by_date(db):
    """View attendance by specific date"""
    clear_screen()
    print_header(db)
    
    print("\n[VIEW ATTENDANCE BY DATE]")
    print("-" * 40)
    print("  Enter date in format: YYYY-MM-DD")
    print("  Example: 2026-01-16")
    print("  Or press Enter for today")
    
    date_input = get_input("\n> Date: ", required=False)
    
    if date_input is None:
        return
    
    if not date_input:
        date_str = datetime.now().strftime("%Y-%m-%d")
    else:
        # Validate date format
        try:
            datetime.strptime(date_input, "%Y-%m-%d")
            date_str = date_input
        except ValueError:
            print("[!] Invalid date format. Use YYYY-MM-DD")
            input("\nPress Enter to continue...")
            return
    
    print(f"\n[ATTENDANCE FOR {date_str}]")
    print("-" * 60)
    
    records = db.get_attendance(date_str)
    
    if not records:
        print(f"\n  No attendance records for {date_str}.\n")
    else:
        print(f"\n{'No.':<4} {'Time':<10} {'ID':<8} {'Name':<25} {'Role':<10}")
        print("-" * 60)
        for i, record in enumerate(records, 1):
            time_str = record.get("time", "")[:8]
            tamtap_id = record.get("tamtap_id", "---")
            name = record.get("name", "Unknown")[:24]
            role = record.get("role", "?")
            session = record.get("session", "")
            print(f"{i:<4} {time_str:<10} {tamtap_id:<8} {name:<25} {role:<10} [{session}]")
        print("-" * 60)
        print(f"Total: {len(records)} records")
    
    input("\nPress Enter to continue...")


def archive_attendance_menu(db):
    """Archive attendance records"""
    clear_screen()
    print_header(db)
    
    print("\n[ARCHIVE ATTENDANCE RECORDS]")
    print("-" * 40)
    print("  Archive attendance to JSON file for backup")
    print("")
    print("  1. Archive Today's Records")
    print("  2. Archive Specific Date")
    print("  3. Archive Last 7 Days")
    print("  4. Back to Main Menu")
    
    choice = get_input("\n> Select option (1-4): ", required=False)
    
    if choice is None or choice == '4':
        return
    
    if choice == '1':
        date_str = datetime.now().strftime("%Y-%m-%d")
        count, filename = db.archive_attendance(date_str)
        if count > 0:
            print(f"\n[SUCCESS] Archived {count} records to {filename}")
        else:
            print("\n[!] No records to archive for today")
    
    elif choice == '2':
        date_input = get_input("\n> Enter date (YYYY-MM-DD): ", required=False)
        if date_input:
            try:
                datetime.strptime(date_input, "%Y-%m-%d")
                count, filename = db.archive_attendance(date_input)
                if count > 0:
                    print(f"\n[SUCCESS] Archived {count} records to {filename}")
                else:
                    print(f"\n[!] No records to archive for {date_input}")
            except ValueError:
                print("[!] Invalid date format")
    
    elif choice == '3':
        total_archived = 0
        for i in range(7):
            date = datetime.now() - timedelta(days=i)
            date_str = date.strftime("%Y-%m-%d")
            count, _ = db.archive_attendance(date_str)
            total_archived += count
        print(f"\n[SUCCESS] Archived {total_archived} records from last 7 days")
    
    input("\nPress Enter to continue...")


def clear_attendance_menu(db):
    """Clear attendance records"""
    clear_screen()
    print_header(db)
    
    print("\n[CLEAR ATTENDANCE RECORDS]")
    print("-" * 40)
    print("  ⚠️  WARNING: This will DELETE attendance records!")
    print("")
    print("  1. Clear Today's Records Only")
    print("  2. Clear Specific Date")
    print("  3. Clear ALL Records (DANGEROUS!)")
    print("  4. Back to Main Menu")
    
    choice = get_input("\n> Select option (1-4): ", required=False)
    
    if choice is None or choice == '4':
        return
    
    if choice == '1':
        date_str = datetime.now().strftime("%Y-%m-%d")
        confirm = get_input(f"\n> Delete all records for {date_str}? (type 'YES'): ", required=False)
        if confirm == 'YES':
            # Archive first
            db.archive_attendance(date_str)
            count = db.clear_attendance(date_str)
            print(f"\n[SUCCESS] Cleared {count} records (archived first)")
        else:
            print("\n[!] Cancelled")
    
    elif choice == '2':
        date_input = get_input("\n> Enter date to clear (YYYY-MM-DD): ", required=False)
        if date_input:
            try:
                datetime.strptime(date_input, "%Y-%m-%d")
                confirm = get_input(f"\n> Delete all records for {date_input}? (type 'YES'): ", required=False)
                if confirm == 'YES':
                    db.archive_attendance(date_input)
                    count = db.clear_attendance(date_input)
                    print(f"\n[SUCCESS] Cleared {count} records (archived first)")
                else:
                    print("\n[!] Cancelled")
            except ValueError:
                print("[!] Invalid date format")
    
    elif choice == '3':
        print("\n  ⚠️  THIS WILL DELETE ALL ATTENDANCE RECORDS!")
        confirm1 = get_input("\n> Are you sure? (type 'DELETE ALL'): ", required=False)
        if confirm1 == 'DELETE ALL':
            confirm2 = get_input("> Type 'CONFIRM' to proceed: ", required=False)
            if confirm2 == 'CONFIRM':
                # Archive everything first
                for i in range(365):  # Archive up to a year
                    date = datetime.now() - timedelta(days=i)
                    date_str = date.strftime("%Y-%m-%d")
                    db.archive_attendance(date_str)
                count = db.clear_attendance(clear_all=True)
                print(f"\n[SUCCESS] Cleared ALL {count} records (archived first)")
            else:
                print("\n[!] Cancelled")
        else:
            print("\n[!] Cancelled")
    
    input("\nPress Enter to continue...")


def manage_users_menu(db):
    """Manage users menu"""
    while True:
        clear_screen()
        print_header(db)
        
        print("\n[MANAGE USERS]")
        print("-" * 40)
        print("  1. List All Students")
        print("  2. List All Teachers")
        print("  3. Search User by NFC ID")
        print("  4. Search User by TAMTAP ID")
        print("  5. Delete User")
        print("  6. Delete ALL Users (DANGEROUS!)")
        print("  7. Back to Main Menu")
        
        choice = get_input("\n> Select option (1-7): ", required=False)
        
        if choice is None or choice == '7':
            return
        
        if choice == '1':
            list_users(db, "student")
        elif choice == '2':
            list_users(db, "teacher")
        elif choice == '3':
            search_user_by_nfc(db)
        elif choice == '4':
            search_user_by_tamtap_id(db)
        elif choice == '5':
            delete_user_menu(db)
        elif choice == '6':
            delete_all_users(db)


def list_users(db, role):
    """List users by role"""
    clear_screen()
    print_header(db)
    
    students, teachers = db.get_all_users()
    users = students if role == "student" else teachers
    
    print(f"\n[{role.upper()}S - Total: {len(users)}]")
    print("-" * 70)
    
    if not users:
        print(f"\n  No {role}s registered.\n")
    else:
        print(f"{'ID':<8} {'NFC ID':<15} {'Name':<25} {'Grade/Section':<15}")
        print("-" * 70)
        for user in users:
            tamtap_id = user.get("tamtap_id", "---")
            nfc_id = str(user.get("nfc_id", "?"))[:14]
            name = user.get("name", "Unknown")[:24]
            grade = user.get("grade", "")
            section = user.get("section", "")
            grade_sec = f"{grade} {section}".strip()[:14] if grade or section else "N/A"
            print(f"{tamtap_id:<8} {nfc_id:<15} {name:<25} {grade_sec:<15}")
        print("-" * 70)
    
    input("\nPress Enter to continue...")


def search_user_by_nfc(db):
    """Search user by NFC ID"""
    clear_screen()
    print_header(db)
    
    print("\n[SEARCH BY NFC ID]")
    print("-" * 40)
    
    nfc_id = get_input("\n> Enter NFC ID: ", required=False)
    if not nfc_id:
        return
    
    user, role = db.get_user(nfc_id)
    
    if user:
        print("\n" + "=" * 40)
        print("USER FOUND")
        print("=" * 40)
        print(f"  TAMTAP ID: {user.get('tamtap_id', 'N/A')}")
        print(f"  NFC ID:    {nfc_id}")
        print(f"  Role:      {role.upper()}")
        print(f"  Name:      {user.get('name', 'N/A')}")
        print(f"  Email:     {user.get('email', 'N/A') or 'N/A'}")
        print(f"  Grade:     {user.get('grade', 'N/A') or 'N/A'}")
        print(f"  Section:   {user.get('section', 'N/A') or 'N/A'}")
        print(f"  Registered:{user.get('registered', 'N/A')}")
        print("=" * 40)
    else:
        print(f"\n[!] User with NFC ID '{nfc_id}' not found")
    
    input("\nPress Enter to continue...")


def search_user_by_tamtap_id(db):
    """Search user by TAMTAP ID"""
    clear_screen()
    print_header(db)
    
    print("\n[SEARCH BY TAMTAP ID]")
    print("-" * 40)
    
    tamtap_input = get_input("\n> Enter TAMTAP ID (e.g., 001 or 1): ", required=False)
    if not tamtap_input:
        return
    
    try:
        tamtap_id = str(int(tamtap_input)).zfill(3)
    except ValueError:
        print("[!] Invalid ID format")
        input("\nPress Enter to continue...")
        return
    
    students, teachers = db.get_all_users()
    
    found = None
    found_role = None
    found_nfc = None
    
    for user in students:
        if user.get("tamtap_id") == tamtap_id:
            found = user
            found_role = "student"
            found_nfc = user.get("nfc_id")
            break
    
    if not found:
        for user in teachers:
            if user.get("tamtap_id") == tamtap_id:
                found = user
                found_role = "teacher"
                found_nfc = user.get("nfc_id")
                break
    
    if found:
        print("\n" + "=" * 40)
        print("USER FOUND")
        print("=" * 40)
        print(f"  TAMTAP ID: {tamtap_id}")
        print(f"  NFC ID:    {found_nfc}")
        print(f"  Role:      {found_role.upper()}")
        print(f"  Name:      {found.get('name', 'N/A')}")
        print(f"  Email:     {found.get('email', 'N/A') or 'N/A'}")
        print(f"  Grade:     {found.get('grade', 'N/A') or 'N/A'}")
        print(f"  Section:   {found.get('section', 'N/A') or 'N/A'}")
        print(f"  Registered:{found.get('registered', 'N/A')}")
        print("=" * 40)
    else:
        print(f"\n[!] User with TAMTAP ID '{tamtap_id}' not found")
    
    input("\nPress Enter to continue...")


def delete_user_menu(db):
    """Delete a specific user"""
    clear_screen()
    print_header(db)
    
    print("\n[DELETE USER]")
    print("-" * 40)
    
    nfc_id = get_input("\n> Enter NFC ID to delete: ", required=False)
    if not nfc_id:
        return
    
    user, role = db.get_user(nfc_id)
    
    if not user:
        print(f"\n[!] User with NFC ID '{nfc_id}' not found")
        input("\nPress Enter to continue...")
        return
    
    print("\n" + "=" * 40)
    print("USER TO DELETE")
    print("=" * 40)
    print(f"  TAMTAP ID: {user.get('tamtap_id', 'N/A')}")
    print(f"  NFC ID:    {nfc_id}")
    print(f"  Name:      {user.get('name', 'N/A')}")
    print(f"  Role:      {role.upper()}")
    print("=" * 40)
    
    confirm = get_input("\n> Type 'DELETE' to confirm: ", required=False)
    
    if confirm == 'DELETE':
        if db.delete_user(nfc_id):
            print(f"\n[SUCCESS] User deleted!")
            logger.info("User deleted: NFC %s", nfc_id)
        else:
            print("\n[ERROR] Failed to delete user")
    else:
        print("\n[!] Cancelled")
    
    input("\nPress Enter to continue...")


def delete_all_users(db):
    """Delete all users - DANGEROUS"""
    clear_screen()
    print_header(db)
    
    print("\n[DELETE ALL USERS]")
    print("-" * 40)
    print("  ⚠️  THIS WILL DELETE ALL STUDENTS AND TEACHERS!")
    print("  ⚠️  This action CANNOT be undone!")
    
    confirm1 = get_input("\n> Type 'DELETE ALL USERS' to continue: ", required=False)
    
    if confirm1 != 'DELETE ALL USERS':
        print("\n[!] Cancelled")
        input("\nPress Enter to continue...")
        return
    
    confirm2 = get_input("> Type 'CONFIRM' to proceed: ", required=False)
    
    if confirm2 != 'CONFIRM':
        print("\n[!] Cancelled")
        input("\nPress Enter to continue...")
        return
    
    # Backup first
    json_data = db._load_json()
    backup_file = f"{ARCHIVE_DIR}/users_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(backup_file, 'w') as f:
        json.dump({"students": json_data.get("students", {}), 
                   "teachers": json_data.get("teachers", {})}, f, indent=2)
    print(f"\n[INFO] Backup saved to {backup_file}")
    
    # Delete all
    students, teachers = db.get_all_users()
    deleted_count = 0
    
    for user in students:
        if db.delete_user(user.get("nfc_id")):
            deleted_count += 1
    
    for user in teachers:
        if db.delete_user(user.get("nfc_id")):
            deleted_count += 1
    
    print(f"[SUCCESS] Deleted {deleted_count} users")
    input("\nPress Enter to continue...")


def export_data_menu(db):
    """Export data menu"""
    clear_screen()
    print_header(db)
    
    print("\n[EXPORT DATA]")
    print("-" * 40)
    print("  1. Export Today's Attendance (JSON)")
    print("  2. Export Today's Attendance (CSV)")
    print("  3. Export All Users (JSON)")
    print("  4. Export All Users (CSV)")
    print("  5. Export Full Database Backup")
    print("  6. Back to Main Menu")
    
    choice = get_input("\n> Select option (1-6): ", required=False)
    
    if choice is None or choice == '6':
        return
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    today = datetime.now().strftime("%Y-%m-%d")
    
    if choice == '1':
        records = db.get_attendance(today)
        filename = f"{ARCHIVE_DIR}/attendance_{today.replace('-', '')}_{timestamp}.json"
        with open(filename, 'w') as f:
            json.dump(records, f, indent=2)
        print(f"\n[SUCCESS] Exported {len(records)} records to {filename}")
    
    elif choice == '2':
        records = db.get_attendance(today)
        filename = f"{ARCHIVE_DIR}/attendance_{today.replace('-', '')}_{timestamp}.csv"
        with open(filename, 'w') as f:
            f.write("TAMTAP_ID,NFC_ID,Name,Role,Date,Time,Session,Grade,Section\n")
            for r in records:
                line = f"{r.get('tamtap_id', '')},{r.get('nfc_id', '')},{r.get('name', '')},"
                line += f"{r.get('role', '')},{r.get('date', '')[:10]},{r.get('time', '')},"
                line += f"{r.get('session', '')},{r.get('grade', '')},{r.get('section', '')}\n"
                f.write(line)
        print(f"\n[SUCCESS] Exported {len(records)} records to {filename}")
    
    elif choice == '3':
        students, teachers = db.get_all_users()
        data = {"students": students, "teachers": teachers}
        filename = f"{ARCHIVE_DIR}/users_{timestamp}.json"
        with open(filename, 'w') as f:
            json.dump(data, f, indent=2)
        print(f"\n[SUCCESS] Exported {len(students)} students, {len(teachers)} teachers to {filename}")
    
    elif choice == '4':
        students, teachers = db.get_all_users()
        filename = f"{ARCHIVE_DIR}/users_{timestamp}.csv"
        with open(filename, 'w') as f:
            f.write("TAMTAP_ID,NFC_ID,Role,Name,Email,Grade,Section,Registered\n")
            for s in students:
                line = f"{s.get('tamtap_id', '')},{s.get('nfc_id', '')},student,"
                line += f"{s.get('name', '')},{s.get('email', '')},{s.get('grade', '')},"
                line += f"{s.get('section', '')},{s.get('registered', '')}\n"
                f.write(line)
            for t in teachers:
                line = f"{t.get('tamtap_id', '')},{t.get('nfc_id', '')},teacher,"
                line += f"{t.get('name', '')},{t.get('email', '')},,,"
                line += f"{t.get('registered', '')}\n"
                f.write(line)
        print(f"\n[SUCCESS] Exported {len(students) + len(teachers)} users to {filename}")
    
    elif choice == '5':
        json_data = db._load_json()
        filename = f"{ARCHIVE_DIR}/full_backup_{timestamp}.json"
        with open(filename, 'w') as f:
            json.dump(json_data, f, indent=2)
        print(f"\n[SUCCESS] Full backup saved to {filename}")
    
    input("\nPress Enter to continue...")


def system_maintenance_menu(db):
    """System maintenance menu"""
    clear_screen()
    print_header(db)
    
    print("\n[SYSTEM MAINTENANCE]")
    print("-" * 40)
    print("  1. Clean Old Attendance Photos")
    print("  2. Compact JSON Database")
    print("  3. Sync Pending Records to MongoDB")
    print("  4. Reset TAMTAP ID Counter")
    print("  5. View Archive Files")
    print("  6. Back to Main Menu")
    
    choice = get_input("\n> Select option (1-6): ", required=False)
    
    if choice is None or choice == '6':
        return
    
    if choice == '1':
        clean_old_photos()
    elif choice == '2':
        compact_json(db)
    elif choice == '3':
        sync_to_mongodb(db)
    elif choice == '4':
        reset_tamtap_id(db)
    elif choice == '5':
        view_archives()
    
    input("\nPress Enter to continue...")


def clean_old_photos():
    """Clean attendance photos older than 30 days"""
    print("\n[CLEAN OLD PHOTOS]")
    print("-" * 40)
    
    days = get_input("> Delete photos older than how many days? (default: 30): ", required=False)
    
    try:
        days_int = int(days) if days else 30
    except ValueError:
        days_int = 30
    
    cutoff = datetime.now() - timedelta(days=days_int)
    deleted = 0
    
    if os.path.exists(PHOTO_DIR):
        for filename in os.listdir(PHOTO_DIR):
            filepath = os.path.join(PHOTO_DIR, filename)
            if os.path.isfile(filepath):
                file_time = datetime.fromtimestamp(os.path.getmtime(filepath))
                if file_time < cutoff:
                    os.remove(filepath)
                    deleted += 1
    
    print(f"\n[SUCCESS] Deleted {deleted} old photos")


def compact_json(db):
    """Compact JSON database"""
    print("\n[COMPACT JSON]")
    print("-" * 40)
    
    json_data = db._load_json()
    
    # Remove empty entries
    json_data["students"] = {k: v for k, v in json_data.get("students", {}).items() if v}
    json_data["teachers"] = {k: v for k, v in json_data.get("teachers", {}).items() if v}
    
    db._save_json(json_data)
    
    file_size = os.path.getsize(DB_FILE) if os.path.exists(DB_FILE) else 0
    print(f"\n[SUCCESS] Database compacted ({file_size} bytes)")


def sync_to_mongodb(db):
    """Force sync pending records to MongoDB"""
    print("\n[SYNC TO MONGODB]")
    print("-" * 40)
    
    if not db.is_connected():
        print("\n[ERROR] MongoDB not connected!")
        return
    
    json_data = db._load_json()
    pending = json_data.get("pending_attendance", [])
    
    if not pending:
        print("\n[INFO] No pending records to sync")
        return
    
    synced = 0
    for record in pending:
        try:
            db.mongo_db.attendance.insert_one(record)
            synced += 1
        except Exception:
            pass
    
    if synced > 0:
        json_data["pending_attendance"] = []
        db._save_json(json_data)
    
    print(f"\n[SUCCESS] Synced {synced}/{len(pending)} records to MongoDB")


def reset_tamtap_id(db):
    """Reset TAMTAP ID counter"""
    print("\n[RESET TAMTAP ID COUNTER]")
    print("-" * 40)
    
    # Find highest existing ID
    students, teachers = db.get_all_users()
    max_id = 0
    
    for user in students + teachers:
        try:
            user_id = int(user.get("tamtap_id", "0"))
            max_id = max(max_id, user_id)
        except ValueError:
            pass
    
    new_next = max_id + 1
    
    json_data = db._load_json()
    old_next = json_data.get("next_tamtap_id", 1)
    json_data["next_tamtap_id"] = new_next
    db._save_json(json_data)
    
    print(f"\n[SUCCESS] Reset counter: {old_next} → {new_next}")


def view_archives():
    """View archive files"""
    print("\n[ARCHIVE FILES]")
    print("-" * 60)
    
    if not os.path.exists(ARCHIVE_DIR):
        print("\n  No archive directory found")
        return
    
    files = sorted(os.listdir(ARCHIVE_DIR), reverse=True)
    
    if not files:
        print("\n  No archive files found")
        return
    
    print(f"\n{'Filename':<40} {'Size':<12} {'Modified'}")
    print("-" * 60)
    
    for filename in files[:20]:  # Show last 20
        filepath = os.path.join(ARCHIVE_DIR, filename)
        if os.path.isfile(filepath):
            size = os.path.getsize(filepath)
            size_str = f"{size:,} B" if size < 1024 else f"{size/1024:.1f} KB"
            mtime = datetime.fromtimestamp(os.path.getmtime(filepath)).strftime("%Y-%m-%d %H:%M")
            print(f"{filename:<40} {size_str:<12} {mtime}")
    
    if len(files) > 20:
        print(f"\n  ... and {len(files) - 20} more files")


def view_statistics(db):
    """View detailed statistics"""
    clear_screen()
    print_header(db)
    
    print("\n[DETAILED STATISTICS]")
    print("=" * 60)
    
    stats = db.get_stats()
    students, teachers = db.get_all_users()
    
    # User stats
    print("\n📊 USERS")
    print("-" * 40)
    print(f"  Total Students:    {stats['students']}")
    print(f"  Total Teachers:    {stats['teachers']}")
    print(f"  Total Users:       {stats['students'] + stats['teachers']}")
    
    # Attendance stats
    print("\n📋 ATTENDANCE")
    print("-" * 40)
    print(f"  Today's Records:   {stats['today_attendance']}")
    print(f"  Total Records:     {stats['total_attendance']}")
    print(f"  Pending Sync:      {stats['pending_sync']}")
    
    # Last 7 days
    print("\n📅 LAST 7 DAYS")
    print("-" * 40)
    for i in range(7):
        date = datetime.now() - timedelta(days=i)
        date_str = date.strftime("%Y-%m-%d")
        day_name = date.strftime("%a")
        records = db.get_attendance(date_str)
        bar = "█" * min(len(records), 30)
        print(f"  {date_str} ({day_name}): {len(records):3} {bar}")
    
    # Database info
    print("\n💾 DATABASE")
    print("-" * 40)
    print(f"  MongoDB:           {'Connected ✓' if stats['mongodb_connected'] else 'Disconnected ✗'}")
    if os.path.exists(DB_FILE):
        size = os.path.getsize(DB_FILE)
        print(f"  JSON File Size:    {size:,} bytes")
    if os.path.exists(PHOTO_DIR):
        photo_count = len([f for f in os.listdir(PHOTO_DIR) if f.endswith('.jpg')])
        print(f"  Attendance Photos: {photo_count}")
    if os.path.exists(ARCHIVE_DIR):
        archive_count = len(os.listdir(ARCHIVE_DIR))
        print(f"  Archive Files:     {archive_count}")
    
    print("\n" + "=" * 60)
    input("\nPress Enter to continue...")


# ========================================
# MAIN
# ========================================
def main():
    """Main entry point"""
    logger.info("Starting TAMTAP Admin CLI...")
    
    db = Database()
    
    try:
        while True:
            clear_screen()
            print_header(db)
            print_main_menu()
            
            choice = get_input("\n> Select option (1-9): ", required=False)
            
            if choice is None:
                continue
            
            if choice == '1':
                view_today_attendance(db)
            elif choice == '2':
                view_attendance_by_date(db)
            elif choice == '3':
                archive_attendance_menu(db)
            elif choice == '4':
                clear_attendance_menu(db)
            elif choice == '5':
                manage_users_menu(db)
            elif choice == '6':
                export_data_menu(db)
            elif choice == '7':
                system_maintenance_menu(db)
            elif choice == '8':
                view_statistics(db)
            elif choice == '9':
                print("\n[*] Goodbye!")
                break
            else:
                print("\n[!] Invalid option")
                input("Press Enter to continue...")
                
    except KeyboardInterrupt:
        print("\n\n[*] Interrupted - Exiting...")
    finally:
        db.close()
        logger.info("Admin CLI closed")


# ========================================
# SIGNAL HANDLER
# ========================================
def signal_handler(sig, frame):
    """Handle shutdown signals"""
    print("\n\n[*] Shutdown signal received")
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)


if __name__ == "__main__":
    main()
