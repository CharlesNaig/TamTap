#!/usr/bin/env python3
"""
TAMTAP v7.0 - Attendance Archive Utility
Archives attendance records for mass testing with limited NFC cards.

Usage:
    python archive_attendance.py              # Interactive mode
    python archive_attendance.py --today      # Archive today's attendance
    python archive_attendance.py --all        # Archive all attendance
    python archive_attendance.py --clear      # Clear without archiving
    python archive_attendance.py --student <NFC_ID>              # Archive all for a student
    python archive_attendance.py --student <NFC_ID> --today      # Archive student's today
    python archive_attendance.py --student <NFC_ID> --date 2026-02-10  # Archive student's date
"""

import os
import sys
import json
import argparse
import logging
from datetime import datetime

# Shared Database module
from database import Database

# ========================================w
# LOGGING
# ========================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('ARCHIVE')

# ========================================
# CONSTANTS
# ========================================
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCHIVE_DIR = os.path.join(_PROJECT_ROOT, "database", "archives")

# Create archive directory
os.makedirs(ARCHIVE_DIR, exist_ok=True)


# ========================================
# ARCHIVE DATABASE CLASS
# ========================================
class ArchiveDatabase(Database):
    """Extended Database with archive operations"""
    
    def __init__(self):
        # Disable background reconnect for CLI tool
        super().__init__(enable_background_reconnect=False)
    
    def get_attendance_records(self, date_filter=None, nfc_filter=None):
        """Get attendance records (from MongoDB or JSON)
        
        Args:
            date_filter: Filter by date prefix (YYYY-MM-DD)
            nfc_filter: Filter by student nfc_id
        """
        records = []
        
        # Try MongoDB first
        if self._check_mongodb():
            try:
                query = {}
                if date_filter:
                    query["date"] = {"$regex": f"^{date_filter}"}
                if nfc_filter:
                    query["nfc_id"] = nfc_filter
                
                cursor = self.mongo_db.attendance.find(query)
                for doc in cursor:
                    record = {k: v for k, v in doc.items() if k != "_id"}
                    records.append(record)
                return records
            except Exception as e:
                logger.error("MongoDB read error: %s", e)
        
        # Fallback to JSON
        data = self._load_json()
        all_records = data.get("attendance", []) + data.get("pending_attendance", [])
        
        if date_filter:
            all_records = [r for r in all_records if r.get("date", "").startswith(date_filter)]
        if nfc_filter:
            all_records = [r for r in all_records if r.get("nfc_id") == nfc_filter]
        
        records = all_records
        return records
    
    def get_unique_students(self, date_filter=None):
        """Get list of unique students from attendance records"""
        records = self.get_attendance_records(date_filter)
        students = {}
        for r in records:
            nfc_id = r.get("nfc_id", "unknown")
            if nfc_id not in students:
                students[nfc_id] = {
                    "nfc_id": nfc_id,
                    "tamtap_id": r.get("tamtap_id", "???"),
                    "name": r.get("name", "Unknown"),
                    "count": 0
                }
            students[nfc_id]["count"] += 1
        # Sort by tamtap_id for clean display
        result = list(students.values())
        result.sort(key=lambda s: s.get("tamtap_id", "999"))
        return result
    
    def archive_to_mongodb(self, records, archive_name):
        """Archive records to MongoDB archive collection"""
        if not self._check_mongodb():
            return False, 0
        
        try:
            # Create archive document
            archive_doc = {
                "archive_name": archive_name,
                "archived_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "record_count": len(records),
                "records": records
            }
            
            # Insert into archives collection
            self.mongo_db.attendance_archives.insert_one(archive_doc)
            logger.info("Archived %d records to MongoDB: %s", len(records), archive_name)
            return True, len(records)
        except Exception as e:
            logger.error("MongoDB archive error: %s", e)
            return False, 0
    
    def archive_to_json(self, records, archive_name):
        """Archive records to JSON file"""
        try:
            filename = os.path.join(ARCHIVE_DIR, f"{archive_name}.json")
            
            # Load existing archive if exists
            existing = []
            if os.path.exists(filename):
                try:
                    with open(filename, 'r') as f:
                        data = json.load(f)
                        existing = data.get("records", [])
                except Exception:
                    pass
            
            # Merge records
            all_records = existing + records
            
            archive_doc = {
                "archive_name": archive_name,
                "archived_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "record_count": len(all_records),
                "records": all_records
            }
            
            with open(filename, 'w') as f:
                json.dump(archive_doc, f, indent=2)
            
            logger.info("Archived %d records to JSON: %s", len(records), filename)
            return True, len(records)
        except Exception as e:
            logger.error("JSON archive error: %s", e)
            return False, 0
    
    def clear_attendance(self, date_filter=None, nfc_filter=None):
        """Clear attendance records from both MongoDB and JSON
        
        Args:
            date_filter: Filter by date prefix (YYYY-MM-DD)
            nfc_filter: Filter by student nfc_id
        """
        deleted_mongo = 0
        deleted_json = 0
        
        # Clear from MongoDB
        if self._check_mongodb():
            try:
                query = {}
                if date_filter:
                    query["date"] = {"$regex": f"^{date_filter}"}
                if nfc_filter:
                    query["nfc_id"] = nfc_filter
                
                result = self.mongo_db.attendance.delete_many(query)
                deleted_mongo = result.deleted_count
                logger.info("Deleted %d records from MongoDB", deleted_mongo)
            except Exception as e:
                logger.error("MongoDB delete error: %s", e)
        
        # Clear from JSON
        data = self._load_json()
        original_count = len(data.get("attendance", [])) + len(data.get("pending_attendance", []))
        
        def keep_record(r):
            """Return True if record should be kept (not deleted)"""
            if date_filter and r.get("date", "").startswith(date_filter):
                if nfc_filter and r.get("nfc_id") == nfc_filter:
                    return False
                elif not nfc_filter:
                    return False
            elif not date_filter:
                if nfc_filter and r.get("nfc_id") == nfc_filter:
                    return False
                elif not nfc_filter:
                    return False
            return True
        
        data["attendance"] = [r for r in data.get("attendance", []) if keep_record(r)]
        data["pending_attendance"] = [r for r in data.get("pending_attendance", []) if keep_record(r)]
        
        new_count = len(data.get("attendance", [])) + len(data.get("pending_attendance", []))
        deleted_json = original_count - new_count
        
        self._save_json(data)
        logger.info("Deleted %d records from JSON", deleted_json)
        
        return max(deleted_mongo, deleted_json)
    
    def list_archives(self):
        """List all archives"""
        archives = []
        
        # List MongoDB archives
        if self._check_mongodb():
            try:
                cursor = self.mongo_db.attendance_archives.find({}, {"records": 0})
                for doc in cursor:
                    archives.append({
                        "source": "MongoDB",
                        "name": doc.get("archive_name"),
                        "archived_at": doc.get("archived_at"),
                        "count": doc.get("record_count", 0)
                    })
            except Exception as e:
                logger.debug("MongoDB archives error: %s", e)
        
        # List JSON archives
        try:
            for filename in os.listdir(ARCHIVE_DIR):
                if filename.endswith('.json'):
                    filepath = os.path.join(ARCHIVE_DIR, filename)
                    try:
                        with open(filepath, 'r') as f:
                            data = json.load(f)
                            archives.append({
                                "source": "JSON",
                                "name": data.get("archive_name", filename),
                                "archived_at": data.get("archived_at"),
                                "count": data.get("record_count", 0),
                                "file": filename
                            })
                    except Exception:
                        pass
        except Exception as e:
            logger.debug("JSON archives error: %s", e)
        
        return archives


