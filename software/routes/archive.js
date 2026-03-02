/**
 * TAMTAP Archive Routes (Admin-only)
 * Mirrors all options from hardware/archive_attendance.py via REST API
 *
 * GET  /api/archive/attendance  - View records (filters: date, nfc_id, section, limit)
 * GET  /api/archive/sections    - Unique sections in attendance (filter: date)
 * GET  /api/archive/students    - Unique students in attendance (filter: date, section)
 * GET  /api/archive/dates       - Unique dates in attendance (filter: nfc_id, section)
 * GET  /api/archive/stats       - Overview stats
 * GET  /api/archive/list        - List all archive batches
 * POST /api/archive/run         - Archive records (no delete)
 * POST /api/archive/clear       - Clear records (optionally archive first)
 */

const express = require('express');
const { getPhilippineDate } = require('../utils/dateUtils');
const router = express.Router();
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const logger = require('../utils/Logger');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sanitizeDate } = require('../utils/sanitize');

// All archive routes require admin role
router.use(requireAuth, requireAdmin);

// ----------------------------------------
// JSON SYNC HELPER
// When MongoDB records are archived/cleared, mirror the change to JSON fallback.
// Online flow: MongoDB → JSON (source of truth is MongoDB)
// ----------------------------------------
const JSON_DB_PATH = path.join(__dirname, '..', '..', 'database', 'tamtap_users.json');

/**
 * Remove matching attendance records from the JSON fallback file.
 * @param {Object} query - MongoDB-style query used to match records
 */
async function syncJsonAfterClear(query) {
    try {
        try {
            await fsPromises.access(JSON_DB_PATH);
        } catch {
            return; // File does not exist
        }

        const raw = await fsPromises.readFile(JSON_DB_PATH, 'utf-8');
        const data = JSON.parse(raw);

        const originalAtt = (data.attendance || []).length;
        const originalPend = (data.pending_attendance || []).length;

        // Build a filter function from the MongoDB query
        const matchFn = buildMatchFn(query);

        data.attendance = (data.attendance || []).filter(r => !matchFn(r));
        data.pending_attendance = (data.pending_attendance || []).filter(r => !matchFn(r));

        const removedAtt = originalAtt - data.attendance.length;
        const removedPend = originalPend - data.pending_attendance.length;

        if (removedAtt > 0 || removedPend > 0) {
            await fsPromises.writeFile(JSON_DB_PATH, JSON.stringify(data, null, 2));
            logger.info(`JSON sync: removed ${removedAtt} attendance + ${removedPend} pending records`);
        }
    } catch (e) {
        logger.error('JSON sync error:', e.message);
    }
}

/**
 * Build a JS match function from a simple MongoDB-style query.
 * Supports: exact match, $regex, $in
 */
function buildMatchFn(query) {
    return (record) => {
        for (const [key, condition] of Object.entries(query)) {
            const val = record[key] || record[key === 'nfc_id' ? 'uid' : ''] || '';
            const valStr = String(val);

            if (condition === null || condition === undefined) continue;

            if (typeof condition === 'object' && condition.$regex) {
                if (!new RegExp(condition.$regex).test(valStr)) return false;
            } else if (typeof condition === 'object' && condition.$in) {
                if (!condition.$in.map(String).includes(valStr)) return false;
            } else {
                if (valStr !== String(condition)) return false;
            }
        }
        return true;
    };
}

// ----------------------------------------
// HELPERS
// ----------------------------------------
function buildQuery(date, nfc_id, section) {
    const query = {};
    const safeDate = sanitizeDate(date);
    if (safeDate)  query.date    = { $regex: `^${safeDate}` };
    if (nfc_id)    query.nfc_id  = nfc_id;
    if (section)   query.section = section;
    return query;
}

function generateArchiveName(scope, { nfc_id, section, date } = {}) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const parts = ['archive', scope];
    if (nfc_id)  parts.push(nfc_id.slice(-6));
    if (section) parts.push(section.replace(/\s+/g, '_'));
    if (date)    parts.push(date);
    parts.push(ts);
    return parts.join('_');
}

function parseScopeQuery(scope, { date, nfc_id, section, nfc_ids } = {}) {
    const today = getPhilippineDate();
    const safeDate = sanitizeDate(date);
    let query = {};
    switch (scope) {
        case 'today':
            query = { date: { $regex: `^${today}` } };
            break;
        case 'all':
            query = {};
            break;
        case 'date':
            if (!safeDate) return { error: 'Valid date required (YYYY-MM-DD)' };
            query = { date: { $regex: `^${safeDate}` } };
            break;
        case 'student':
            if (!nfc_id) return { error: 'nfc_id required' };
            query = { nfc_id };
            if (safeDate) query.date = { $regex: `^${safeDate}` };
            break;
        case 'section':
            if (!section) return { error: 'section required' };
            query = { section };
            if (safeDate) query.date = { $regex: `^${safeDate}` };
            break;
        case 'bulk':
            if (!nfc_ids || !nfc_ids.length) return { error: 'nfc_ids required' };
            query = { nfc_id: { $in: nfc_ids } };
            if (safeDate) query.date = { $regex: `^${safeDate}` };
            break;
        default:
            return { error: 'Invalid scope. Use: today, all, date, student, section, bulk' };
    }
    return { query };
}

