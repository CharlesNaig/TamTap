# 📋 Plan: Write-First, Sync-Later (Hardware DB Optimization)

**Status:** APPROVED — Ready for implementation  
**Author:** Copilot  
**Date:** 2026-02-08  
**Sync Strategy:** Option 2 — Event-Driven Sync  

---

## 🧠 Problem Statement

**Bottleneck:** `save_attendance()` calls `mongo_db.attendance.insert_one()` synchronously during the tap cycle. On slow WiFi this blocks for 50-300ms. The API notification (`notify_attendance_success`) adds another 50-200ms of blocking.

**Existing partial solution:** `database.py` already has `pending_attendance` JSON and a reconnect thread with `_push_pending_to_mongodb()`, but MongoDB is still attempted first (blocking) when available.

**Fix:** Always write JSON first (5ms). Use an event-driven background thread to sync to MongoDB immediately after — reactive, not polling.

---

## 🏗️ Architecture: Event-Driven Write-First

### Core Principle
> **JSON is written synchronously (fast). A threading.Event wakes the sync thread immediately. Dashboard is notified via fire-and-forget HTTP.**

```
TAP CYCLE (blocking, must be fast):
  NFC read → Face detect → Save to JSON → signal Event → LCD "SUCCESS"
                                ↑ ~5ms        ↑ instant
                                              └→ also spawns notify thread (fire-and-forget)

SYNC THREAD (non-blocking, runs parallel):
  Sleeps until Event is set OR 10s timeout (safety net)
  Wakes → Read pending JSON → insert_one each to MongoDB → move to confirmed
  Clears Event → sleeps again
```

### Flow Diagram

```
Student taps NFC
        │
        ▼
  ┌─────────────┐
  │  JSON write  │  ~5ms (local disk)
  │  pending_att │
  └──────┬───────┘
         │
    ┌────┴────┐
    │  signal  │  _sync_event.set()
    │  Event   │
    └────┬────┘
         │                          ┌──────────────────────┐
         │      ┌──────────────┐    │ SYNC THREAD (bg)     │
         │      │ notify API   │    │                      │
         ├─────►│ (daemon thd) │    │ event.wait(10s)      │
         │      │ fire+forget  │    │   ↓ wakes            │
         │      └──────────────┘    │ read pending JSON    │
         ▼                          │ insert_one → MongoDB │
  ┌─────────────┐                   │ move to confirmed    │
  │  LCD shows   │                  │ save JSON            │
  │  "SUCCESS"  │                   │ event.clear()        │
  └─────────────┘                   │ sleep again          │
                                    └──────────────────────┘
```

### Why Event-Driven Over Fixed Interval

| Aspect | Fixed 30s | Fixed 5s | **Event-Driven** |
|--------|-----------|----------|-----------------|
| Dashboard latency | 0-30s ❌ | 0-5s ⚠️ | **~150ms** ✅ |
| CPU during idle hours | Polls every 30s | Polls every 5s | **Sleeps until tap** ✅ |
| Morning rush (200 students) | 30s backlog ❌ | 5s backlog ⚠️ | **Real-time** ✅ |
| Power failure safety | JSON on disk ✅ | JSON on disk ✅ | **JSON on disk + 10s fallback** ✅ |
| Complexity | Simple | Simple | **Simple + 1 Event object** ✅ |

---

## 📐 Detailed Design

### File: `hardware/database.py` — Changes

#### 1. `Database.__init__()` — Add sync Event + Lock + Thread

```python
def __init__(self, enable_background_reconnect=True):
    # ... existing init ...
    
    # Thread safety for JSON file access
    self._json_lock = threading.Lock()
    
    # Event-driven sync
    self._sync_event = threading.Event()
    self._stop_sync = threading.Event()
    self._sync_thread = None
    
    if enable_background_reconnect:
        self._start_sync_thread()
```

#### 2. `_load_json()` / `_save_json()` — Add Lock

Wrap existing logic with `self._json_lock` to prevent race conditions between tap thread and sync thread.

```python
def _load_json(self):
    with self._json_lock:
        # existing file read logic

def _save_json(self, data):
    with self._json_lock:
        # existing file write logic
```

#### 3. `save_attendance()` — Rewrite to JSON-First