# ========================================
# CLI FUNCTIONS
# ========================================
def clear_screen():
    """Clear terminal screen"""
    os.system('cls' if os.name == 'nt' else 'clear')

def print_header(db):
    """Print header"""
    print("=" * 55)
    print("   TAMTAP v7.0 - ATTENDANCE ARCHIVE UTILITY")
    print("   Mass Testing Tool | Archive & Clear Records")
    db_status = "[MongoDB]" if db._check_mongodb() else "[JSON Fallback]"
    print(f"   Database: {db_status}")
    print("=" * 55)

def print_menu():
    """Print main menu"""
    print("\n[ARCHIVE OPTIONS]")
    print("-" * 35)
    print("  1. Archive TODAY's attendance")
    print("  2. Archive ALL attendance")
    print("  3. Archive by specific date")
    print("  4. Archive by STUDENT")
    print("  5. Clear attendance (no archive)")
    print("  6. View current attendance")
    print("  7. List archives")
    print("  8. Exit")
    print("-" * 35)

def get_input(prompt, required=True):
    """Get user input"""
    try:
        value = input(prompt).strip()
        if required and not value:
            return None
        return value
    except (KeyboardInterrupt, EOFError):
        return None

def view_attendance(db, date_filter=None, nfc_filter=None):
    """View current attendance records"""
    records = db.get_attendance_records(date_filter, nfc_filter)
    
    if not records:
        print("\n[!] No attendance records found")
        return
    
    print(f"\n[ATTENDANCE RECORDS] ({len(records)} total)")
    print("-" * 60)
    
    for i, record in enumerate(records[:20], 1):  # Show first 20
        name = record.get("name", "Unknown")
        date = record.get("date", "")[:19]
        role = record.get("role", "?")
        nfc = record.get("nfc_id", "?")
        print(f"  {i:2}. {name[:20]:<20} | {role:<8} | {date}")
    
    if len(records) > 20:
        print(f"\n  ... and {len(records) - 20} more records")
    
    print("-" * 60)

