# TAMTAP Overhaul Plan

> Sprint plan for technical fixes, prototype gap resolution, and website UI improvements.
> Status: **DRAFT — For refinement before execution**

---

## 1. Technical Issues

### 1.1 Admin Console Logs — No Output (Pi + Website)

**Problem:** The System Logs tab in `admin.html` shows 3 terminal panes (tamtap-buttons, tamtap-hardware, tamtap-server) but none produce output — even on the Raspberry Pi.

**Root Cause Investigation:**
- `software/routes/logs.js` uses `journalctl -t <SyslogIdentifier>` to fetch logs
- The service files (`tamtap-buttons.service`, `tamtap-server.service`) must have matching `SyslogIdentifier=` values
- Socket.IO live streaming spawns `journalctl --follow` — if the child process fails silently, no logs appear
- The admin JS (`admin.html`) connects via Socket.IO and listens for `log:data` events

**Tasks:**
- [ ] Verify `.service` files have correct `SyslogIdentifier` matching `logs.js` SERVICES map (`buttons` → `tamtap-buttons`, `hardware` → `tamtap`, `server` → `tamtap-server`)
- [ ] Add error handling to `fetchJournalLogs()` — if `journalctl` fails, return a meaningful error instead of empty
- [ ] Add a `GET /api/logs/health` endpoint that checks if `journalctl` is available and each service exists
- [ ] In admin.html JS, on "Start Live" — if socket emits an error, display it in the console pane (red text) instead of silently failing
- [ ] Add a fallback: if `journalctl` is unavailable (e.g., non-systemd OS), read from log files in `/var/log/tamtap/` or show "journalctl not available on this system"
- [ ] Test on Pi: `journalctl -t tamtap-buttons -n 20 --no-pager` should return output

**Files:**
- `software/routes/logs.js` — fix fetchJournalLogs, add health check
- `software/public/admin.html` — improve error display in console panes
- `buttons/tamtap-buttons.service` — verify SyslogIdentifier
- `buttons/tamtap-server.service` — verify SyslogIdentifier

---

### 1.2 Camera — Portrait 3:4 Ratio + Less Strict Eye Detection

**Problem:** Camera capture is too strict on eyes/face detection and uses landscape resolution. Need 3:4 portrait ratio.

**Current State (hardware/tamtap.py):**
- Uses `rpicam-still` for capture (subprocess call)
- Haar cascade (`haarcascade_frontalface_default.xml`) for face detection
- Likely also uses `haarcascade_eye.xml` for eye validation
- Resolution and aspect ratio determined by `rpicam-still` args

**Tasks:**
- [ ] Change `rpicam-still` resolution to 3:4 portrait ratio: `--width 600 --height 800` (or `480x640` for speed)
- [ ] If using `--rotation`, ensure it matches physical camera orientation
- [ ] Relax eye detection: either remove eye cascade requirement or lower `minNeighbors` threshold
  - Current: likely `eye_cascade.detectMultiScale(..., minNeighbors=5)`
  - Target: `minNeighbors=2` or skip eye detection entirely (face-only validation)
- [ ] Adjust face cascade `scaleFactor` and `minNeighbors` for better tolerance:
  - `scaleFactor=1.2` → `1.15` (finer search)
  - `minNeighbors=5` → `3` (more lenient)
- [ ] Adjust `minSize` for face detection to account for portrait framing (face will be larger in frame)
- [ ] Ensure total camera cycle stays within 1500ms wake + 1200ms detection = 2700ms budget

**Files:**
- `hardware/tamtap.py` — camera args, cascade parameters, detection thresholds

---

## 2. Prototype Gap (CRITICAL)

### 2.1 Special Characters (ñ / Enye) in Photo File Paths

**Problem:** Student names containing Filipino special characters like "ñ" create file paths that the system can't resolve. Example: a student named "Niño" generates `Niño.png` which fails on lookup because of encoding mismatch.

**Solution: UTF-8 Safe Filename Encoder**

