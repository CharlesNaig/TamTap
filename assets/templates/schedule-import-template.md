# Schedule Import Template

## XLSX/CSV File Format

Create a spreadsheet file with the following columns:

| Column | Header Name | Required | Example |
|--------|-------------|----------|---------|
| A | `Section` | ✅ Yes | `11-STEM-A` |
| B | `Grade` | No | `11` |
| C | `Adviser Name` | No | `Juan Dela Cruz` |
| D | `Mon Start` | No (default: 07:00) | `07:00` |
| E | `Mon End` | No (default: 17:00) | `17:00` |
| F | `Tue Start` | No | `07:00` |
| G | `Tue End` | No | `17:00` |
| H | `Wed Start` | No | `07:00` |
| I | `Wed End` | No | `17:00` |
| J | `Thu Start` | No | `07:00` |
| K | `Thu End` | No | `17:00` |
| L | `Fri Start` | No | `07:00` |
| M | `Fri End` | No | `16:00` |
| N | `Sat Start` | No (blank = no classes) | `08:00` |
| O | `Sat End` | No | `12:00` |

## Example Data

| Section | Grade | Adviser Name | Mon Start | Mon End | Tue Start | Tue End | Wed Start | Wed End | Thu Start | Thu End | Fri Start | Fri End | Sat Start | Sat End |
|---------|-------|--------------|-----------|---------|-----------|---------|-----------|---------|-----------|---------|-----------|---------|-----------|---------|
| ICT-A | 12 | Juan Dela Cruz | 07:00 | 17:00 | 07:00 | 17:00 | 07:00 | 17:00 | 07:00 | 17:00 | 07:00 | 16:00 | | |
| ICT-B | 12 | Maria Santos | 08:00 | 17:00 | 08:00 | 17:00 | 08:00 | 17:00 | 08:00 | 17:00 | 08:00 | 16:00 | 08:00 | 12:00 |
| STEM-A | 11 | | 07:30 | 16:00 | 07:30 | 16:00 | 07:30 | 16:00 | 07:30 | 16:00 | 07:30 | 15:00 | | |

## Column Definitions

### Time Format
All times should be in **24-hour format (HH:MM)**:
- `07:00` = 7:00 AM
- `13:00` = 1:00 PM
- `17:00` = 5:00 PM

### Saturday Classes
- Leave `Sat Start` and `Sat End` **blank** if no Saturday classes
- If Saturday has classes, fill in both start and end times

## Card Decline Logic

When a student taps their card, the system checks:

```
IF today is Saturday AND saturday schedule is blank:
    → DECLINE: "No classes today"

IF current_time < schedule_start - 30 minutes:
    → DECLINE: "Too early"

IF current_time > schedule_end:
    → DECLINE: "Classes ended"

OTHERWISE:
    → Allow tap and calculate status (on_time, late, or absent)
```

## Grace Period & Absent Threshold

These are configured per-section in the Admin Panel (not in the import):
- **Grace Period**: Minutes after start time before marked LATE (default: 20)
- **Absent Threshold**: Minutes after start time before marked ABSENT (default: 60)

## How to Import

1. Download the template from Admin Panel → Schedules → **Template** button
2. Open the CSV in Excel
3. Edit the data for your sections
4. Save as `.xlsx` format (Excel Workbook)
5. Go to Admin Panel → Schedules → **Import** button
6. Select your `.xlsx` file
7. Review the import summary

## Notes

- Duplicate sections will update existing schedules
- Adviser assignment links to existing teacher accounts by name
- Section names must match exactly with student records