def archive_attendance(db, date_filter=None, interactive=True, nfc_filter=None):
    """Archive attendance records
    
    Args:
        db: ArchiveDatabase instance
        date_filter: Filter by date prefix (YYYY-MM-DD)
        interactive: Whether to prompt for confirmation
        nfc_filter: Filter by student nfc_id
    """
    # Get records
    records = db.get_attendance_records(date_filter, nfc_filter)
    
    if not records:
        print("\n[!] No attendance records to archive")
        return False
    
    if nfc_filter:
        student_name = records[0].get("name", "Unknown")
        tamtap_id = records[0].get("tamtap_id", "???")
        label = f" for {student_name} (ID: {tamtap_id})"
    else:
        label = ""
    print(f"\n[*] Found {len(records)} attendance records{label}")
    
    if interactive:
        view_attendance(db, date_filter, nfc_filter)
    
    # Generate archive name
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    parts = ["archive"]
    if nfc_filter:
        # Use tamtap_id in archive name for readability
        tid = records[0].get("tamtap_id", "unknown") if records else "unknown"
        parts.append(f"student_{tid}")
    if date_filter:
        parts.append(date_filter.replace('-', ''))
    else:
        parts.append("all")
    parts.append(timestamp)
    archive_name = "_".join(parts)
    
    print(f"\n[*] Archive name: {archive_name}")
    
    if interactive:
        confirm = get_input("\n> Archive these records? (y/n): ")
        if not confirm or confirm.lower() not in ['y', 'yes']:
            print("[!] Archive cancelled")
            return False
    
    # Archive to both MongoDB and JSON
    success_mongo, _ = db.archive_to_mongodb(records, archive_name)
    success_json, count = db.archive_to_json(records, archive_name)
    
    if success_mongo or success_json:
        print(f"\n[OK] Archived {count} records to: {archive_name}")
        
        # Ask to clear
        if interactive:
            clear = get_input("\n> Clear these records from active database? (y/n): ")
            if clear and clear.lower() in ['y', 'yes']:
                deleted = db.clear_attendance(date_filter, nfc_filter)
                print(f"[OK] Cleared {deleted} records")
        else:
            # Auto-clear in non-interactive mode
            deleted = db.clear_attendance(date_filter, nfc_filter)
            print(f"[OK] Cleared {deleted} records")
        
        return True
    else:
        print("[!] Archive failed")
        return False

