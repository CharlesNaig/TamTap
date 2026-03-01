#!/usr/bin/env python3
"""
TAMTAP Database Stress Test
Compares write speed: Local MongoDB vs Cloud MongoDB vs JSON file.

Writes fake attendance records and measures time per operation.
Run from project root: python test/test_db_stress.py

Requirements: pymongo, python-dotenv
    pip install pymongo python-dotenv
"""

import json
import os
import sys
import time
import statistics
from datetime import datetime
from dotenv import load_dotenv

# Load .env from project root
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(PROJECT_ROOT, ".env"))

try:
    from pymongo import MongoClient
    from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError
except ImportError:
    print("[FATAL] pymongo not installed. Run: pip install pymongo")
    sys.exit(1)

# ============================================================================
# CONFIG
# ============================================================================

# From .env
CLOUD_URI = os.getenv("MONGODB_URI")
DB_NAME = os.getenv("MONGODB_NAME", "tamtap")

# Local MongoDB (direct localhost, no auth)
LOCAL_URI = "mongodb://tamtap.local:27017/"

# JSON test file
JSON_FILE = os.path.join(PROJECT_ROOT, "test", "test_stress_output.json")

# Test collection (isolated — won't touch real attendance)
TEST_COLLECTION = "stress_test"

# How many records to write per test
WRITE_COUNT = 50

# ============================================================================
# FAKE DATA GENERATOR
# ============================================================================

FAKE_STUDENTS = [
    {"nfc_id": f"STRESS_{i:04d}", "tamtap_id": f"TT-2026-{i:04d}",
     "first_name": f"Student{i}", "last_name": f"Test{i}",
     "name": f"Student{i} Test{i}", "grade": "12",
     "section": "ICT-B", "role": "student", "email": f"student{i}@test.local"}
    for i in range(1, WRITE_COUNT + 1)
]


def make_attendance_record(student, index):
    """Build a realistic attendance record matching the schema in database.py."""
    now = datetime.now()
    return {
        "nfc_id": student["nfc_id"],
        "name": student["name"],
        "role": student["role"],
        "date": now.strftime("%Y-%m-%d %H:%M:%S"),
        "time": now.strftime("%H:%M:%S"),
        "photo": f"stress_test_{index}.jpg",
        "photo_path": f"/tmp/stress_test_{index}.jpg",
        "session": "AM" if now.hour < 12 else "PM",
        "status": "present",
        "tamtap_id": student["tamtap_id"],
        "email": student["email"],
        "first_name": student["first_name"],
        "last_name": student["last_name"],
        "grade": student["grade"],
        "section": student["section"],
        "_stress_test": True  # marker for easy cleanup
    }


# ============================================================================
# TEST: LOCAL MONGODB
# ============================================================================

def test_local_mongodb():
    """Write N records to local MongoDB, measure per-write and total time."""
    print(f"\n{'='*60}")
    print(f"  LOCAL MongoDB ({LOCAL_URI})")
    print(f"  Writing {WRITE_COUNT} attendance records...")
    print(f"{'='*60}")

    try:
        client = MongoClient(LOCAL_URI, serverSelectionTimeoutMS=3000)
        client.admin.command("ping")
    except Exception as e:
        print(f"  [SKIP] Cannot connect to local MongoDB: {e}")
        return None

    db = client[DB_NAME]
    col = db[TEST_COLLECTION]

    # Clean previous test data
    col.delete_many({"_stress_test": True})

    times = []
    for i, student in enumerate(FAKE_STUDENTS):
        record = make_attendance_record(student, i)
        start = time.perf_counter()
        col.insert_one(record)
        elapsed = time.perf_counter() - start
        times.append(elapsed)

    # Cleanup
    col.delete_many({"_stress_test": True})
    client.close()

    return print_results("LOCAL MongoDB", times)


# ============================================================================
# TEST: CLOUD MONGODB (DigitalOcean)
# ============================================================================

