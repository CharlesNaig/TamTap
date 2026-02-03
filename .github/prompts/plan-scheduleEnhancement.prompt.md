# TAMTAP Schedule System Enhancement Plan

## Current State
- Single `time_in` per section with grace_period and absent_threshold
- No day-specific schedules
- No class end time (only start time)
- No Saturday class toggle
- Cards accepted anytime

## Required Enhancements

### 1. Day-Specific Schedule Schema

**New Schedule Collection Structure:**
```javascript
{
  section: "11-STEM-A",
  adviser_id: ObjectId,
  saturday_enabled: false,
  schedule: {
    monday: { start: "07:30", end: "16:00", enabled: true },
    tuesday: { start: "08:00", end: "17:00", enabled: true },
    wednesday: { start: "07:30", end: "16:00", enabled: true },
    thursday: { start: "07:30", end: "16:00", enabled: true },
    friday: { start: "07:30", end: "15:00", enabled: true },
    saturday: { start: "08:00", end: "12:00", enabled: false }
  },
  grace_period: 20,      // minutes after start = late
  absent_threshold: 60,  // minutes after start = absent
  created_at: Date,
  updated_at: Date
}
```

### 2. Card Validation Logic

**At Tap Time (hardware/database.py):**
```
IF today is Saturday AND saturday_enabled = false:
    → DECLINE: "No classes today"

IF current_time < schedule[day].start - 30min:
    → DECLINE: "Too early"

IF current_time > schedule[day].end:
    → DECLINE: "Classes ended"

IF current_time <= start + grace_period:
    → ON_TIME

IF current_time <= start + absent_threshold:
    → LATE

ELSE:
    → ABSENT
```

### 3. XLSX Template Format

**Columns:**
| section | mon_start | mon_end | tue_start | tue_end | wed_start | wed_end | thu_start | thu_end | fri_start | fri_end | sat_start | sat_end | sat_enabled | grace_period | absent_threshold |

**Example Row:**
| 11-STEM-A | 07:30 | 16:00 | 08:00 | 17:00 | 07:30 | 16:00 | 07:30 | 16:00 | 07:30 | 15:00 | 08:00 | 12:00 | false | 20 | 60 |

### 4. Files to Modify

#### Backend Routes
- [x] `software/routes/schedules.js` - Update schema, XLSX parser, validation, migration
- [x] `software/server.js` - Add decline_reason to attendance:fail event

#### Hardware
- [x] `hardware/database.py` - Day-specific validation, decline logic
- [x] `hardware/tamtap.py` - Schedule validation before attendance processing
- [x] `hardware/archive_attendance.py` - Uses pre-calculated status (no changes needed)

#### Frontend
- [x] `software/public/admin.html` - Day-by-day schedule UI, Saturday toggle
- [x] Add downloadable CSV template (downloadScheduleTemplate function)

### 5. Admin UI Changes

**Schedules Tab Enhancements:**
- Weekly schedule grid (Mon-Sat rows, Start/End columns)
- Saturday enabled toggle switch
- "Download Template" button for XLSX
- Visual indicator for disabled days

**Add/Edit Schedule Modal:**
```
┌─────────────────────────────────────────┐
│ Section: [11-STEM-A ▼]                  │
│ Adviser: [Ms. Santos ▼]                 │
│                                         │
│ Weekly Schedule:                        │
│ ┌─────────┬─────────┬─────────┬───────┐ │
│ │ Day     │ Start   │ End     │ On/Off│ │
│ ├─────────┼─────────┼─────────┼───────┤ │
│ │ Monday  │ [07:30] │ [16:00] │ [✓]   │ │
│ │ Tuesday │ [08:00] │ [17:00] │ [✓]   │ │
│ │ Wednesday│[07:30] │ [16:00] │ [✓]   │ │
│ │ Thursday│ [07:30] │ [16:00] │ [✓]   │ │
│ │ Friday  │ [07:30] │ [15:00] │ [✓]   │ │
│ │ Saturday│ [08:00] │ [12:00] │ [ ]   │ │
│ └─────────┴─────────┴─────────┴───────┘ │
│                                         │
│ Grace Period: [20] min                  │
│ Absent After: [60] min                  │
│                                         │
│ [Cancel]              [Save Schedule]   │
└─────────────────────────────────────────┘
```

### 6. Decline Response Handling

**LCD Messages:**
- "No classes today" - Saturday disabled
- "Too early" - Before schedule start - 30min
- "Classes ended" - After schedule end

**API Response for Dashboard:**
- Include `decline_reason` in fail event
- Show in activity feed with reason

### 7. Archive Integration

**archive_attendance.py Updates:**
- Use day-specific schedule when processing
- Mark absences correctly based on that day's schedule
- Skip Saturday if saturday_enabled = false

### 8. Implementation Order

1. [x] Update schedule schema in `schedules.js`
2. [x] Update XLSX import to parse new columns
3. [x] Create downloadable template file (CSV via JS function)
4. [x] Update admin.html with weekly schedule UI
5. [x] Update `database.py` with day-specific validation
6. [x] Update `tamtap.py` with schedule validation before attendance
7. [x] Add migration function for old `time_in` format
8. [x] Update `server.js` with detailed decline reasons

### 9. Migration Strategy

- [x] Auto-migrate on read: `migrateScheduleFormat()` in schedules.js
- [x] Old `time_in` → applies to all weekdays (Mon-Fri)
- [x] Default `end` = `time_in + 9 hours`
- [x] Default `saturday` = null (disabled)
- [x] Old `grace_period` → `grace_period_minutes`
- [x] Old `absent_threshold` → `absent_threshold_minutes`

### 10. Hardware Decline Logic

- [x] Decline if Sunday (no classes)
- [x] Decline if Saturday and `saturday.start` is null
- [x] ~~Decline if current time < schedule start - 30 minutes (TOO_EARLY)~~ **Removed: Early arrivals allowed**
- [x] Decline if current time > schedule end (CLASSES_ENDED)
- [x] LCD shows appropriate message
- [x] Socket.IO broadcasts `attendance:fail` with `decline_code`
