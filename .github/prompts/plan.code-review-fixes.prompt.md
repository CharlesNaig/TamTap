# Plan: Code Review Fixes

**Source:** Developer peer review feedback (8 suggestions)
**Date:** 2026-03-01
**Scope:** Backend, frontend, hardware
**Status:** ✅ ALL ITEMS IMPLEMENTED

---

## Decision Matrix

| # | Suggestion | Decision | Priority | Status |
|---|-----------|----------|----------|--------|
| 1 | Unauthenticated hardware endpoints | **SKIP** — LAN-only, document as design choice | — | N/A |
| 2 | Preloader 5s → 1-2s | **DO IT** | Low effort | ✅ Done |
| 3 | Async remote sync (DigitalOcean + JSON archive) | **DO IT** | High value | ✅ Done |
| 4 | Remove multi-face detection | **DO IT** | Medium | ✅ Done |
| 5 | connect-mongo session store | **DO IT** | Critical bug fix | ✅ Done |
| 6 | Logger standardization (console.log → Logger.js) | **DO IT** | Cleanup | ✅ Done (8 files) |
| 7 | GPIO library import fix | **DO IT** | Bug fix | ✅ Done |
| 8 | CORS restriction | **SKIP** — already documented, LAN-only | — | N/A |

---

## 1. SKIP — Hardware Endpoint Auth

**Reason:** `/api/hardware/*` endpoints are called by `tamtap.py` on the same Raspberry Pi. Adding session auth means Python must login, maintain cookies, handle expiry — adds latency to the 3.5s cycle budget. LAN-only = minimal risk.

**Action:** Add a comment block in `server.js` above hardware routes documenting this as a deliberate design choice.

---

## 2. DO — Preloader Speed (1-2 seconds)

**File:** `software/public/js/preloader.js`

**Current (line 11):**
```js
const MIN_PRELOADER_TIME = 3000 + Math.random() * 2000; // 3-5 seconds
```

**Change to:**
```js
const MIN_PRELOADER_TIME = 1000 + Math.random() * 1000; // 1-2 seconds
```

Single line change. No side effects.

---

## 3. DO — Async Remote Sync to DigitalOcean MongoDB

**Architecture:**
```
NFC Tap → Write Local MongoDB (await) → Return success
                ↓ (fire-and-forget)
         Background sync to:
           → DigitalOcean MongoDB (remote replica)
           → Optional JSON archive (already partially exists)
```

in short

1. local database mongo is prior
2. backup if local mongo fails (which is the mongodb cloud)
3. json backup is optional but nice to have for manual access and redundancy

**Files to modify/create:**
- `hardware/database.py` — add async sync after local write
- `.env` — add `REMOTE_MONGODB_URI` variable
- New: sync queue with retry logic for failed remote writes

**Constraints:**
- Local write must remain synchronous (await)
- Remote sync must NOT block the 3.5s cycle
- Failed syncs queued for retry (in-memory queue, persisted on shutdown)
- JSON archive already partially implemented — formalize it

**Needs from user:** DigitalOcean MongoDB connection URI before implementation.

---

## 4. DO — Remove Multi-Face Detection

**File:** `hardware/tamtap.py`

**Current behavior (line ~755):**
```python
if num_faces > 1:
    logger.warning("Multiple faces detected (%d), rejecting", num_faces)
    return False, num_faces, FaceValidationError.MULTIPLE_FACES_DETECTED
```

**Change:** Remove the multi-face rejection block. If ≥1 face detected, accept and proceed. The photo is stored as an audit trail — it's evidence, not a gate.

**Also remove:**
- `MULTIPLE_FACES_DETECTED` from `FaceValidationError` enum
- Any LCD messages referencing multiple faces
- Related Socket.IO failure messages for this case

**Do NOT add:** Anti-spoofing / liveness detection. Haar cascades cannot distinguish real faces from printed/digital ones. Don't claim what can't be delivered — panelists will probe it. Document the camera as "presence verification + audit photo," not as a security gate.

---

## 5. DO — Replace MemoryStore with connect-mongo

**Why critical:** Default `express-session` MemoryStore leaks memory and loses all sessions on restart. Teachers get logged out every server restart.

**Steps:**
1. `npm install connect-mongo` in `software/`
2. In `software/server.js`, update session middleware:

