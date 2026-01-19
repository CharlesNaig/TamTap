#!/usr/bin/env python3
"""
TAMTAP v7.0 - Attendance Archive Utility
Archives attendance records for mass testing with limited NFC cards.

Usage:
    python archive_attendance.py              # Interactive mode
    python archive_attendance.py --today      # Archive today's attendance
    python archive_attendance.py --all        # Archive all attendance
    python archive_attendance.py --clear      # Clear without archiving
"""

import os
import sys
import json
import argparse
import logging
from datetime import datetime

# Shared Database module
from database import Database

# ========================================
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
    
    def get_attendance_records(self, date_filter=None):
        """Get attendance records (from MongoDB or JSON)"""
        records = []
        
        # Try MongoDB first
        if self._check_mongodb():
            try:
                query = {}
                if date_filter:
                    query["date"] = {"$regex": f"^{date_filter}"}
                
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
            records = [r for r in all_records if r.get("date", "").startswith(date_filter)]
        else:
            records = all_records
        
        return records
    
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
    
    def clear_attendance(self, date_filter=None):
        """Clear attendance records from both MongoDB and JSON"""
        deleted_mongo = 0
        deleted_json = 0
        
        # Clear from MongoDB
        if self._check_mongodb():
            try:
                query = {}
                if date_filter:
                    query["date"] = {"$regex": f"^{date_filter}"}
                
                result = self.mongo_db.attendance.delete_many(query)
                deleted_mongo = result.deleted_count
                logger.info("Deleted %d records from MongoDB", deleted_mongo)
            except Exception as e:
                logger.error("MongoDB delete error: %s", e)
        
        # Clear from JSON
        data = self._load_json()
        original_count = len(data.get("attendance", [])) + len(data.get("pending_attendance", []))
        
        if date_filter:
            data["attendance"] = [r for r in data.get("attendance", []) 
                                  if not r.get("date", "").startswith(date_filter)]
            data["pending_attendance"] = [r for r in data.get("pending_attendance", []) 
                                          if not r.get("date", "").startswith(date_filter)]
        else:
            data["attendance"] = []
            data["pending_attendance"] = []
        
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
    print("  4. Clear attendance (no archive)")
    print("  5. View current attendance")
    print("  6. List archives")
    print("  7. Exit")
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

def view_attendance(db, date_filter=None):
    """View current attendance records"""
    records = db.get_attendance_records(date_filter)
    
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

def archive_attendance(db, date_filter=None, interactive=True):
    """Archive attendance records"""
    # Get records
    records = db.get_attendance_records(date_filter)
    
    if not records:
        print("\n[!] No attendance records to archive")
        return False
    
    print(f"\n[*] Found {len(records)} attendance records")
    
    if interactive:
        view_attendance(db, date_filter)
    
    # Generate archive name
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    if date_filter:
        archive_name = f"archive_{date_filter.replace('-', '')}_{timestamp}"
    else:
        archive_name = f"archive_all_{timestamp}"
    
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
                deleted = db.clear_attendance(date_filter)
                print(f"[OK] Cleared {deleted} records")
        else:
            # Auto-clear in non-interactive mode
            deleted = db.clear_attendance(date_filter)
            print(f"[OK] Cleared {deleted} records")
        
        return True
    else:
        print("[!] Archive failed")
        return False

def clear_only(db, date_filter=None, interactive=True):
    """Clear attendance without archiving"""
    records = db.get_attendance_records(date_filter)
    
    if not records:
        print("\n[!] No attendance records to clear")
        return False
    
    print(f"\n[WARNING] This will DELETE {len(records)} records WITHOUT archiving!")
    
    if interactive:
        view_attendance(db, date_filter)
        confirm = get_input("\n> Type 'DELETE' to confirm: ")
        if confirm != 'DELETE':
            print("[!] Clear cancelled")
            return False
    
    deleted = db.clear_attendance(date_filter)
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

def interactive_mode(db):
    """Run interactive CLI mode"""
    while True:
        clear_screen()
        print_header(db)
        print_menu()
        
        choice = get_input("\n> Select option (1-7): ")
        
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
            # Clear only
            print("\n[CLEAR OPTIONS]")
            print("  1. Clear today only")
            print("  2. Clear all")
            print("  3. Clear by date")
            sub = get_input("\n> Select (1-3): ")
            
            if sub == '1':
                today = datetime.now().strftime("%Y-%m-%d")
                clear_only(db, today)
            elif sub == '2':
                clear_only(db, None)
            elif sub == '3':
                date_str = get_input("\n> Enter date (YYYY-MM-DD): ")
                if date_str:
                    clear_only(db, date_str)
            input("\nPress Enter to continue...")
            
        elif choice == '5':
            # View attendance
            view_attendance(db)
            input("\nPress Enter to continue...")
            
        elif choice == '6':
            # List archives
            list_archives(db)
            input("\nPress Enter to continue...")
            
        elif choice == '7':
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
    
    args = parser.parse_args()
    
    # Initialize database
    db = ArchiveDatabase()
    
    try:
        # Command line mode
        if args.today:
            today = datetime.now().strftime("%Y-%m-%d")
            print(f"[*] Archiving attendance for {today}...")
            archive_attendance(db, today, interactive=False)
            
        elif args.all:
            print("[*] Archiving all attendance...")
            archive_attendance(db, None, interactive=False)
            
        elif args.date:
            print(f"[*] Archiving attendance for {args.date}...")
            archive_attendance(db, args.date, interactive=False)
            
        elif args.clear:
            today = datetime.now().strftime("%Y-%m-%d")
            print(f"[*] Clearing attendance for {today}...")
            clear_only(db, today, interactive=False)
            
        elif args.clear_all:
            print("[*] Clearing all attendance...")
            clear_only(db, None, interactive=False)
            
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
