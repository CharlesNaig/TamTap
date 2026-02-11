#!/usr/bin/env python3
"""
TAMTAP v8.0 - Attendance Archive & Management Utility
Archive, clear, and manage attendance records with granular options.

Usage:
    python archive_attendance.py              # Interactive mode
    python archive_attendance.py --today      # Archive today's attendance
    python archive_attendance.py --all        # Archive all attendance
    python archive_attendance.py --clear      # Clear without archiving
    python archive_attendance.py --student <NFC_ID>              # Archive all for a student
    python archive_attendance.py --student <NFC_ID> --today      # Archive student's today
    python archive_attendance.py --student <NFC_ID> --date 2026-02-10  # Archive student's date
    python archive_attendance.py --section "ICT-A"               # Archive whole section
    python archive_attendance.py --section "ICT-A" --today       # Archive section today
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
    
    def get_attendance_records(self, date_filter=None, nfc_filter=None, section_filter=None):
        """Get attendance records with flexible filters
        
        Args:
            date_filter: Filter by date prefix (YYYY-MM-DD)
            nfc_filter: Filter by student nfc_id
            section_filter: Filter by section name
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
                if section_filter:
                    query["section"] = section_filter
                
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
        if section_filter:
            all_records = [r for r in all_records if r.get("section") == section_filter]
        
        return all_records
    
    def get_unique_students(self, date_filter=None, section_filter=None):
        """Get list of unique students from attendance records"""
        records = self.get_attendance_records(date_filter, section_filter=section_filter)
        students = {}
        for r in records:
            nfc_id = r.get("nfc_id", "unknown")
            if nfc_id not in students:
                students[nfc_id] = {
                    "nfc_id": nfc_id,
                    "tamtap_id": r.get("tamtap_id", "???"),
                    "name": r.get("name", "Unknown"),
                    "section": r.get("section", ""),
                    "count": 0
                }
            students[nfc_id]["count"] += 1
        result = list(students.values())
        result.sort(key=lambda s: s.get("tamtap_id", "999"))
        return result
    
    def get_unique_sections(self, date_filter=None):
        """Get list of unique sections from attendance records"""
        records = self.get_attendance_records(date_filter)
        sections = {}
        for r in records:
            sec = r.get("section", "Unknown")
            if sec not in sections:
                sections[sec] = {"section": sec, "count": 0, "students": set()}
            sections[sec]["count"] += 1
            sections[sec]["students"].add(r.get("nfc_id", "unknown"))
        
        result = []
        for sec_name, info in sorted(sections.items()):
            result.append({
                "section": sec_name,
                "record_count": info["count"],
                "student_count": len(info["students"])
            })
        return result
    
    def get_unique_dates(self, nfc_filter=None, section_filter=None):
        """Get list of unique dates from attendance records"""
        records = self.get_attendance_records(nfc_filter=nfc_filter, section_filter=section_filter)
        dates = {}
        for r in records:
            date_str = r.get("date", "")[:10]
            if date_str:
                dates[date_str] = dates.get(date_str, 0) + 1
        
        result = [{"date": d, "count": c} for d, c in sorted(dates.items(), reverse=True)]
        return result
    
    def get_registered_students(self, section_filter=None):
        """Get registered students (from DB, not attendance) optionally filtered by section"""
        students, _ = self.get_all_users()
        if section_filter:
            students = [s for s in students if s.get("section") == section_filter]
        return sorted(students, key=lambda s: s.get("tamtap_id", "999"))
    
    def get_registered_sections(self):
        """Get unique sections from registered students"""
        students, _ = self.get_all_users()
        sections = set()
        for s in students:
            sec = s.get("section", "")
            if sec:
                sections.add(sec)
        return sorted(sections)
    
    def archive_to_mongodb(self, records, archive_name):
        """Archive records to MongoDB archive collection"""
        if not self._check_mongodb():
            return False, 0
        
        try:
            archive_doc = {
                "archive_name": archive_name,
                "archived_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "record_count": len(records),
                "records": records
            }
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
            
            existing = []
            if os.path.exists(filename):
                try:
                    with open(filename, 'r') as f:
                        data = json.load(f)
                        existing = data.get("records", [])
                except Exception:
                    pass
            
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
    
    def clear_attendance(self, date_filter=None, nfc_filter=None, section_filter=None):
        """Clear attendance records from both MongoDB and JSON
        
        Args:
            date_filter: Filter by date prefix (YYYY-MM-DD)
            nfc_filter: Filter by student nfc_id
            section_filter: Filter by section name
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
                if section_filter:
                    query["section"] = section_filter
                
                result = self.mongo_db.attendance.delete_many(query)
                deleted_mongo = result.deleted_count
                logger.info("Deleted %d records from MongoDB", deleted_mongo)
            except Exception as e:
                logger.error("MongoDB delete error: %s", e)
        
        # Clear from JSON
        data = self._load_json()
        original_count = len(data.get("attendance", [])) + len(data.get("pending_attendance", []))
        
        def should_delete(r):
            """Return True if record matches ALL active filters"""
            if date_filter and not r.get("date", "").startswith(date_filter):
                return False
            if nfc_filter and r.get("nfc_id") != nfc_filter:
                return False
            if section_filter and r.get("section") != section_filter:
                return False
            # If no filters, delete all; if filters given, must match all
            if not date_filter and not nfc_filter and not section_filter:
                return True
            return True
        
        data["attendance"] = [r for r in data.get("attendance", []) if not should_delete(r)]
        data["pending_attendance"] = [r for r in data.get("pending_attendance", []) if not should_delete(r)]
        
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
# CLI HELPERS
# ========================================
def clear_screen():
    os.system('cls' if os.name == 'nt' else 'clear')

def print_header(db):
    print("=" * 60)
    print("   TAMTAP v8.0 - ATTENDANCE ARCHIVE & MANAGEMENT")
    print("   Archive, Clear & Manage Records")
    db_status = "[MongoDB]" if db._check_mongodb() else "[JSON Fallback]"
    print(f"   Database: {db_status}")
    print("=" * 60)

def print_menu():
    print("\n[MAIN MENU]")
    print("-" * 45)
    print("  1.  Archive TODAY's attendance (all)")
    print("  2.  Archive ALL attendance (all time)")
    print("  3.  Archive by specific DATE")
    print("  4.  Archive by STUDENT (one user)")
    print("  5.  Archive by SECTION (whole section)")
    print("  6.  Archive BULK students (pick multiple)")
    print("-" * 45)
    print("  7.  Clear attendance (with options)")
    print("  8.  View current attendance")
    print("  9.  View attendance stats")
    print("  10. List past archives")
    print("  11. Exit")
    print("-" * 45)

def get_input(prompt, required=True):
    try:
        value = input(prompt).strip()
        if required and not value:
            return None
        return value
    except (KeyboardInterrupt, EOFError):
        return None

def view_attendance(db, date_filter=None, nfc_filter=None, section_filter=None, limit=30):
    """View current attendance records"""
    records = db.get_attendance_records(date_filter, nfc_filter, section_filter)
    
    if not records:
        print("\n[!] No attendance records found")
        return
    
    label_parts = []
    if date_filter:
        label_parts.append(f"date={date_filter}")
    if nfc_filter:
        label_parts.append(f"nfc={nfc_filter}")
    if section_filter:
        label_parts.append(f"section={section_filter}")
    label = f" [{', '.join(label_parts)}]" if label_parts else ""
    
    print(f"\n[ATTENDANCE RECORDS]{label} ({len(records)} total)")
    print("-" * 70)
    print(f"  {'#':>3}  {'Name':<22} {'Section':<12} {'Date':<12} {'Time':<8} {'Status':<8}")
    print("-" * 70)
    
    for i, record in enumerate(records[:limit], 1):
        name = record.get("name", "Unknown")[:20]
        section = record.get("section", "?")[:10]
        date = record.get("date", "")[:10]
        time = record.get("time", "")[:8]
        status = record.get("status", "?")[:7]
        print(f"  {i:3}  {name:<22} {section:<12} {date:<12} {time:<8} {status:<8}")
    
    if len(records) > limit:
        print(f"\n  ... and {len(records) - limit} more records")
    
    print("-" * 70)


# ========================================
# PICKER UTILITIES
# ========================================
def pick_student(db, date_filter=None, section_filter=None):
    """Show students with attendance and let user pick one. Returns nfc_id or None."""
    students = db.get_unique_students(date_filter, section_filter)
    
    if not students:
        print("\n[!] No students found in attendance records")
        return None
    
    scope_parts = []
    if date_filter:
        scope_parts.append(date_filter)
    if section_filter:
        scope_parts.append(section_filter)
    scope = f" ({', '.join(scope_parts)})" if scope_parts else " (all)"
    
    print(f"\n[STUDENTS WITH ATTENDANCE]{scope}")
    print("-" * 60)
    for i, s in enumerate(students, 1):
        tid = s.get('tamtap_id', '???')
        sec = s.get('section', '?')
        print(f"  {i:2}. [{tid}] {s['name'][:25]:<25} | {sec:<12} | {s['count']} rec")
    print("-" * 60)
    
    pick = get_input(f"\n> Select student (1-{len(students)}): ")
    if not pick or not pick.isdigit():
        return None
    idx = int(pick) - 1
    if idx < 0 or idx >= len(students):
        print("[!] Invalid selection")
        return None
    
    return students[idx]["nfc_id"]

def pick_multiple_students(db, date_filter=None, section_filter=None):
    """Let user pick multiple students. Returns list of nfc_ids."""
    students = db.get_unique_students(date_filter, section_filter)
    
    if not students:
        print("\n[!] No students found in attendance records")
        return []
    
    print(f"\n[SELECT MULTIPLE STUDENTS] ({len(students)} available)")
    print("-" * 60)
    for i, s in enumerate(students, 1):
        tid = s.get('tamtap_id', '???')
        sec = s.get('section', '?')
        print(f"  {i:2}. [{tid}] {s['name'][:25]:<25} | {sec:<12} | {s['count']} rec")
    print("-" * 60)
    print("  Enter numbers separated by commas (e.g., 1,3,5)")
    print("  Or type 'all' to select all")
    
    pick = get_input("\n> Selection: ")
    if not pick:
        return []
    
    if pick.lower() == 'all':
        return [s["nfc_id"] for s in students]
    
    selected = []
    for part in pick.split(','):
        part = part.strip()
        if part.isdigit():
            idx = int(part) - 1
            if 0 <= idx < len(students):
                selected.append(students[idx]["nfc_id"])
            else:
                print(f"[!] Invalid number: {part}")
    
    return selected

def pick_section_from_attendance(db, date_filter=None):
    """Show sections from attendance records and let user pick. Returns section name or None."""
    sections = db.get_unique_sections(date_filter)
    
    if not sections:
        print("\n[!] No sections found in attendance records")
        return None
    
    print(f"\n[SECTIONS WITH ATTENDANCE]")
    print("-" * 55)
    for i, s in enumerate(sections, 1):
        print(f"  {i:2}. {s['section']:<20} | {s['student_count']} students | {s['record_count']} records")
    print("-" * 55)
    
    pick = get_input(f"\n> Select section (1-{len(sections)}): ")
    if not pick or not pick.isdigit():
        return None
    idx = int(pick) - 1
    if idx < 0 or idx >= len(sections):
        print("[!] Invalid selection")
        return None
    
    return sections[idx]["section"]

def pick_date(db, nfc_filter=None, section_filter=None):
    """Show available dates and let user pick. Returns date string or None."""
    dates = db.get_unique_dates(nfc_filter, section_filter)
    
    if not dates:
        print("\n[!] No dates found")
        return None
    
    print(f"\n[AVAILABLE DATES]")
    print("-" * 35)
    for i, d in enumerate(dates, 1):
        print(f"  {i:2}. {d['date']}  ({d['count']} records)")
    print("-" * 35)
    print("  Or type a date manually (YYYY-MM-DD)")
    
    pick = get_input(f"\n> Select (1-{len(dates)}) or type date: ")
    if not pick:
        return None
    
    if pick.isdigit():
        idx = int(pick) - 1
        if 0 <= idx < len(dates):
            return dates[idx]["date"]
        print("[!] Invalid selection")
        return None
    
    # Manual date input
    if len(pick) == 10 and pick[4] == '-' and pick[7] == '-':
        return pick
    
    print("[!] Invalid date format. Use YYYY-MM-DD")
    return None


# ========================================
# ARCHIVE OPERATIONS
# ========================================
def archive_records(db, date_filter=None, nfc_filter=None, section_filter=None, interactive=True):
    """Generic archive function with flexible filters"""
    records = db.get_attendance_records(date_filter, nfc_filter, section_filter)
    
    if not records:
        print("\n[!] No attendance records to archive")
        return False
    
    # Build label
    label_parts = []
    if nfc_filter:
        name = records[0].get("name", "Unknown")
        tid = records[0].get("tamtap_id", "???")
        label_parts.append(f"student {name} (ID: {tid})")
    if section_filter:
        label_parts.append(f"section {section_filter}")
    if date_filter:
        label_parts.append(f"date {date_filter}")
    label = f" for {', '.join(label_parts)}" if label_parts else ""
    
    print(f"\n[*] Found {len(records)} records{label}")
    
    if interactive:
        view_attendance(db, date_filter, nfc_filter, section_filter)
    
    # Generate archive name
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    parts = ["archive"]
    if nfc_filter:
        tid = records[0].get("tamtap_id", "unknown") if records else "unknown"
        parts.append(f"student_{tid}")
    if section_filter:
        parts.append(f"section_{section_filter.replace(' ', '_')}")
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
    
    # Archive to both
    success_mongo, _ = db.archive_to_mongodb(records, archive_name)
    success_json, count = db.archive_to_json(records, archive_name)
    
    if success_mongo or success_json:
        print(f"\n[OK] Archived {count} records: {archive_name}")
        
        if interactive:
            clear = get_input("\n> Clear these records from active database? (y/n): ")
            if clear and clear.lower() in ['y', 'yes']:
                deleted = db.clear_attendance(date_filter, nfc_filter, section_filter)
                print(f"[OK] Cleared {deleted} records")
        else:
            deleted = db.clear_attendance(date_filter, nfc_filter, section_filter)
            print(f"[OK] Cleared {deleted} records")
        
        return True
    else:
        print("[!] Archive failed")
        return False

def clear_with_options(db):
    """Clear attendance with granular options"""
    print("\n[CLEAR OPTIONS]")
    print("-" * 45)
    print("  1. Clear today only (all students)")
    print("  2. Clear specific date (all students)")
    print("  3. Clear one student (all dates)")
    print("  4. Clear one student (specific date)")
    print("  5. Clear whole section (all dates)")
    print("  6. Clear whole section (specific date)")
    print("  7. Clear EVERYTHING (nuclear option)")
    print("  8. Back to menu")
    print("-" * 45)
    
    choice = get_input("\n> Select (1-8): ")
    
    if not choice or choice == '8':
        return
    
    date_f = None
    nfc_f = None
    section_f = None
    
    if choice == '1':
        date_f = datetime.now().strftime("%Y-%m-%d")
        label = f"today ({date_f})"
    
    elif choice == '2':
        date_f = pick_date(db)
        if not date_f:
            return
        label = f"date {date_f}"
    
    elif choice == '3':
        nfc_f = pick_student(db)
        if not nfc_f:
            return
        label = f"student NFC={nfc_f}"
    
    elif choice == '4':
        nfc_f = pick_student(db)
        if not nfc_f:
            return
        date_f = pick_date(db, nfc_filter=nfc_f)
        if not date_f:
            return
        label = f"student NFC={nfc_f}, date {date_f}"
    
    elif choice == '5':
        section_f = pick_section_from_attendance(db)
        if not section_f:
            return
        label = f"section {section_f}"
    
    elif choice == '6':
        section_f = pick_section_from_attendance(db)
        if not section_f:
            return
        date_f = pick_date(db, section_filter=section_f)
        if not date_f:
            return
        label = f"section {section_f}, date {date_f}"
    
    elif choice == '7':
        label = "ALL RECORDS"
    
    else:
        print("[!] Invalid option")
        return
    
    # Get count for confirmation
    records = db.get_attendance_records(date_f, nfc_f, section_f)
    
    if not records:
        print("\n[!] No matching records found")
        return
    
    print(f"\n[WARNING] Will DELETE {len(records)} records ({label})")
    print("[WARNING] This cannot be undone!")
    
    view_attendance(db, date_f, nfc_f, section_f, limit=10)
    
    confirm = get_input("\n> Type 'DELETE' to confirm: ")
    if confirm != 'DELETE':
        print("[!] Clear cancelled")
        return
    
    deleted = db.clear_attendance(date_f, nfc_f, section_f)
    print(f"\n[OK] Cleared {deleted} records ({label})")

def view_stats(db):
    """Show attendance statistics overview"""
    print("\n[ATTENDANCE STATISTICS]")
    print("=" * 60)
    
    # Total records
    all_records = db.get_attendance_records()
    print(f"\n  Total Records:  {len(all_records)}")
    
    # By date
    dates = db.get_unique_dates()
    print(f"  Unique Dates:   {len(dates)}")
    if dates:
        print(f"  Latest:         {dates[0]['date']} ({dates[0]['count']} records)")
        if len(dates) > 1:
            print(f"  Oldest:         {dates[-1]['date']} ({dates[-1]['count']} records)")
    
    # By section
    sections = db.get_unique_sections()
    print(f"\n  Sections:       {len(sections)}")
    if sections:
        print("  " + "-" * 50)
        for s in sections:
            print(f"    {s['section']:<20} {s['student_count']:>3} students  {s['record_count']:>5} records")
    
    # By student count
    students = db.get_unique_students()
    print(f"\n  Unique Students: {len(students)}")
    
    # Archives
    archives = db.list_archives()
    print(f"  Archives:        {len(archives)}")
    
    print("\n" + "=" * 60)

def list_archives(db):
    """List all archives"""
    archives = db.list_archives()
    
    if not archives:
        print("\n[!] No archives found")
        return
    
    print(f"\n[ARCHIVES] ({len(archives)} total)")
    print("-" * 70)
    print(f"  {'Source':<8} | {'Name':<35} | {'Count':<6} | Archived At")
    print("-" * 70)
    
    for archive in archives:
        source = archive.get("source", "?")
        name = archive.get("name", "?")[:35]
        count = archive.get("count", 0)
        archived_at = archive.get("archived_at", "?")
        print(f"  {source:<8} | {name:<35} | {count:<6} | {archived_at}")
    
    print("-" * 70)


# ========================================
# INTERACTIVE MODE
# ========================================
def interactive_mode(db):
    """Run interactive CLI mode"""
    while True:
        clear_screen()
        print_header(db)
        print_menu()
        
        choice = get_input("\n> Select option (1-11): ")
        
        if not choice:
            continue
        
        if choice == '1':
            # Archive today (all)
            today = datetime.now().strftime("%Y-%m-%d")
            archive_records(db, date_filter=today)
            input("\nPress Enter to continue...")
            
        elif choice == '2':
            # Archive all
            archive_records(db)
            input("\nPress Enter to continue...")
            
        elif choice == '3':
            # Archive by date
            date_str = pick_date(db)
            if date_str:
                archive_records(db, date_filter=date_str)
            input("\nPress Enter to continue...")
            
        elif choice == '4':
            # Archive by student
            print("\n[ARCHIVE SINGLE STUDENT]")
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
                date_f = pick_date(db)
                if not date_f:
                    input("\nPress Enter to continue...")
                    continue
            else:
                print("[!] Invalid option")
                input("\nPress Enter to continue...")
                continue
            
            nfc = pick_student(db, date_f)
            if nfc:
                archive_records(db, date_filter=date_f, nfc_filter=nfc)
            input("\nPress Enter to continue...")
            
        elif choice == '5':
            # Archive by section
            print("\n[ARCHIVE WHOLE SECTION]")
            print("  1. Section - today's records")
            print("  2. Section - all records")
            print("  3. Section - specific date")
            sub = get_input("\n> Select (1-3): ")
            
            date_f = None
            if sub == '1':
                date_f = datetime.now().strftime("%Y-%m-%d")
            elif sub == '2':
                date_f = None
            elif sub == '3':
                date_f = pick_date(db)
                if not date_f:
                    input("\nPress Enter to continue...")
                    continue
            else:
                print("[!] Invalid option")
                input("\nPress Enter to continue...")
                continue
            
            section = pick_section_from_attendance(db, date_f)
            if section:
                archive_records(db, date_filter=date_f, section_filter=section)
            input("\nPress Enter to continue...")
            
        elif choice == '6':
            # Archive bulk students (pick multiple)
            print("\n[ARCHIVE BULK STUDENTS]")
            print("  1. Bulk students - today")
            print("  2. Bulk students - all dates")
            print("  3. Bulk students - specific date")
            sub = get_input("\n> Select (1-3): ")
            
            date_f = None
            if sub == '1':
                date_f = datetime.now().strftime("%Y-%m-%d")
            elif sub == '2':
                date_f = None
            elif sub == '3':
                date_f = pick_date(db)
                if not date_f:
                    input("\nPress Enter to continue...")
                    continue
            else:
                print("[!] Invalid option")
                input("\nPress Enter to continue...")
                continue
            
            nfc_list = pick_multiple_students(db, date_f)
            if nfc_list:
                print(f"\n[*] Archiving {len(nfc_list)} student(s)...")
                for nfc_id in nfc_list:
                    archive_records(db, date_filter=date_f, nfc_filter=nfc_id, interactive=False)
                print(f"\n[OK] Bulk archive complete for {len(nfc_list)} student(s)")
            input("\nPress Enter to continue...")
            
        elif choice == '7':
            # Clear with options
            clear_with_options(db)
            input("\nPress Enter to continue...")
            
        elif choice == '8':
            # View attendance
            print("\n[VIEW OPTIONS]")
            print("  1. View all")
            print("  2. View today")
            print("  3. View by date")
            print("  4. View by student")
            print("  5. View by section")
            sub = get_input("\n> Select (1-5): ")
            
            if sub == '1':
                view_attendance(db)
            elif sub == '2':
                view_attendance(db, date_filter=datetime.now().strftime("%Y-%m-%d"))
            elif sub == '3':
                d = pick_date(db)
                if d:
                    view_attendance(db, date_filter=d)
            elif sub == '4':
                nfc = pick_student(db)
                if nfc:
                    view_attendance(db, nfc_filter=nfc)
            elif sub == '5':
                sec = pick_section_from_attendance(db)
                if sec:
                    view_attendance(db, section_filter=sec)
            input("\nPress Enter to continue...")
            
        elif choice == '9':
            # Stats
            view_stats(db)
            input("\nPress Enter to continue...")
            
        elif choice == '10':
            # List archives
            list_archives(db)
            input("\nPress Enter to continue...")
            
        elif choice == '11':
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
        description='TAMTAP v8.0 - Attendance Archive & Management Utility',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python archive_attendance.py                                     # Interactive mode
  python archive_attendance.py --today                             # Archive today (all)
  python archive_attendance.py --all                               # Archive everything
  python archive_attendance.py --date 2026-02-10                   # Archive specific date
  python archive_attendance.py --student 100582761834              # Archive student (all dates)
  python archive_attendance.py --student 100582761834 --today      # Archive student today
  python archive_attendance.py --student 100582761834 --date 2026-02-10
  python archive_attendance.py --section "ICT-A"                   # Archive whole section
  python archive_attendance.py --section "ICT-A" --today           # Archive section today
  python archive_attendance.py --section "ICT-A" --date 2026-02-10
  python archive_attendance.py --clear                             # Clear today (no archive)
  python archive_attendance.py --clear-all                         # Clear everything
  python archive_attendance.py --clear --student 100582761834      # Clear one student
  python archive_attendance.py --clear --section "ICT-A"           # Clear whole section
  python archive_attendance.py --list                              # List archives
        """
    )
    
    parser.add_argument('--today', action='store_true', help='Archive today\'s attendance')
    parser.add_argument('--all', action='store_true', help='Archive all attendance')
    parser.add_argument('--date', type=str, help='Archive specific date (YYYY-MM-DD)')
    parser.add_argument('--student', type=str, help='Filter by student nfc_id')
    parser.add_argument('--section', type=str, help='Filter by section name')
    parser.add_argument('--clear', action='store_true', help='Clear attendance without archiving')
    parser.add_argument('--clear-all', action='store_true', help='Clear all attendance without archiving')
    parser.add_argument('--list', action='store_true', help='List all archives')
    
    args = parser.parse_args()
    
    db = ArchiveDatabase()
    
    try:
        # Non-interactive mode
        if args.list:
            list_archives(db)
        
        elif args.clear or args.clear_all:
            date_f = datetime.now().strftime("%Y-%m-%d") if args.clear and not args.clear_all else None
            if args.date:
                date_f = args.date
            
            label_parts = []
            if date_f:
                label_parts.append(f"date={date_f}")
            if args.student:
                label_parts.append(f"student={args.student}")
            if args.section:
                label_parts.append(f"section={args.section}")
            label = ', '.join(label_parts) if label_parts else "ALL"
            
            print(f"[*] Clearing attendance ({label})...")
            deleted = db.clear_attendance(date_f, args.student, args.section)
            print(f"[OK] Cleared {deleted} records")
        
        elif args.today:
            today = datetime.now().strftime("%Y-%m-%d")
            print(f"[*] Archiving {today}...")
            archive_records(db, date_filter=today, nfc_filter=args.student, section_filter=args.section, interactive=False)
        
        elif args.all:
            print("[*] Archiving all attendance...")
            archive_records(db, nfc_filter=args.student, section_filter=args.section, interactive=False)
        
        elif args.date:
            print(f"[*] Archiving {args.date}...")
            archive_records(db, date_filter=args.date, nfc_filter=args.student, section_filter=args.section, interactive=False)
        
        elif args.student:
            print(f"[*] Archiving all for student {args.student}...")
            archive_records(db, nfc_filter=args.student, section_filter=args.section, interactive=False)
        
        elif args.section:
            print(f"[*] Archiving all for section {args.section}...")
            archive_records(db, section_filter=args.section, interactive=False)
        
        else:
            interactive_mode(db)
            
    except KeyboardInterrupt:
        print("\n\n[*] Interrupted")
    finally:
        db.close()


if __name__ == "__main__":
    main()