```js
const MongoStore = require('connect-mongo');

app.use(session({
    ...config.session,
    store: MongoStore.create({
        mongoUrl: `${config.mongodb.uri}/${config.mongodb.database}`,
        ttl: config.session.cookie.maxAge / 1000, // 8 hours in seconds
        touchAfter: 3600, // Only update session once per hour if unchanged
        crypto: {
            secret: config.session.secret
        }
    })
}));
```

3. No Mongoose — uses `mongoUrl` option with native driver
4. Sessions stored in `sessions` collection with automatic TTL expiry

---

## 6. DO — Logger Standardization ✅

**Rule:** Replace `console.log` / `console.error` / `console.warn` with `logger` from `utils/Logger.js` in all route files.

**Files updated (expanded scope — 8 files, not just 4):**
| File | console.log | console.error | console.warn | Total |
|------|------------|--------------|-------------|-------|
| `software/routes/attendance.js` | 3 | 3 | 1 | 7 |
| `software/routes/auth.js` | 5 | 3 | 0 | 8 |
| `software/routes/calendar.js` | 6 | 12 | 0 | 18 |
| `software/routes/export.js` | 8 | 4 | 0 | 12 |
| `software/routes/students.js` | 0 | 4 | 0 | 4 |
| `software/routes/stats.js` | 0 | 5 | 0 | 5 |
| `software/routes/schedules.js` | 0 | 7 | 0 | 7 |
| `software/routes/notifications.js` | 0 | 5 | 0 | 5 |
| **Total** | **22** | **43** | **1** | **66** |

**Mapping:**
- `console.log('[INFO] ...')` → `logger.info(...)`
- `console.log('[DEBUG] ...')` → `logger.debug(...)`
- `console.log('[WARN] ...')` → `logger.warn(...)`
- `console.error('[ERROR] ...')` → `logger.error(...)`
- `console.warn(...)` → `logger.warn(...)`

**Each file needs:** `const logger = require('../utils/Logger');` at the top.

**SKIP these (CLI scripts — console.log is appropriate):**
- `software/scripts/bootstrap-admin.js`
- `scripts/bulk_register_datagather.js`
- `scripts/migrate_photo_filenames.js`

**SKIP these (browser JS — can't use Node Logger.js):**
- All HTML files and `public/js/*.js` files

---

## 7. DO — Fix GPIO Import in button_listener.py

**File:** `buttons/button_listener.py`

**Current (line 24):**
```python
from gpiozero import Button
```

**This is actually correct.** The file uses `gpiozero`-style API throughout (`.when_pressed`, `.when_released`, `signal.pause()`). The initial review misread the import as `from RPi.GPIO import Button` — but the actual file correctly imports from `gpiozero`.

**Decision:** Keep `gpiozero` for `button_listener.py` (event-driven button handling). Keep `RPi.GPIO` for `tamtap.py` (low-level SPI/I2C/LED control). Two libraries for two different use cases is intentional.

**Action:** Add a comment in `button_listener.py` documenting why `gpiozero` is used instead of `RPi.GPIO`:
```python
# gpiozero used here (not RPi.GPIO) because button_listener only needs
# event-driven press/release handlers. tamtap.py uses RPi.GPIO for
# low-level SPI/I2C/LED control which gpiozero doesn't cover well.
```

---

## 8. SKIP — CORS Restriction

**Current (`config.js` line 55):**
```js
origin: '*',  // Allow all origins for LAN
```

**Already documented.** On LAN-only deployment, CORS restrictions add zero security. CORS is browser-enforced — direct network access bypasses it entirely. Restricting to a specific IP would break when IPs change (DHCP).

**Action:** None. Comment already explains the rationale.

---

## Execution Order

1. **#5 connect-mongo** — critical bug fix, do first
2. **#2 Preloader** — 1-line change, quick win
3. **#7 GPIO comment** — trivial
4. **#6 Logger standardization** — systematic find-replace across 4 files
5. **#4 Remove multi-face** — requires careful surgery in tamtap.py
6. **#3 Async remote sync** — largest feature, needs DigitalOcean URI first

---

## Also Found: Bug in export.js

**Line 17:** `require('expregss')` — typo, should be `require('express')`. Fix during logger migration.
