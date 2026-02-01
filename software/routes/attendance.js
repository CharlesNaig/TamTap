/**
 * TAMTAP Attendance Routes
 * GET /api/attendance - Today's attendance (with optional section filter)
 * GET /api/attendance/:date - Attendance by date (with optional section filter)
 * GET /api/attendance/range - Attendance by date range
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/attendance
 * Get today's attendance records
 * Query params: 
 *   ?section=11-A (single section filter)
 *   ?sections=11-A,11-B,12-A (multiple sections filter)
 */
router.get('/', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const today = new Date().toISOString().split('T')[0];  // YYYY-MM-DD
        const section = req.query.section;
        const sections = req.query.sections; // comma-separated list
        
        // Build query
        const query = { date: { $regex: `^${today}` } };
        
        if (section) {
            // Single section filter
            query.section = section;
        } else if (sections) {
            // Multiple sections filter (for teachers)
            const sectionList = sections.split(',').map(s => s.trim()).filter(Boolean);
            if (sectionList.length > 0) {
                query.section = { $in: sectionList };
            }
        }
        
        const records = await db.collection('attendance')
            .find(query)
            .sort({ date: -1 })
            .toArray();
        
        res.json({
            success: true,
            date: today,
            section: section || 'all',
            count: records.length,
            records: records.map(r => ({
                nfc_id: r.nfc_id,
                tamtap_id: r.tamtap_id || '',
                name: r.name,
                role: r.role,
                date: r.date,
                time: r.time,
                session: r.session,
                photo: r.photo,
                grade: r.grade || '',
                section: r.section || '',
                status: r.status || 'present'
            }))
        });
        
    } catch (error) {
        console.error('[ERROR] Get attendance error:', error.message);
        res.status(500).json({ error: 'Failed to fetch attendance' });
    }
});

/**
 * GET /api/attendance/:date
 * Get attendance for a specific date
 * @param date - Date in YYYY-MM-DD format
 * Query params: 
 *   ?section=11-A (single section filter)
 *   ?sections=11-A,11-B,12-A (multiple sections filter)
 */
router.get('/:date', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            console.log('[WARN] Database not available for attendance query');
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const dateParam = req.params.date;
        const section = req.query.section;
        const sections = req.query.sections; // comma-separated list
        
        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
            return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
        }
        
        // Build query with optional section filter
        const query = { date: { $regex: `^${dateParam}` } };
        
        if (section) {
            // Single section filter
            query.section = section;
        } else if (sections) {
            // Multiple sections filter (for teachers)
            const sectionList = sections.split(',').map(s => s.trim()).filter(Boolean);
            if (sectionList.length > 0) {
                query.section = { $in: sectionList };
            }
        }
        
        console.log('[DEBUG] Attendance query:', JSON.stringify(query));
        
        const records = await db.collection('attendance')
            .find(query)
            .sort({ time: 1 })
            .toArray();
        
        console.log('[DEBUG] Found', records.length, 'attendance records');
        
        res.json({
            success: true,
            date: dateParam,
            section: section || 'all',
            count: records.length,
            records: records.map(r => ({
                nfc_id: r.nfc_id,
                tamtap_id: r.tamtap_id || '',
                name: r.name,
                role: r.role,
                date: r.date,
                time: r.time,
                session: r.session,
                photo: r.photo,
                grade: r.grade || '',
                section: r.section || '',
                status: r.status || 'present'
            }))
        });
        
    } catch (error) {
        console.error('[ERROR] Get attendance by date error:', error.message);
        res.status(500).json({ error: 'Failed to fetch attendance' });
    }
});

/**
 * GET /api/attendance/range/query
 * Get attendance for a date range
 * @query from - Start date (YYYY-MM-DD)
 * @query to - End date (YYYY-MM-DD)
 * @query section - Optional: Filter by section
 * @query sections - Optional: Filter by multiple sections (comma-separated)
 */