// ----------------------------------------
// GET /api/archive/attendance
// View current attendance records with optional filters
// ----------------------------------------
router.get('/attendance', async (req, res) => {
    try {
        const db = req.db;
        if (!db) return res.status(503).json({ success: false, error: 'Database unavailable' });

        const { date, nfc_id, section } = req.query;
        const limit = Math.min(parseInt(req.query.limit) || 200, 500);

        const query = buildQuery(date, nfc_id, section);
        const records = await db.collection('attendance')
            .find(query)
            .sort({ date: -1 })
            .limit(limit)
            .toArray();

        res.json({ success: true, count: records.length, records });
    } catch (e) {
        logger.error('Archive get attendance:', e.message);
        res.status(500).json({ success: false, error: 'Failed to fetch attendance' });
    }
});

// ----------------------------------------
// GET /api/archive/sections
// Unique sections present in attendance
// ----------------------------------------
router.get('/sections', async (req, res) => {
    try {
        const db = req.db;
        if (!db) return res.status(503).json({ success: false, error: 'Database unavailable' });

        const { date } = req.query;
        const baseQuery = date ? { date: { $regex: `^${date}` } } : {};

        const sectionNames = await db.collection('attendance').distinct('section', baseQuery);
        const sections = [];
        for (const s of sectionNames.filter(Boolean).sort()) {
            const count = await db.collection('attendance')
                .countDocuments({ ...baseQuery, section: s });
            sections.push({ section: s, count });
        }
        res.json({ success: true, sections });
    } catch (e) {
        logger.error('Archive get sections:', e.message);
        res.status(500).json({ success: false, error: 'Failed to fetch sections' });
    }
});

// ----------------------------------------
// GET /api/archive/students
// Unique students present in attendance
// ----------------------------------------
router.get('/students', async (req, res) => {
    try {
        const db = req.db;
        if (!db) return res.status(503).json({ success: false, error: 'Database unavailable' });

        const { date, section } = req.query;
        const query = buildQuery(date, null, section);

        const records = await db.collection('attendance').find(query).toArray();
        const map = {};
        for (const r of records) {
            if (!r.nfc_id) continue;
            if (!map[r.nfc_id]) {
                map[r.nfc_id] = {
                    nfc_id: r.nfc_id,
                    name: r.name || '',
                    section: r.section || '',
                    tamtap_id: r.tamtap_id || '',
                    count: 0
                };
            }
            map[r.nfc_id].count++;
        }

        const students = Object.values(map)
            .sort((a, b) => (a.tamtap_id || '999').localeCompare(b.tamtap_id || '999'));

        res.json({ success: true, students });
    } catch (e) {
        logger.error('Archive get students:', e.message);
        res.status(500).json({ success: false, error: 'Failed to fetch students' });
    }
});

// ----------------------------------------
// GET /api/archive/dates
// Unique dates present in attendance
// ----------------------------------------
router.get('/dates', async (req, res) => {
    try {
        const db = req.db;
        if (!db) return res.status(503).json({ success: false, error: 'Database unavailable' });

        const { nfc_id, section } = req.query;
        const query = buildQuery(null, nfc_id, section);

        const records = await db.collection('attendance').find(query).toArray();
        const map = {};
        for (const r of records) {
            const d = (r.date || '').split(' ')[0];
            if (!d) continue;
            map[d] = (map[d] || 0) + 1;
        }

        const dates = Object.entries(map)
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([date, count]) => ({ date, count }));

        res.json({ success: true, dates });
    } catch (e) {
        logger.error('Archive get dates:', e.message);
        res.status(500).json({ success: false, error: 'Failed to fetch dates' });
    }
});

// ----------------------------------------
// GET /api/archive/stats
// Overview statistics
// ----------------------------------------
router.get('/stats', async (req, res) => {
    try {
        const db = req.db;
        if (!db) return res.status(503).json({ success: false, error: 'Database unavailable' });

        const today = getPhilippineDate();

        // Use aggregation instead of loading all records into memory (H-5)
        const [total, todayCount, archiveCount, distinctStats] = await Promise.all([
            db.collection('attendance').countDocuments(),
            db.collection('attendance').countDocuments({ date: { $regex: `^${today}` } }),
            db.collection('attendance_archives').countDocuments(),
            db.collection('attendance').aggregate([
                {
                    $group: {
                        _id: null,
                        dates: { $addToSet: { $substr: ['$date', 0, 10] } },
                        sections: { $addToSet: '$section' },
                        students: { $addToSet: '$nfc_id' }
                    }
                }
            ]).toArray()
        ]);

        const agg = distinctStats[0] || { dates: [], sections: [], students: [] };

        res.json({
            success: true,
            stats: {
                total,
                today: todayCount,
                uniqueDates:    agg.dates.length,
                uniqueSections: agg.sections.filter(Boolean).length,
                uniqueStudents: agg.students.filter(Boolean).length,
                archives:       archiveCount
            }
        });
    } catch (e) {
        logger.error('Archive stats:', e.message);
        res.status(500).json({ success: false, error: 'Failed to fetch stats' });
    }
});