**Before (current — blocking):**
```python
if self._check_mongodb():
    self.mongo_db.attendance.insert_one(record.copy())  # ← 50-300ms BLOCKING
    data["attendance"].append(record)
    self._save_json(data)
    return True

# Fallback
data["pending_attendance"].append(record)
self._save_json(data)
```

**After (write-first + signal):**
```python
# ALWAYS write to JSON pending queue (FAST, ~5ms)
data = self._load_json()
data["pending_attendance"].append(record)
self._save_json(data)
logger.info("Attendance saved locally: %s (%s)", name, role)

# Signal sync thread to wake up and push to MongoDB
self._sync_event.set()

return True
```

#### 4. `_sync_loop()` — Event-Driven Background Sync

```python
def _start_sync_thread(self):
    """Start background sync thread"""
    if self._sync_thread and self._sync_thread.is_alive():
        return
    
    self._stop_sync.clear()
    self._sync_thread = threading.Thread(
        target=self._sync_loop,
        daemon=True,
        name="MongoDB-Sync"
    )
    self._sync_thread.start()
    logger.info("Background sync thread started (event-driven + 10s fallback)")

def _sync_loop(self):
    """
    Event-driven sync: sleeps until a new record signals it, 
    or wakes every 10s as safety fallback.
    """
    while not self._stop_sync.is_set():
        # Wait for signal OR 10s timeout (safety net for missed events)
        triggered = self._sync_event.wait(timeout=10)
        self._sync_event.clear()
        
        # Check if we should stop
        if self._stop_sync.is_set():
            break
        
        # Skip if MongoDB unavailable
        if not self._check_mongodb():
            continue
        
        # Read pending records
        data = self._load_json()
        pending = data.get("pending_attendance", [])
        
        if not pending:
            continue
        
        # Sync one-by-one (don't use insert_many — one bad record kills batch)
        synced_count = 0
        try:
            for record in pending:
                clean = {k: v for k, v in record.items() if k != "_synced"}
                self.mongo_db.attendance.insert_one(clean)
                synced_count += 1
        except Exception as e:
            logger.error("Sync error after %d records: %s", synced_count, e)
        
        # Move successfully synced to confirmed, keep failures in pending
        if synced_count > 0:
            confirmed = [
                {k: v for k, v in r.items() if k != "_synced"}
                for r in pending[:synced_count]
            ]
            data["attendance"].extend(confirmed)
            data["pending_attendance"] = pending[synced_count:]
            self._save_json(data)
            logger.info("Synced %d/%d records to MongoDB", synced_count, len(pending))

def stop_sync(self):
    """Stop the background sync thread"""
    self._stop_sync.set()
    self._sync_event.set()  # Wake thread so it can exit
    if self._sync_thread and self._sync_thread.is_alive():
        self._sync_thread.join(timeout=3)
        logger.info("Background sync thread stopped")
```

#### 5. `is_already_logged_today()` — Check Pending JSON First

```python
def is_already_logged_today(self, nfc_id):
    """Check BOTH pending JSON AND MongoDB"""
    today = datetime.now().strftime("%Y-%m-%d")
    nfc_str = str(nfc_id)

    # Check JSON first (fastest, always available, includes un-synced records)
    data = self._load_json()
    for record in data.get("pending_attendance", []):
        if record.get("nfc_id") == nfc_str and record.get("date", "").startswith(today):
            return True
    for record in data.get("attendance", []):
        if record.get("nfc_id") == nfc_str and record.get("date", "").startswith(today):
            return True

    # Then check MongoDB (if connected)
    if self._check_mongodb():
        try:
            count = self.mongo_db.attendance.count_documents({
                "nfc_id": nfc_str,
                "date": {"$regex": f"^{today}"}
            })
            return count > 0
        except Exception:
            pass

    return False
```

#### 6. `close()` — Stop sync thread

```python
def close(self):
    """Close database connections and stop background threads"""
    self.stop_sync()        # ← NEW
    self.stop_reconnect()
    if self.mongo_client:
        try:
            self.mongo_client.close()
        except Exception:
            pass
    logger.info("Database closed")
```

### File: `hardware/tamtap.py` — Changes

#### 1. `notify_attendance_success()` — Fire-and-Forget