def clear_only(db, date_filter=None, interactive=True, nfc_filter=None):
    """Clear attendance without archiving"""
    records = db.get_attendance_records(date_filter, nfc_filter)
    
    if not records:
        print("\n[!] No attendance records to clear")
        return False
    
    print(f"\n[WARNING] This will DELETE {len(records)} records WITHOUT archiving!")
    
    if interactive:
        view_attendance(db, date_filter, nfc_filter)
        confirm = get_input("\n> Type 'DELETE' to confirm: ")
        if confirm != 'DELETE':
            print("[!] Clear cancelled")
            return False
    
    deleted = db.clear_attendance(date_filter, nfc_filter)
    print(f"\n[OK] Cleared {deleted} records")
    return True

def list_archives(db):
    """List all archives"""
    archives = db.list_archives()
    
    if not archives:
        print("\n[!] No archives found")
        return
    
    print(f"\n[ARCHIVES] ({len(archives)} total)")
    print("-" * 65)
    print(f"  {'Source':<8} | {'Name':<30} | {'Count':<6} | Archived At")
    print("-" * 65)
    
    for archive in archives:
        source = archive.get("source", "?")
        name = archive.get("name", "?")[:30]
        count = archive.get("count", 0)
        archived_at = archive.get("archived_at", "?")
        print(f"  {source:<8} | {name:<30} | {count:<6} | {archived_at}")
    
    print("-" * 65)

def pick_student(db, date_filter=None):
    """Show list of students with attendance and let user pick one.
    Returns the selected student's nfc_id or None."""
    students = db.get_unique_students(date_filter)
    
    if not students:
        print("\n[!] No students found in attendance records")
        return None
    
    scope = f" for {date_filter}" if date_filter else " (all dates)"
    print(f"\n[STUDENTS WITH ATTENDANCE]{scope}")
    print("-" * 55)
    for i, s in enumerate(students, 1):
        tid = s.get('tamtap_id', '???')
        print(f"  {i:2}. {s['name'][:25]:<25} | ID: {tid:<5} | {s['count']} record(s)")
    print("-" * 55)
    
    pick = get_input(f"\n> Select student (1-{len(students)}): ")
    if not pick or not pick.isdigit():
        return None
    idx = int(pick) - 1
    if idx < 0 or idx >= len(students):
        print("[!] Invalid selection")
        return None
    
    return students[idx]["nfc_id"]


def interactive_mode(db):
    """Run interactive CLI mode"""
    while True:
        clear_screen()
        print_header(db)
        print_menu()
        
        choice = get_input("\n> Select option (1-8): ")
        
        if choice is None:
            continue
        
        if choice == '1':
            # Archive today
            today = datetime.now().strftime("%Y-%m-%d")
            archive_attendance(db, today)
            input("\nPress Enter to continue...")
            
        elif choice == '2':
            # Archive all
            archive_attendance(db, None)
            input("\nPress Enter to continue...")
            
        elif choice == '3':
            # Archive by date
            date_str = get_input("\n> Enter date (YYYY-MM-DD): ")
            if date_str:
                archive_attendance(db, date_str)
            input("\nPress Enter to continue...")
            
        elif choice == '4':
            # Archive by student
            print("\n[STUDENT ARCHIVE OPTIONS]")
            print("  1. Student - today's records")
            print("  2. Student - all records")
            print("  3. Student - specific date")
            sub = get_input("\n> Select (1-3): ")
            
            date_f = None
            if sub == '1':
                date_f = datetime.now().strftime("%Y-%m-%d")
            elif sub == '2':
                date_f = None
            elif sub == '3':
                date_f = get_input("\n> Enter date (YYYY-MM-DD): ")
                if not date_f:
                    input("\nPress Enter to continue...")
                    continue
            else:
                print("[!] Invalid option")
                input("\nPress Enter to continue...")
                continue
            
            nfc = pick_student(db, date_f)
            if nfc:
                archive_attendance(db, date_f, nfc_filter=nfc)
            input("\nPress Enter to continue...")
            
        elif choice == '5':
            # Clear only
            print("\n[CLEAR OPTIONS]")
            print("  1. Clear today only")
            print("  2. Clear all")
            print("  3. Clear by date")
            print("  4. Clear by student")
            sub = get_input("\n> Select (1-4): ")
            
            if sub == '1':
                today = datetime.now().strftime("%Y-%m-%d")
                clear_only(db, today)
            elif sub == '2':
                clear_only(db, None)
            elif sub == '3':
                date_str = get_input("\n> Enter date (YYYY-MM-DD): ")
                if date_str:
                    clear_only(db, date_str)
            elif sub == '4':
                nfc = pick_student(db)
                if nfc:
                    clear_only(db, nfc_filter=nfc)
            input("\nPress Enter to continue...")
            
        elif choice == '6':
            # View attendance
            view_attendance(db)
            input("\nPress Enter to continue...")
            
        elif choice == '7':
            # List archives
            list_archives(db)
            input("\nPress Enter to continue...")
            
        elif choice == '8':
            print("\n[*] Goodbye!")
            break
        
        else:
            print("\n[!] Invalid option")
            input("Press Enter to continue...")