router.get('/range/query', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const { from, to, section, sections } = req.query;
        
        if (!from || !to) {
            return res.status(400).json({ error: 'Missing from or to date parameter' });
        }
        
        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
            return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
        }
        
        // Build query
        const query = {
            date: {
                $gte: from,
                $lte: to + ' 23:59:59'
            }
        };
        
        // Add section filter if provided
        if (section) {
            query.section = section;
        } else if (sections) {
            const sectionList = sections.split(',').map(s => s.trim());
            query.section = { $in: sectionList };
        }
        
        const records = await db.collection('attendance')
            .find(query)
            .sort({ date: -1 })
            .toArray();
        
        res.json({
            success: true,
            from: from,
            to: to,
            count: records.length,
            records: records.map(r => ({
                nfc_id: r.nfc_id,
                tamtap_id: r.tamtap_id || '',
                name: r.name,
                role: r.role,
                date: r.date,
                time: r.time,
                session: r.session,
                photo: r.photo,
                grade: r.grade || '',
                section: r.section || '',
                status: r.status || 'present'
            }))
        });
        
    } catch (error) {
        console.error('[ERROR] Get attendance range error:', error.message);
        res.status(500).json({ error: 'Failed to fetch attendance' });
    }
});

/**
 * GET /api/attendance/student/:nfc_id
 * Get attendance history for a specific student
 * SECURITY: Validates section ownership - teacher must be assigned to student's section
 * @param nfc_id - Student's NFC card ID
 * @query from - Optional start date (YYYY-MM-DD) for date range filter
 * @query to - Optional end date (YYYY-MM-DD) for date range filter
 */
router.get('/student/:nfc_id', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const nfcId = req.params.nfc_id;
        const user = req.user;
        const { from, to } = req.query;
        
        // Get student info first
        const student = await db.collection('students').findOne({ nfc_id: nfcId });
        if (!student) {
            return res.status(404).json({ success: false, error: 'Student not found' });
        }
        
        // SECURITY: Section ownership validation (skip for admin)
        if (user && user.role !== 'admin') {
            const teacherSections = user.sections_handled || [];
            if (!teacherSections.includes(student.section)) {
                console.warn(`[WARN] Unauthorized access attempt: ${user.username} tried to access student in section ${student.section}`);
                return res.status(403).json({ 
                    success: false, 
                    error: 'Access denied: You are not assigned to this student\'s section' 
                });
            }
        }
        
        // Build date query
        const query = { nfc_id: nfcId };
        if (from && to) {
            query.date = { $gte: from, $lte: to + ' 23:59:59' };
        }
        
        // Get attendance records
        const records = await db.collection('attendance')
            .find(query)
            .sort({ date: -1 })
            .toArray();
        
        // Calculate summary stats
        let totalPresent = 0;
        let totalLate = 0;
        let totalAbsent = 0;
        let totalExcused = 0;
        
        records.forEach(r => {
            switch (r.status) {
                case 'present': totalPresent++; break;
                case 'late': totalLate++; break;
                case 'absent': totalAbsent++; break;
                case 'excused': totalExcused++; break;
                default: totalPresent++; // Default to present if no status
            }
        });
        
        const totalDays = records.length;
        const attendanceRate = totalDays > 0 
            ? Math.round(((totalPresent + totalLate) / totalDays) * 100) 
            : 0;
        
        res.json({
            success: true,
            student: {
                nfc_id: student.nfc_id,
                tamtap_id: student.tamtap_id || '',
                name: student.name,
                grade: student.grade || '',
                section: student.section
            },
            summary: {
                totalDays,
                present: totalPresent,
                late: totalLate,
                absent: totalAbsent,
                excused: totalExcused,
                attendanceRate
            },
            records: records.map(r => ({
                date: r.date,
                time: r.time,
                session: r.session,
                status: r.status || 'present',
                photo: r.photo,
                notes: r.notes || ''
            }))
        });
        
    } catch (error) {
        console.error('[ERROR] Get student attendance error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch attendance' });
    }
});

module.exports = router;
