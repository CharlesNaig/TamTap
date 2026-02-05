/**
 * TAMTAP Section Schedules Routes
 * Manages section schedules with per-day arrival times and adviser assignments
 * 
 * GET    /api/schedules              - List all section schedules
 * GET    /api/schedules/:section     - Get specific section schedule
 * POST   /api/schedules              - Create section schedule (admin only)
 * PUT    /api/schedules/:section     - Update schedule (admin or adviser of section)
 * DELETE /api/schedules/:section     - Delete schedule (admin only)
 * POST   /api/schedules/import       - Import schedules from XLSX (admin only)
 * GET    /api/schedules/template     - Download XLSX template
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const { ObjectId } = require('mongodb');

// Configure multer for XLSX uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.xlsx' || ext === '.xls') {
            cb(null, true);
        } else {
            cb(new Error('Only .xlsx or .xls files allowed'));
        }
    }
});

// Default schedule template
const DEFAULT_SCHEDULE = {
    monday:    { start: '07:00', end: '17:00' },
    tuesday:   { start: '07:00', end: '17:00' },
    wednesday: { start: '07:00', end: '17:00' },
    thursday:  { start: '07:00', end: '17:00' },
    friday:    { start: '07:00', end: '17:00' },
    saturday:  { start: null, end: null }  // Optional
};

const DEFAULT_GRACE_PERIOD = 20;      // Minutes after start = Late
const DEFAULT_ABSENT_THRESHOLD = 60;  // Minutes after start = Absent

/**
 * Migrate old schedule format (time_in) to new weekly_schedule format
 */