**Tasks:**
- [ ] Create a `sanitizeFilename(name)` utility function (used in both Python and Node.js):
  - Normalize Unicode: `unicodedata.normalize('NFC', name)` (Python) / `name.normalize('NFC')` (JS)
  - Replace known problematic characters: `ñ` → `n`, `Ñ` → `N`, `ñ` → `ny` (choose one consistent mapping)
  - Strip or replace other non-ASCII: accents via `unidecode` or manual map
  - Replace spaces/special filesystem chars: `/`, `\`, `:`, `*`, `?` → `_`
  - Lowercase the result for consistency
- [ ] **Python side** (`hardware/tamtap.py` / `hardware/database.py`):
  - When saving photo after capture: `filename = sanitize_filename(student_name) + '_' + timestamp + '.png'`
  - Store the sanitized filename in MongoDB `attendance.photo_path`
- [ ] **Node.js side** (`software/routes/attendance.js` or photo serving route):
  - When serving photos, use the stored `photo_path` directly (already sanitized)
  - Add a migration/fixup script for existing photos with ñ in filenames
- [ ] **Migration script**: rename existing photos in `assets/attendance_photos/` to sanitized names, update MongoDB records
- [ ] Test with names: "Niño", "Peña", "Dañoso", "Año"

**Files:**
- `hardware/tamtap.py` — use sanitized filename on capture
- `hardware/database.py` — store sanitized photo_path
- `software/routes/attendance.js` — verify photo serving uses stored path
- NEW: `hardware/utils/filename_sanitizer.py`
- NEW: `software/utils/filenameSanitizer.js`
- NEW: `scripts/migrate_photo_filenames.js` (one-time migration)

---

## 3. Website Changes

### 3.1 Justify "What is TAMTAP?" Content

**Problem:** The "What is TAMTAP?" section text is center-aligned. User wants it justified with updated copy.

**Tasks:**
- [ ] Change `text-center` to `text-justify` on the `<div>` wrapper in Section 3
- [ ] Replace the 3 `<p>` tags with the provided copy (verbatim from user)
- [ ] Keep the heading `<h2>` centered, only justify the body paragraphs
- [ ] Keep the gold capstone credit line centered at bottom

**File:** `software/public/login.html` — Section 3 (~lines 394-420)

---

### 3.2 Remove Green Login Sticky Bar

**Problem:** The sticky green bottom bar with "Log In" button is redundant — there's already a login button in the header nav and footer quick links.

**Tasks:**
- [ ] Remove the `#login-bottom-bar` div entirely (~line 645-652)
- [ ] Remove associated JS scroll show/hide logic (if any)
- [ ] Verify no other JS references `login-bottom-bar`

**File:** `software/public/login.html`

---

### 3.3 Della Respira Font for TAMTAP / FEU Text

**Problem:** The word "TAMTAP" and "FEU ROOSEVELT" branding should use the Della Respira font instead of the default system font.

**Font file:** `assets/fonts/DellaRespira-Regular.ttf`

**Tasks:**
- [ ] Add `@font-face` rule in login.html, dashboard.html, admin.html, and new public pages:
  ```css
  @font-face {
      font-family: 'Della Respira';
      src: url('/assets/fonts/DellaRespira-Regular.ttf') format('truetype');
      font-weight: normal;
      font-style: normal;
      font-display: swap;
  }
  ```
- [ ] Create a utility class: `.font-brand { font-family: 'Della Respira', Georgia, serif; }`
- [ ] Apply `.font-brand` to all instances of:
  - "TAMTAP" text (header logos, footer, hero section, modal titles)
  - "FEU ROOSEVELT" text where it appears as branding
- [ ] Do NOT apply to normal body text, labels, buttons, or data — keep current sans-serif
- [ ] Serve the font via Express static (already serving `/assets/` directory)

**Files:** All HTML pages (login, dashboard, admin, new pages)

---

### 3.4 Logo Consistency — Option A: Mascot + Font Text

**Decision:** Use `TamTap-3D.png` mascot image + "TAMTAP" text in Della Respira font with CSS-controlled colors.

**Current inconsistency:**
| Location | Currently Uses |
|----------|---------------|
| Login header | `TamTap.png` (flat) |
| Login hero | `FeuXTamTap.png` (combo) |
| Login footer | `TamTap-3D.png` (3D mascot) |
| Login modal | `TamTap-wteachers.png` (with teachers) |
| Dashboard header | `TamTap-3D.png` |
| Dashboard footer | `feu-logo.png` + `TamTap-3D.png` |
| Favicon | `TamTap-3D.png` |

**Target:** Everywhere uses the same pattern:
```html
<div class="flex items-center gap-2">
    <img src="/assets/TamTap-3D.png" alt="TAMTAP" class="h-10 w-10 object-contain">
    <span class="font-brand text-xl font-bold">
        <span class="text-white">TAM</span><span class="text-feu-gold">TAP</span>
    </span>
</div>
```
Colors adapt per context:
- On dark/green bg: white + gold
- On white bg: feu-green + feu-gold