# ========================================
# MAIN
# ========================================
def main():
    parser = argparse.ArgumentParser(
        description='TAMTAP Attendance Archive Utility',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python archive_attendance.py              # Interactive mode
  python archive_attendance.py --today      # Archive today's attendance
  python archive_attendance.py --all        # Archive all attendance  
  python archive_attendance.py --date 2026-01-19  # Archive specific date
  python archive_attendance.py --clear      # Clear today without archive
  python archive_attendance.py --clear-all  # Clear all without archive
  python archive_attendance.py --list       # List archives
  python archive_attendance.py --student 100582761834              # Archive all for student (by nfc_id)
  python archive_attendance.py --student 100582761834 --today      # Archive student today
  python archive_attendance.py --student 100582761834 --date 2026-02-10  # Student + date
        """
    )
    
    parser.add_argument('--today', action='store_true', 
                        help='Archive today\'s attendance')
    parser.add_argument('--all', action='store_true',
                        help='Archive all attendance')
    parser.add_argument('--date', type=str,
                        help='Archive specific date (YYYY-MM-DD)')
    parser.add_argument('--clear', action='store_true',
                        help='Clear today\'s attendance without archiving')
    parser.add_argument('--clear-all', action='store_true',
                        help='Clear all attendance without archiving')
    parser.add_argument('--list', action='store_true',
                        help='List all archives')
    parser.add_argument('--student', type=str,
                        help='Filter by student nfc_id (use with --today, --all, or --date)')
    
    args = parser.parse_args()
    
    # Initialize database
    db = ArchiveDatabase()
    
    try:
        # Command line mode
        if args.today:
            today = datetime.now().strftime("%Y-%m-%d")
            label = f" for student {args.student}" if args.student else ""
            print(f"[*] Archiving attendance for {today}{label}...")
            archive_attendance(db, today, interactive=False, nfc_filter=args.student)
            
        elif args.all:
            label = f" for student {args.student}" if args.student else ""
            print(f"[*] Archiving all attendance{label}...")
            archive_attendance(db, None, interactive=False, nfc_filter=args.student)
            
        elif args.date:
            label = f" for student {args.student}" if args.student else ""
            print(f"[*] Archiving attendance for {args.date}{label}...")
            archive_attendance(db, args.date, interactive=False, nfc_filter=args.student)
            
        elif args.student and not (args.clear or args.clear_all):
            # Student-only flag: archive all records for that student
            print(f"[*] Archiving all attendance for student {args.student}...")
            archive_attendance(db, None, interactive=False, nfc_filter=args.student)
            
        elif args.clear:
            today = datetime.now().strftime("%Y-%m-%d")
            print(f"[*] Clearing attendance for {today}...")
            clear_only(db, today, interactive=False, nfc_filter=args.student)
            
        elif args.clear_all:
            print("[*] Clearing all attendance...")
            clear_only(db, None, interactive=False, nfc_filter=args.student)
            
        elif args.list:
            list_archives(db)
            
        else:
            # Interactive mode
            interactive_mode(db)
            
    except KeyboardInterrupt:
        print("\n\n[*] Interrupted")
    finally:
        db.close()


if __name__ == "__main__":
    main()
