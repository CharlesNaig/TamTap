# Schedule Import Template

## XLSX File Format

Create an Excel file (`.xlsx`) with the following columns:

| Column | Header Name | Required | Example |
|--------|-------------|----------|---------|
| A | `section` | ✅ Yes | `11-STEM-A` |
| B | `time_in` | ✅ Yes | `07:30` |
| C | `grace_period` | No (default: 20) | `20` |
| D | `absent_threshold` | No (default: 60) | `60` |

## Example Data

| section | time_in | grace_period | absent_threshold |
|---------|---------|--------------|------------------|
| 11-STEM-A | 07:30 | 20 | 60 |
| 11-STEM-B | 07:30 | 20 | 60 |
| 11-ABM-A | 07:45 | 15 | 45 |
| 12-HUMSS-A | 08:00 | 20 | 60 |
| 12-TVL-A | 07:30 | 30 | 90 |

## Column Definitions

### `section` (Required)
The section name. Must match exactly with sections in the students database.

### `time_in` (Required)
Expected arrival time in 24-hour format (HH:MM).
- `07:30` = 7:30 AM
- `13:00` = 1:00 PM

### `grace_period` (Optional)
Minutes after `time_in` before a student is marked **LATE**.
- Default: `20` minutes
- Example: If `time_in = 07:30` and `grace_period = 20`, students arriving at 07:51 are marked late.

### `absent_threshold` (Optional)
Minutes after `time_in` before a student is marked **ABSENT**.
- Default: `60` minutes
- Example: If `time_in = 07:30` and `absent_threshold = 60`, students arriving at 08:31 are marked absent.

## Status Logic

```
arrival_time <= time_in + grace_period     → ON_TIME
arrival_time <= time_in + absent_threshold → LATE
arrival_time > time_in + absent_threshold  → ABSENT
```

## Import Notes

1. The first row must be the header row with column names.
2. Duplicate sections will be skipped during import.
3. Invalid time formats will cause the row to be skipped.
4. Adviser assignment must be done manually in the admin panel after import.
5. Sections not found in the students database can still have schedules configured.

## How to Import

1. Go to **Admin Panel** → **Schedules** tab
2. Click **Import XLSX** button
3. Select your `.xlsx` file
4. Review the import summary (imported vs. skipped counts)