**Tasks:**
- [ ] Standardize login.html header logo → `TamTap-3D.png` + Della Respira text
- [ ] Standardize login.html hero → keep `FeuXTamTap.png` as decorative hero image (it's a different purpose)
- [ ] Standardize login.html footer → already uses `TamTap-3D.png` + text ✓
- [ ] Standardize login.html modal header → replace `TamTap-wteachers.png` with mascot + text combo
- [ ] Standardize dashboard.html header → already uses `TamTap-3D.png` ✓, add Della Respira text
- [ ] Standardize dashboard.html footer → match login footer layout
- [ ] Standardize admin.html header/footer → same pattern
- [ ] Remove unused logo variants from assets if no longer referenced

**Files:** `login.html`, `dashboard.html`, `admin.html`

---

### 3.5 Dashboard Footer — Match Login Page Footer

**Problem:** Dashboard footer is a minimal single-line bar. Login footer is a rich 3-column layout with brand, quick links, and school info.

**Current dashboard footer (~5 lines):**
- FEU logo + TamTap mascot + "TAMTAP" | Capstone credit | Copyright

**Target:** Match login footer structure:
- 3-column grid: Brand | Quick Links | School Info
- Same dark green bg, gold accents, Della Respira branding
- Quick Links for dashboard: Privacy, Terms of Use, Researchers (link to new public pages), Personal Info
- Copyright + capstone credit in bottom divider row

**Tasks:**
- [ ] Replace dashboard `<footer>` with login-style 3-column footer
- [ ] Adapt Quick Links for authenticated context (no "Log In" link; add "Personal Info", "Help Center")
- [ ] Link Privacy / Terms / Researchers to new public pages (see 3.7)
- [ ] Apply same footer to `admin.html`

**Files:** `dashboard.html`, `admin.html`

---

### 3.6 Separate Public Pages: Privacy Policy & Terms of Use

**Problem:** Currently shown in modals via `showInfoModal()`. User wants full dedicated pages styled like FEU Roosevelt's privacy policy page (docs-style with sidebar).

**Reference:** https://feuroosevelt.edu.ph/privacy-policy/

**Page Design (both pages share same layout):**
```
┌─────────────────────────────────────────────────┐
│  Green header bar with TAMTAP branding          │
│  Breadcrumb: Home > Privacy Policy              │
├─────────────────────────────┬───────────────────┤
│                             │  Sidebar:         │
│  Main Content (docs-style)  │  - Search (opt)   │
│  - Introduction             │  - Data Protection│
│  - Storage & Retention      │    Office info    │
│  - Sharing & Disclosure     │  - Contact details│
│  - etc.                     │                   │
│                             │                   │
├─────────────────────────────┴───────────────────┤
│  Footer (same as login page)                    │
└─────────────────────────────────────────────────┘
```

**Tasks:**
- [ ] Create `software/public/privacy.html` — full docs-style page
  - Green top bar + TAMTAP header (consistent logo)
  - Breadcrumb navigation
  - 2-column layout: main content (left) + sidebar info card (right)
  - Content sections: Introduction, Storage & Retention, Sharing & Disclosure, Data Rights, Contact
  - Adapt content to TAMTAP context (local LAN system, no cloud, school data)
  - Responsive: sidebar collapses below content on mobile
- [ ] Create `software/public/terms.html` — same layout
  - Content sections: Acceptance, System Description, User Responsibilities, Data Handling, Limitations, Amendments
- [ ] Add Express routes for `/privacy` and `/terms` (or serve as static HTML)
- [ ] Update footer links in login.html, dashboard.html, admin.html → point to `/privacy.html` and `/terms.html`
- [ ] Keep modal versions as fallback or remove them (user preference)

**Files:**
- NEW: `software/public/privacy.html`
- NEW: `software/public/terms.html`
- `software/server.js` — (verify static serving covers new files)
- All pages — update footer links

---

### 3.7 Researchers / About Us Page

**Problem:** Need a dedicated public page showcasing the 7 research team members with alternating photo/content layout.

**Researchers (alphabetical):**
1. Bjorn Gabriel Angeles
2. Justine Paul Clara
3. Stephanie Estal
4. Mhikaela Shane Lindo
5. Kenshin Ace Magistrado
6. Charles Giann Marcelo
7. Emmanuel Miguel Jr.

**Photo folder:** `assets/researchers/` (created, awaiting portrait photos — 3:4 ratio)

**Page Layout:**
```
┌─────────────────────────────────────────────────┐
│  Green header + TAMTAP branding + breadcrumb    │
├─────────────────────────────────────────────────┤
│  "Meet the Researchers" hero section            │
│  Subtitle: Grade 12 ICT B | Group 5 | S.Y...   │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─────────┬──────────────────────────┐         │
│  │  PHOTO  │  Researcher Name         │  ← odd  │
│  │  3:4    │  Role / Bio / Details    │         │
│  │ portrait│                          │         │
│  └─────────┴──────────────────────────┘         │
│                                                 │
│  ┌──────────────────────────┬─────────┐         │
│  │  Researcher Name         │  PHOTO  │  ← even │
│  │  Role / Bio / Details    │  3:4    │         │
│  │                          │ portrait│         │
│  └──────────────────────────┴─────────┘         │
│                                                 │
│  ... alternating for all 7 ...                  │
│                                                 │
├─────────────────────────────────────────────────┤
│  Footer (same as login page)                    │
└─────────────────────────────────────────────────┘
```

**Tasks:**
- [ ] Create `software/public/researchers.html`
  - Green header + TAMTAP brand (consistent)
  - Hero section with title
  - 7 researcher cards in alternating left-photo/right-photo layout
  - Each card: 3:4 portrait photo + name + role + short bio
  - Photo fallback: show initials avatar if image missing
  - Responsive: stack vertically on mobile (photo on top)
  - Della Respira font for names
- [ ] Create placeholder data structure in the HTML (names filled, bio/role as TODO)
- [ ] Photo naming convention: `assets/researchers/firstname-lastname.jpg` (lowercase, hyphenated)
  - `bjorn-gabriel-angeles.jpg`
  - `justine-paul-clara.jpg`
  - `stephanie-estal.jpg`
  - `mhikaela-shane-lindo.jpg`
  - `kenshin-ace-magistrado.jpg`
  - `charles-giann-marcelo.jpg`
  - `emmanuel-miguel-jr.jpg`
- [ ] Update footer links across all pages to include "Researchers" link

**Files:**
- NEW: `software/public/researchers.html`
- `assets/researchers/` — photo folder ready (user to add photos)
- All page footers — add link

---

## 4. Execution Order (Recommended)

Priority order based on dependencies and impact:

| # | Task | Priority | Depends On |
|---|------|----------|------------|
| 1 | Della Respira `@font-face` setup | HIGH | None — unblocks 3.4, 3.5, 3.7 |
| 2 | Logo consistency (3.4) | HIGH | Task 1 |
| 3 | Dashboard footer match (3.5) | HIGH | Task 1, 2 |
| 4 | Justify TAMTAP content (3.1) | LOW | None |
| 5 | Remove green login bar (3.2) | LOW | None |
| 6 | Privacy page (3.6) | MEDIUM | Task 1, 2 |
| 7 | Terms page (3.6) | MEDIUM | Task 1, 2 |
| 8 | Researchers page (3.7) | MEDIUM | Task 1, awaits photos |
| 9 | Enye filename encoder (2.1) | CRITICAL | None |
| 10 | Camera 3:4 + relaxed detection (1.2) | HIGH | None |
| 11 | Admin console logs fix (1.1) | HIGH | Pi access for testing |

---

## 5. File Inventory

### New Files
| File | Purpose |
|------|---------|
| `software/public/privacy.html` | Dedicated privacy policy page |
| `software/public/terms.html` | Dedicated terms of use page |
| `software/public/researchers.html` | Team showcase page |
| `hardware/utils/filename_sanitizer.py` | UTF-8 safe filename helper |
| `software/utils/filenameSanitizer.js` | JS filename sanitizer mirror |
| `scripts/migrate_photo_filenames.js` | One-time photo rename migration |

### Modified Files
| File | Changes |
|------|---------|
| `software/public/login.html` | Font-face, logo, justify text, remove sticky bar, footer links |
| `software/public/dashboard.html` | Font-face, logo text, footer overhaul, footer links |
| `software/public/admin.html` | Font-face, logo text, footer overhaul, console error display |
| `software/routes/logs.js` | Error handling, health check, journalctl debugging |
| `hardware/tamtap.py` | Camera 3:4 ratio, relaxed detection, sanitized filenames |
| `hardware/database.py` | Sanitized photo_path storage |
| `buttons/tamtap-buttons.service` | Verify SyslogIdentifier |
| `buttons/tamtap-server.service` | Verify SyslogIdentifier |

### New Directories
| Directory | Purpose |
|-----------|---------|
| `assets/researchers/` | Researcher portrait photos (3:4 ratio) ✅ Created |

---

## 6. Open Questions

- [ ] Should the modal versions of Privacy/Terms in login.html be removed or kept as fallback?
- [ ] Researcher bios + roles — user to provide content for each of the 7 members
- [ ] Researcher photos — user to add 3:4 portraits to `assets/researchers/`
- [ ] Login `FeuXTamTap.png` hero image — keep as-is or replace with something simpler?
- [ ] `feu-logo.png` in dashboard footer — is this needed alongside the TAMTAP mascot+text combo, or remove it?
