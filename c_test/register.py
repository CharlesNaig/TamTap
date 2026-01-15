#!/usr/bin/env python3
# 🚀 TAMTAP CLI REGISTRATION - NO LCD REQUIRED
# Save as: register_cli.py

import json
import os
from datetime import datetime
from mfrc522 import SimpleMFRC522
import time
import sys

DB_FILE = "tamtap_users.json"

def clear_screen():
    os.system('clear' if os.name == 'posix' else 'cls')

def load_db():
    if os.path.exists(DB_FILE):
        with open(DB_FILE, 'r') as f:
            return json.load(f)
    return {"students": {}, "teachers": {}, "attendance": []}

def save_db(db):
    with open(DB_FILE, 'w') as f:
        json.dump(db, f, indent=2)

def scan_rfid():
    """Scan RFID with 5-second timeout"""
    print("👆 Tap RFID card within 5 seconds (or press Ctrl+C to skip)...")
    reader = SimpleMFRC522()
    try:
        for i in range(50):  # 5 seconds
            id, text = reader.read_no_block()
            if id:
                uid = str(id)
                print(f"✅ RFID scanned: {uid}")
                return uid
            time.sleep(0.1)
        print("⏰ No card detected - enter manually")
        return None
    except:
        return None

def print_banner():
    clear_screen()
    print("🚀 TAMTAP REGISTRATION SYSTEM")
    print("=" * 50)
    print("📱 CLI Mode - Perfect for headless Raspberry Pi")
    print()

def register_user(role):
    print_banner()
    print(f"📚 Role: {role.upper()}")
    print("-" * 40)
    
    # Get name
    while True:
        name = input("👤 Full Name: ").strip()
        if name:
            break
        print("❌ Name required!")
    
    # Get RFID
    uid = scan_rfid()
    if not uid:
        while True:
            uid = input("🆔 Enter RFID UID manually: ").strip()
            if uid:
                break
            print("❌ UID required!")
    
    # Optional grade
    grade = input("📖 Grade/Section (press Enter to skip): ").strip()
    
    # Check duplicates
    db = load_db()
    if uid in db["students"] or uid in db["teachers"]:
        print(f"❌ UID {uid} already registered!")
        input("Press Enter to continue...")
        return False
    
    # Save user
    db[role][uid] = {
        "name": name,
        "grade": grade or "",
        "registered": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    save_db(db)
    
    print_banner()
    print("✅ REGISTRATION SUCCESS!")
    print("-" * 40)
    print(f"👤 Name: {name}")
    print(f"🆔 UID:  {uid}")
    print(f"📚 Role: {role.upper()}")
    print(f"📅 Date: {db[role][uid]['registered']}")
    print()
    print("🎉 Card ready for attendance system!")
    input("\nPress Enter to continue...")
    return True

def view_database():
    print_banner()
    db = load_db()
    print("📊 REGISTERED USERS")
    print("-" * 40)
    
    total_students = len(db["students"])
    total_teachers = len(db["teachers"])
    
    print(f"📚 Students: {total_students}")
    print(f"👨‍🏫 Teachers: {total_teachers}")
    print(f"👥 Total: {total_students + total_teachers}")
    print()
    
    if total_students > 0:
        print("📚 STUDENTS (first 5):")
        for i, (uid, data) in enumerate(list(db["students"].items())[:5]):
            print(f"  {uid}: {data['name']} {f'(Grade {data['grade']})' if data['grade'] else ''}")
    
    if total_teachers > 0:
        print("\n👨‍🏫 TEACHERS (first 5):")
        for i, (uid, data) in enumerate(list(db["teachers"].items())[:5]):
            print(f"  {uid}: {data['name']}")
    
    input("\nPress Enter to continue...")

# ========================================
# MAIN PROGRAM
# ========================================
def main():
    try:
        while True:
            print_banner()
            print("1. 📚 Register Student")
            print("2. 👨‍🏫 Register Teacher") 
            print("3. 👀 View Database")
            print("4. ❌ Exit")
            print("-" * 40)
            
            choice = input("Select (1-4): ").strip()
            
            if choice == "1":
                register_user("students")
                
            elif choice == "2":
                register_user("teachers")
                
            elif choice == "3":
                view_database()
                
            elif choice == "4":
                print_banner()
                print("👋 TAMTAP Registration closed!")
                print("✅ Database saved to tamtap_users.json")
                sys.exit(0)
                
            else:
                print("❌ Invalid choice! Press Enter...")
                input()
                
    except KeyboardInterrupt:
        print("\n\n👋 Goodbye!")
        sys.exit(0)

if __name__ == "__main__":
    main()