```python
def notify_attendance_success(record):
    """Notify API server in background thread (non-blocking)"""
    threading.Thread(
        target=notify_api_server,
        args=('/api/hardware/attendance', record),
        daemon=True
    ).start()

def notify_attendance_fail(nfc_id, name, reason):
    """Notify API server in background thread (non-blocking)"""
    threading.Thread(
        target=notify_api_server,
        args=('/api/hardware/fail', {'nfc_id': str(nfc_id), 'name': name, 'reason': reason}),
        daemon=True
    ).start()
```

---

## ⏱️ Timing Budget After Optimization

| Step | Before | After | Savings |
|------|--------|-------|---------|
| NFC Read | ~80ms | ~80ms | — |
| Face Detection | ~1000ms | ~1000ms | — |
| Photo Capture | ~1200ms | ~1200ms | — |
| **DB Write** | **50-300ms** | **~5ms** | **45-295ms** |
| **API Notify** | **50-200ms** | **~0ms** | **50-200ms** |
| LCD Update | ~50ms | ~50ms | — |
| **Total** | **~2.5-2.8s** | **~2.3-2.4s** | **150-500ms** |

---

## 🔒 Data Safety Guarantees

| Scenario | What Happens |
|----------|-------------|
| Normal operation | JSON write → sync thread wakes in ~50ms → MongoDB confirmed |
| Slow WiFi | JSON writes instantly (local) → sync takes longer but doesn't block taps |
| WiFi drops mid-tap | JSON saved to disk → syncs when WiFi returns (10s poll finds it) |
| Pi power loss | JSON persists on SD card → syncs on reboot |
| MongoDB down all day | All records accumulate in `pending_attendance` → bulk sync when MongoDB returns |
| Two students tap simultaneously | `_json_lock` prevents corrupt JSON writes |
| Sync thread crashes | 10s fallback timeout catches missed events |

---

## 📁 Files to Modify

| File | Changes | Risk |
|------|---------|------|
| `hardware/database.py` | Rewrite `save_attendance()`, add `_sync_loop()` + `_sync_event`, add `_json_lock`, update `is_already_logged_today()`, update `close()` | Medium |
| `hardware/tamtap.py` | Make `notify_*` fire-and-forget with daemon threads | Low |

**No changes needed to:** `server.js`, `admin.html`, `dashboard.html`, `routes/*`

---

## ✅ Implementation Checklist

- [ ] Add `threading.Lock()` (`_json_lock`) for JSON file access in `Database.__init__()`
- [ ] Add `threading.Event()` (`_sync_event`) in `Database.__init__()`
- [ ] Add `threading.Event()` (`_stop_sync`) in `Database.__init__()`
- [ ] Wrap `_load_json()` and `_save_json()` with `_json_lock`
- [ ] Rewrite `save_attendance()` → JSON-first + `_sync_event.set()`
- [ ] Update `is_already_logged_today()` → check `pending_attendance` JSON first
- [ ] Add `_start_sync_thread()` method
- [ ] Add `_sync_loop()` method (event-driven with 10s fallback)
- [ ] Add `stop_sync()` method
- [ ] Call `_start_sync_thread()` in `__init__()` when `enable_background_reconnect=True`
- [ ] Call `stop_sync()` in `close()`
- [ ] Make `notify_attendance_success()` non-blocking (daemon thread)
- [ ] Make `notify_attendance_fail()` non-blocking (daemon thread)
- [ ] Test: Tap with MongoDB off → record saved to JSON pending
- [ ] Test: MongoDB comes back → pending records sync within seconds
- [ ] Test: Rapid taps → no JSON corruption (lock works)
- [ ] Test: Dashboard still receives live Socket.IO updates
- [ ] Test: `is_already_logged_today()` blocks double-tap during sync gap

---

## ⚠️ What NOT To Do

- **Don't use fixed intervals (5s/30s)** — event-driven is reactive + has 10s safety fallback
- **Don't clear JSON on sync** — move records to `attendance` list, keep as backup
- **Don't skip `is_already_logged_today` check on JSON** — would allow double taps during sync gap
- **Don't use `insert_many()`** — one bad record kills the whole batch; insert one-by-one with error handling
- **Don't remove the reconnect thread** — it handles MongoDB connection recovery, sync thread handles data push

---

**Ready for implementation. Say "implement" to proceed.**