def test_cloud_mongodb():
    """Write N records to cloud MongoDB, measure per-write and total time."""
    print(f"\n{'='*60}")
    print(f"  CLOUD MongoDB ({CLOUD_URI.split('@')[-1] if '@' in CLOUD_URI else CLOUD_URI})")
    print(f"  Writing {WRITE_COUNT} attendance records...")
    print(f"{'='*60}")

    try:
        client = MongoClient(CLOUD_URI, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
    except Exception as e:
        print(f"  [SKIP] Cannot connect to cloud MongoDB: {e}")
        return None

    db = client[DB_NAME]
    col = db[TEST_COLLECTION]

    # Clean previous test data
    col.delete_many({"_stress_test": True})

    times = []
    for i, student in enumerate(FAKE_STUDENTS):
        record = make_attendance_record(student, i)
        start = time.perf_counter()
        col.insert_one(record)
        elapsed = time.perf_counter() - start
        times.append(elapsed)

    # Cleanup
    col.delete_many({"_stress_test": True})
    client.close()

    return print_results("CLOUD MongoDB", times)


# ============================================================================
# TEST: JSON FILE
# ============================================================================

def test_json_file():
    """Write N records to a JSON file (read-modify-write each time), measure time."""
    print(f"\n{'='*60}")
    print(f"  JSON FILE ({JSON_FILE})")
    print(f"  Writing {WRITE_COUNT} attendance records...")
    print(f"{'='*60}")

    # Start with empty file
    if os.path.exists(JSON_FILE):
        os.remove(JSON_FILE)

    times = []
    for i, student in enumerate(FAKE_STUDENTS):
        record = make_attendance_record(student, i)
        # Remove ObjectId-incompatible marker for JSON
        record.pop("_stress_test", None)

        start = time.perf_counter()

        # Realistic JSON write: read → append → write (same as database.py _save_json)
        if os.path.exists(JSON_FILE):
            with open(JSON_FILE, "r") as f:
                data = json.load(f)
        else:
            data = {"pending_attendance": []}

        data["pending_attendance"].append(record)

        with open(JSON_FILE, "w") as f:
            json.dump(data, f, indent=2)

        elapsed = time.perf_counter() - start
        times.append(elapsed)

    # Cleanup
    if os.path.exists(JSON_FILE):
        os.remove(JSON_FILE)

    return print_results("JSON FILE", times)


# ============================================================================
# RESULTS
# ============================================================================

def print_results(label, times):
    """Print timing stats and return summary dict."""
    total = sum(times)
    avg = statistics.mean(times)
    med = statistics.median(times)
    fastest = min(times)
    slowest = max(times)
    stdev = statistics.stdev(times) if len(times) > 1 else 0

    print(f"\n  Results for {label}:")
    print(f"  ┌──────────────────────────────────────┐")
    print(f"  │ Records written:  {len(times):>8}           │")
    print(f"  │ Total time:       {total:>8.3f}s          │")
    print(f"  │ Avg per write:    {avg*1000:>8.2f}ms         │")
    print(f"  │ Median per write: {med*1000:>8.2f}ms         │")
    print(f"  │ Fastest write:    {fastest*1000:>8.2f}ms         │")
    print(f"  │ Slowest write:    {slowest*1000:>8.2f}ms         │")
    print(f"  │ Std deviation:    {stdev*1000:>8.2f}ms         │")
    print(f"  └──────────────────────────────────────┘")

    return {
        "label": label,
        "count": len(times),
        "total_s": round(total, 4),
        "avg_ms": round(avg * 1000, 2),
        "median_ms": round(med * 1000, 2),
        "min_ms": round(fastest * 1000, 2),
        "max_ms": round(slowest * 1000, 2),
        "stdev_ms": round(stdev * 1000, 2),
    }


def print_comparison(results):
    """Side-by-side comparison of all tests."""
    valid = [r for r in results if r is not None]
    if len(valid) < 2:
        print("\n  [!] Need at least 2 successful tests for comparison.")
        return

    print(f"\n{'='*60}")
    print(f"  COMPARISON — {WRITE_COUNT} writes each")
    print(f"{'='*60}")

    # Header
    print(f"\n  {'Metric':<20}", end="")
    for r in valid:
        print(f" {r['label']:>16}", end="")
    print()
    print(f"  {'─'*20}", end="")
    for _ in valid:
        print(f" {'─'*16}", end="")
    print()

    # Rows
    for key, label in [
        ("total_s", "Total (s)"),
        ("avg_ms", "Avg/write (ms)"),
        ("median_ms", "Median (ms)"),
        ("min_ms", "Fastest (ms)"),
        ("max_ms", "Slowest (ms)"),
        ("stdev_ms", "Std Dev (ms)"),
    ]:
        print(f"  {label:<20}", end="")
        for r in valid:
            print(f" {r[key]:>16}", end="")
        print()

    # Speed difference
    if len(valid) >= 2:
        print(f"\n  Speed difference (avg):")
        base = valid[0]
        for other in valid[1:]:
            if base["avg_ms"] > 0:
                ratio = other["avg_ms"] / base["avg_ms"]
                faster_slower = "slower" if ratio > 1 else "faster"
                print(f"    {other['label']} is {ratio:.1f}x {faster_slower} than {base['label']}")


# ============================================================================
# MAIN
# ============================================================================

def main():
    print("╔══════════════════════════════════════════════════════════╗")
    print("║  TAMTAP Database Write Stress Test                      ║")
    print("║  Compares: Local MongoDB vs Cloud MongoDB vs JSON File  ║")
    print(f"║  Records per test: {WRITE_COUNT:<38}║")
    print(f"║  Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S'):<47}║")
    print("╚══════════════════════════════════════════════════════════╝")

    results = []

    # Run all three tests
    results.append(test_local_mongodb())
    results.append(test_cloud_mongodb())
    results.append(test_json_file())

    # Comparison table
    print_comparison(results)

    print(f"\n{'='*60}")
    print("  DONE. All test data cleaned up.")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