// ----------------------------------------
// GET /api/archive/list
// List all archive batches
// ----------------------------------------
router.get('/list', async (req, res) => {
    try {
        const db = req.db;
        if (!db) return res.status(503).json({ success: false, error: 'Database unavailable' });

        const archives = await db.collection('attendance_archives')
            .aggregate([
                {
                    $group: {
                        _id: '$archive_name',
                        count:      { $sum: 1 },
                        archivedAt: { $first: '$archived_at' },
                        archivedBy: { $first: '$archived_by' }
                    }
                },
                { $sort: { archivedAt: -1 } }
            ])
            .toArray();

        res.json({
            success: true,
            archives: archives.map(a => ({
                name:       a._id,
                count:      a.count,
                archivedAt: a.archivedAt,
                archivedBy: a.archivedBy
            }))
        });
    } catch (e) {
        logger.error('Archive list:', e.message);
        res.status(500).json({ success: false, error: 'Failed to list archives' });
    }
});

// ----------------------------------------
// POST /api/archive/run
// Archive records (copy to attendance_archives, does NOT delete from attendance)
// Body: { scope, date?, nfc_id?, section?, nfc_ids? }
// ----------------------------------------
router.post('/run', async (req, res) => {
    try {
        const db = req.db;
        if (!db) return res.status(503).json({ success: false, error: 'Database unavailable' });

        const { scope, date, nfc_id, section, nfc_ids } = req.body;
        if (!scope) return res.status(400).json({ success: false, error: 'scope required' });

        const { query, error } = parseScopeQuery(scope, { date, nfc_id, section, nfc_ids });
        if (error) return res.status(400).json({ success: false, error });

        const records = await db.collection('attendance').find(query).toArray();
        if (!records.length) {
            return res.status(404).json({ success: false, error: 'No records found matching the criteria' });
        }

        const archiveName = generateArchiveName(scope, { nfc_id, section, date });
        const archiveDocs = records.map(r => {
            const doc = { ...r };
            delete doc._id;
            doc.archive_name = archiveName;
            doc.archived_at  = new Date().toISOString();
            doc.archived_by  = req.user.username;
            return doc;
        });

        await db.collection('attendance_archives').insertMany(archiveDocs);

        logger.info(`Archived ${records.length} records as "${archiveName}" by ${req.user.username}`);

        res.json({
            success:     true,
            message:     `Archived ${records.length} records`,
            archiveName,
            count:       records.length
        });
    } catch (e) {
        logger.error('Archive run:', e.message);
        res.status(500).json({ success: false, error: 'Archive failed' });
    }
});

// ----------------------------------------
// POST /api/archive/clear
// Clear records from attendance collection
// Body: { scope, clearMode: 'archive_and_clear'|'clear_only', date?, nfc_id?, section?, nfc_ids? }
// ----------------------------------------
router.post('/clear', async (req, res) => {
    try {
        const db = req.db;
        if (!db) return res.status(503).json({ success: false, error: 'Database unavailable' });

        const { scope, clearMode, date, nfc_id, section, nfc_ids } = req.body;
        if (!scope) return res.status(400).json({ success: false, error: 'scope required' });

        const { query, error } = parseScopeQuery(scope, { date, nfc_id, section, nfc_ids });
        if (error) return res.status(400).json({ success: false, error });

        let archiveName   = null;
        let archivedCount = 0;

        // Archive first if requested
        if (clearMode === 'archive_and_clear') {
            const records = await db.collection('attendance').find(query).toArray();
            if (records.length) {
                archiveName = generateArchiveName(`clear_${scope}`, { nfc_id, section, date });
                const archiveDocs = records.map(r => {
                    const doc = { ...r };
                    delete doc._id;
                    doc.archive_name = archiveName;
                    doc.archived_at  = new Date().toISOString();
                    doc.archived_by  = req.user.username;
                    return doc;
                });
                await db.collection('attendance_archives').insertMany(archiveDocs);
                archivedCount = records.length;
            }
        }

        const result = await db.collection('attendance').deleteMany(query);
        
        // Sync JSON fallback: remove matching records so hardware doesn't see stale data
        await syncJsonAfterClear(query);
        
        logger.info(`Cleared ${result.deletedCount} records (scope: ${scope}) by ${req.user.username}`);

        res.json({
            success:     true,
            message:     `Cleared ${result.deletedCount} records`,
            deleted:     result.deletedCount,
            archived:    archivedCount,
            archiveName
        });
    } catch (e) {
        logger.error('Archive clear:', e.message);
        res.status(500).json({ success: false, error: 'Clear failed' });
    }
});

module.exports = router;