function migrateScheduleFormat(schedule) {
    if (schedule.weekly_schedule) {
        return schedule; // Already migrated
    }
    
    // Old format: time_in, grace_period, absent_threshold
    const timeIn = schedule.time_in || '07:00';
    
    // Calculate end time: time_in + 9 hours (default school day)
    const [hours, minutes] = timeIn.split(':').map(Number);
    const endHours = Math.min(hours + 9, 23);
    const endTime = `${String(endHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    
    // Create weekly_schedule from old format
    schedule.weekly_schedule = {
        monday:    { start: timeIn, end: endTime },
        tuesday:   { start: timeIn, end: endTime },
        wednesday: { start: timeIn, end: endTime },
        thursday:  { start: timeIn, end: endTime },
        friday:    { start: timeIn, end: endTime },
        saturday:  { start: null, end: null }  // Disabled by default
    };
    
    // Migrate old field names
    if (schedule.grace_period !== undefined && schedule.grace_period_minutes === undefined) {
        schedule.grace_period_minutes = schedule.grace_period;
    }
    if (schedule.absent_threshold !== undefined && schedule.absent_threshold_minutes === undefined) {
        schedule.absent_threshold_minutes = schedule.absent_threshold;
    }
    
    return schedule;
}

/**
 * GET /api/schedules
 * List all section schedules
 * Admins see all, advisers/teachers see only their sections
 */
router.get('/', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }

        const user = req.session?.user;
        let query = {};

        // Filter by user's sections if not admin
        if (user && user.role !== 'admin') {
            const sections = [];
            if (user.advised_section) sections.push(user.advised_section);
            if (user.sections_handled) sections.push(...user.sections_handled);
            if (sections.length > 0) {
                query.section = { $in: sections };
            }
        }

        const schedules = await db.collection('schedules')
            .find(query)
            .sort({ grade: 1, section: 1 })
            .toArray();

        // Apply migration to ensure all schedules have weekly_schedule format
        const migratedSchedules = schedules.map(migrateScheduleFormat);

        res.json({
            success: true,
            count: migratedSchedules.length,
            data: migratedSchedules
        });

    } catch (error) {
        console.error('[ERROR] Get schedules error:', error.message);
        res.status(500).json({ error: 'Failed to fetch schedules' });
    }
});

/**
 * GET /api/schedules/template
 * Return XLSX template structure info (frontend generates actual file)
 */
router.get('/template', (req, res) => {
    res.json({
        success: true,
        template: {
            columns: [
                'Section', 'Grade', 'Adviser Name',
                'Mon Start', 'Mon End',
                'Tue Start', 'Tue End',
                'Wed Start', 'Wed End',
                'Thu Start', 'Thu End',
                'Fri Start', 'Fri End',
                'Sat Start', 'Sat End'
            ],
            example: [
                'ICT-B', '12', 'Juan Dela Cruz',
                '07:00', '17:00',
                '08:30', '17:00',
                '07:00', '17:00',
                '07:00', '17:00',
                '07:00', '16:00',
                '', ''
            ],
            notes: [
                'Time format: HH:MM (24-hour)',
                'Leave Saturday blank if no Saturday classes',
                'Section must match existing section names in students'
            ]
        }
    });
});

/**
 * GET /api/schedules/:section
 * Get schedule for specific section
 */
router.get('/:section', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }

        const section = decodeURIComponent(req.params.section);
        
        const schedule = await db.collection('schedules').findOne({ section });

        if (!schedule) {
            // Return default schedule if none exists
            return res.json({
                success: true,
                data: {
                    section,
                    grade: '',
                    adviser_id: null,
                    adviser_name: null,
                    weekly_schedule: DEFAULT_SCHEDULE,
                    grace_period_minutes: DEFAULT_GRACE_PERIOD,
                    absent_threshold_minutes: DEFAULT_ABSENT_THRESHOLD,
                    is_default: true
                }
            });
        }

        // Apply migration for old format schedules
        const migratedSchedule = migrateScheduleFormat(schedule);

        res.json({
            success: true,
            data: migratedSchedule
        });

    } catch (error) {
        console.error('[ERROR] Get schedule error:', error.message);
        res.status(500).json({ error: 'Failed to fetch schedule' });
    }
});

/**
 * POST /api/schedules
 * Create new section schedule (admin only)
 */
router.post('/', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }

        const user = req.session?.user;
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { section, grade, adviser_id, adviser_name, weekly_schedule } = req.body;

        if (!section) {
            return res.status(400).json({ error: 'Section name required' });
        }

        // Check if schedule already exists
        const existing = await db.collection('schedules').findOne({ section });
        if (existing) {
            return res.status(409).json({ error: 'Schedule already exists for this section' });
        }

        // Validate adviser_id before ObjectId conversion
        const validAdviserId = adviser_id && ObjectId.isValid(adviser_id) ? new ObjectId(adviser_id) : null;

        const newSchedule = {
            section,
            grade: grade || '',
            adviser_id: validAdviserId,
            adviser_name: validAdviserId ? (adviser_name || null) : null,
            weekly_schedule: weekly_schedule || DEFAULT_SCHEDULE,
            grace_period_minutes: DEFAULT_GRACE_PERIOD,
            absent_threshold_minutes: DEFAULT_ABSENT_THRESHOLD,
            created_at: new Date(),
            updated_at: new Date()
        };

        await db.collection('schedules').insertOne(newSchedule);

        // Update adviser's advised_section if assigned
        if (adviser_id) {
            await db.collection('teachers').updateOne(
                { _id: new ObjectId(adviser_id) },
                { 
                    $set: { 
                        advised_section: section,
                        role_type: 'adviser'
                    }
                }
            );
        }

        res.json({
            success: true,
            message: 'Schedule created',
            data: newSchedule
        });

    } catch (error) {
        console.error('[ERROR] Create schedule error:', error.message);
        res.status(500).json({ error: 'Failed to create schedule' });
    }
});

/**
 * PUT /api/schedules/:section
 * Update section schedule (admin or adviser of that section)
 */
router.put('/:section', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }

        const user = req.session?.user;
        const section = decodeURIComponent(req.params.section);

        // Check permissions
        if (!user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (user.role !== 'admin' && user.advised_section !== section) {
            return res.status(403).json({ error: 'Not authorized to edit this section' });
        }

        const { 
            grade, 
            adviser_id, 
            adviser_name, 
            weekly_schedule,
            grace_period_minutes,
            absent_threshold_minutes 
        } = req.body;

        const updates = {
            updated_at: new Date()
        };

        if (grade !== undefined) updates.grade = grade;
        if (weekly_schedule !== undefined) updates.weekly_schedule = weekly_schedule;
        if (grace_period_minutes !== undefined) updates.grace_period_minutes = grace_period_minutes;
        if (absent_threshold_minutes !== undefined) updates.absent_threshold_minutes = absent_threshold_minutes;

        // Only admin can change adviser
        if (user.role === 'admin') {
            if (adviser_id !== undefined) {
                const validAdviserId = adviser_id && ObjectId.isValid(adviser_id) ? new ObjectId(adviser_id) : null;
                updates.adviser_id = validAdviserId;
                updates.adviser_name = validAdviserId ? (adviser_name || null) : null;

                // Update new adviser's role_type and advised_section
                if (validAdviserId) {
                    await db.collection('teachers').updateOne(
                        { _id: validAdviserId },
                        { $set: { advised_section: section, role_type: 'adviser' } }
                    );
                }
            }
        }

        const result = await db.collection('schedules').updateOne(
            { section },
            { $set: updates },
            { upsert: true }
        );

        res.json({
            success: true,
            message: 'Schedule updated',
            modified: result.modifiedCount,
            upserted: result.upsertedCount
        });

    } catch (error) {
        console.error('[ERROR] Update schedule error:', error.message);
        res.status(500).json({ error: 'Failed to update schedule' });
    }
});

/**
 * DELETE /api/schedules/:section
 * Delete section schedule (admin only)
 */
router.delete('/:section', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }

        const user = req.session?.user;
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const section = decodeURIComponent(req.params.section);

        // Get schedule to find adviser
        const schedule = await db.collection('schedules').findOne({ section });

        if (schedule && schedule.adviser_id) {
            // Remove adviser assignment
            await db.collection('teachers').updateOne(
                { _id: schedule.adviser_id },
                { 
                    $unset: { advised_section: '' },
                    $set: { role_type: 'teacher' }
                }
            );
        }

        const result = await db.collection('schedules').deleteOne({ section });

        res.json({
            success: true,
            message: 'Schedule deleted',
            deleted: result.deletedCount
        });

    } catch (error) {
        console.error('[ERROR] Delete schedule error:', error.message);
        res.status(500).json({ error: 'Failed to delete schedule' });
    }
});

/**
 * POST /api/schedules/import
 * Import schedules from XLSX file (admin only)
 */
router.post('/import', upload.single('file'), async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }

        const user = req.session?.user;
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Parse XLSX
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        if (rows.length < 2) {
            return res.status(400).json({ error: 'File must have header row and at least one data row' });
        }

        // Parse header to find column indices
        const header = rows[0].map(h => String(h).toLowerCase().trim());
        const colMap = {
            section: header.findIndex(h => h.includes('section')),
            grade: header.findIndex(h => h.includes('grade')),
            adviser: header.findIndex(h => h.includes('adviser')),
            mon_start: header.findIndex(h => h.includes('mon') && h.includes('start')),
            mon_end: header.findIndex(h => h.includes('mon') && h.includes('end')),
            tue_start: header.findIndex(h => h.includes('tue') && h.includes('start')),
            tue_end: header.findIndex(h => h.includes('tue') && h.includes('end')),
            wed_start: header.findIndex(h => h.includes('wed') && h.includes('start')),
            wed_end: header.findIndex(h => h.includes('wed') && h.includes('end')),
            thu_start: header.findIndex(h => h.includes('thu') && h.includes('start')),
            thu_end: header.findIndex(h => h.includes('thu') && h.includes('end')),
            fri_start: header.findIndex(h => h.includes('fri') && h.includes('start')),
            fri_end: header.findIndex(h => h.includes('fri') && h.includes('end')),
            sat_start: header.findIndex(h => h.includes('sat') && h.includes('start')),
            sat_end: header.findIndex(h => h.includes('sat') && h.includes('end'))
        };

        if (colMap.section === -1) {
            return res.status(400).json({ error: 'Section column not found in file' });
        }

        // Process data rows
        const results = { created: 0, updated: 0, errors: [] };

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;

            const section = row[colMap.section]?.toString().trim();
            if (!section) continue;

            try {
                const scheduleData = {
                    section,
                    grade: colMap.grade >= 0 ? row[colMap.grade]?.toString() || '' : '',
                    adviser_name: colMap.adviser >= 0 ? row[colMap.adviser]?.toString() || null : null,
                    weekly_schedule: {
                        monday: {
                            start: colMap.mon_start >= 0 ? formatTime(row[colMap.mon_start]) : '07:00',
                            end: colMap.mon_end >= 0 ? formatTime(row[colMap.mon_end]) : '17:00'
                        },
                        tuesday: {
                            start: colMap.tue_start >= 0 ? formatTime(row[colMap.tue_start]) : '07:00',
                            end: colMap.tue_end >= 0 ? formatTime(row[colMap.tue_end]) : '17:00'
                        },
                        wednesday: {
                            start: colMap.wed_start >= 0 ? formatTime(row[colMap.wed_start]) : '07:00',
                            end: colMap.wed_end >= 0 ? formatTime(row[colMap.wed_end]) : '17:00'
                        },
                        thursday: {
                            start: colMap.thu_start >= 0 ? formatTime(row[colMap.thu_start]) : '07:00',
                            end: colMap.thu_end >= 0 ? formatTime(row[colMap.thu_end]) : '17:00'
                        },
                        friday: {
                            start: colMap.fri_start >= 0 ? formatTime(row[colMap.fri_start]) : '07:00',
                            end: colMap.fri_end >= 0 ? formatTime(row[colMap.fri_end]) : '17:00'
                        },
                        saturday: {
                            start: colMap.sat_start >= 0 ? formatTime(row[colMap.sat_start]) : null,
                            end: colMap.sat_end >= 0 ? formatTime(row[colMap.sat_end]) : null
                        }
                    },
                    grace_period_minutes: DEFAULT_GRACE_PERIOD,
                    absent_threshold_minutes: DEFAULT_ABSENT_THRESHOLD,
                    updated_at: new Date()
                };

                // Upsert schedule
                const result = await db.collection('schedules').updateOne(
                    { section },
                    { 
                        $set: scheduleData,
                        $setOnInsert: { created_at: new Date() }
                    },
                    { upsert: true }
                );

                if (result.upsertedCount > 0) {
                    results.created++;
                } else if (result.modifiedCount > 0) {
                    results.updated++;
                }

            } catch (err) {
                results.errors.push({ row: i + 1, section, error: err.message });
            }
        }

        res.json({
            success: true,
            message: `Import complete: ${results.created} created, ${results.updated} updated`,
            results
        });

    } catch (error) {
        console.error('[ERROR] Import schedules error:', error.message);
        res.status(500).json({ error: 'Failed to import schedules: ' + error.message });
    }
});

/**
 * Helper: Format time string to HH:MM
 */
function formatTime(value) {
    if (!value) return null;
    
    const str = String(value).trim();
    
    // Already in HH:MM format
    if (/^\d{1,2}:\d{2}$/.test(str)) {
        const [h, m] = str.split(':');
        return `${h.padStart(2, '0')}:${m}`;
    }
    
    // HHMM format
    if (/^\d{4}$/.test(str)) {
        return `${str.slice(0, 2)}:${str.slice(2)}`;
    }
    
    // Decimal time (Excel sometimes stores time as fraction of day)
    const num = parseFloat(str);
    if (!isNaN(num) && num >= 0 && num < 1) {
        const totalMinutes = Math.round(num * 24 * 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
    
    return str;
}

/**
 * GET /api/schedules/today/:section
 * Get today's schedule for a section (used by hardware)
 */
router.get('/today/:section', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }

        const section = decodeURIComponent(req.params.section);
        const schedule = await db.collection('schedules').findOne({ section });

        // Get today's day name
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const today = days[new Date().getDay()];

        if (!schedule) {
            // Return default
            return res.json({
                success: true,
                section,
                day: today,
                schedule: today === 'sunday' ? null : { start: '07:00', end: '17:00' },
                grace_period_minutes: DEFAULT_GRACE_PERIOD,
                absent_threshold_minutes: DEFAULT_ABSENT_THRESHOLD
            });
        }

        // Apply migration for old format schedules
        const migratedSchedule = migrateScheduleFormat(schedule);
        const todaySchedule = migratedSchedule.weekly_schedule?.[today] || null;

        res.json({
            success: true,
            section,
            day: today,
            schedule: todaySchedule,
            grace_period_minutes: migratedSchedule.grace_period_minutes || DEFAULT_GRACE_PERIOD,
            absent_threshold_minutes: migratedSchedule.absent_threshold_minutes || DEFAULT_ABSENT_THRESHOLD
        });

    } catch (error) {
        console.error('[ERROR] Get today schedule error:', error.message);
        res.status(500).json({ error: 'Failed to fetch schedule' });
    }
});

module.exports = router;
