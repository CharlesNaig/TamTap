/**
 * TAMTAP Notifications Routes
 * Manages attendance notifications, pending absences, and excused marking
 * 
 * GET  /api/notifications/pending     - Get students who haven't tapped today
 * GET  /api/notifications/count       - Get pending absence count for badge
 * POST /api/notifications/mark-excused - Mark student as excused
 * POST /api/notifications/mark-absent  - Confirm student as absent
 * POST /api/notifications/bulk-absent  - Mark all pending as absent (end of day)
 */

const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

// Excuse reasons
const EXCUSE_REASONS = [
    'Medical',
    'Family Emergency',
    'School Activity',
    'Weather',
    'Transportation',
    'Other'
];

/**
 * Get Philippine date string (YYYY-MM-DD)
 */
function getPhilippineDate() {
    const now = new Date();
    const phTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
    const year = phTime.getFullYear();
    const month = String(phTime.getMonth() + 1).padStart(2, '0');
    const day = String(phTime.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * GET /api/notifications/pending
 * Get students who haven't tapped today
 * Grouped by section
 */
router.get('/pending', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }

        const user = req.session?.user;
        if (!user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const today = getPhilippineDate();

        // Get all students (filtered by user's sections if not admin)
        let studentQuery = {};
        if (user.role !== 'admin') {
            const sections = [];
            if (user.advised_section) sections.push(user.advised_section);
            if (user.sections_handled) sections.push(...user.sections_handled);
            if (sections.length > 0) {
                studentQuery.section = { $in: sections };
            } else {
                // No sections assigned, return empty
                return res.json({ success: true, count: 0, data: [] });
            }
        }

        const allStudents = await db.collection('students')
            .find(studentQuery)
            .project({ nfc_id: 1, tamtap_id: 1, name: 1, first_name: 1, last_name: 1, section: 1, grade: 1 })
            .toArray();

        if (allStudents.length === 0) {
            return res.json({ success: true, count: 0, data: [] });
        }

        // Get today's attendance records
        const attendanceToday = await db.collection('attendance')
            .find({ 
                date: { $regex: `^${today}` }
            })
            .project({ nfc_id: 1, status: 1 })
            .toArray();

        // Create set of NFC IDs who have tapped or been marked
        const tappedIds = new Set(attendanceToday.map(a => String(a.nfc_id)));

        // Filter to students who haven't tapped
        const pending = allStudents.filter(s => !tappedIds.has(String(s.nfc_id)));

        // Group by section
        const grouped = {};
        for (const student of pending) {
            const section = student.section || 'Unknown';
            if (!grouped[section]) {
                grouped[section] = [];
            }
            const name = student.name || `${student.first_name || ''} ${student.last_name || ''}`.trim();
            grouped[section].push({
                nfc_id: student.nfc_id,
                tamtap_id: student.tamtap_id || '',
                name,
                grade: student.grade || ''
            });
        }

        // Convert to array format
        const data = Object.entries(grouped).map(([section, students]) => ({
            section,
            count: students.length,
            students
        }));

        res.json({
            success: true,
            date: today,
            count: pending.length,
            sections: data.length,
            data
        });

    } catch (error) {
        console.error('[ERROR] Get pending absences error:', error.message);
        res.status(500).json({ error: 'Failed to fetch pending absences' });
    }
});

/**
 * GET /api/notifications/count
 * Get pending absence count for badge
 */
router.get('/count', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }

        const user = req.session?.user;
        if (!user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const today = getPhilippineDate();

        // Build student query based on user's sections
        let studentQuery = {};
        if (user.role !== 'admin') {
            const sections = [];
            if (user.advised_section) sections.push(user.advised_section);
            if (user.sections_handled) sections.push(...user.sections_handled);
            if (sections.length > 0) {
                studentQuery.section = { $in: sections };
            } else {
                return res.json({ success: true, count: 0 });
            }
        }

        // Count students
        const totalStudents = await db.collection('students').countDocuments(studentQuery);

        // Count today's attendance records for those sections
        let attendanceQuery = { date: { $regex: `^${today}` } };
        if (Object.keys(studentQuery).length > 0) {
            const sectionStudentIds = await db.collection('students')
                .find(studentQuery)
                .project({ nfc_id: 1 })
                .toArray();
            const nfcIds = sectionStudentIds.map(s => s.nfc_id);
            attendanceQuery.nfc_id = { $in: nfcIds.map(String) };
        }

        const attendedCount = await db.collection('attendance').countDocuments(attendanceQuery);

        const pendingCount = Math.max(0, totalStudents - attendedCount);

        res.json({
            success: true,
            count: pendingCount,
            date: today
        });

    } catch (error) {
        console.error('[ERROR] Get notification count error:', error.message);
        res.status(500).json({ error: 'Failed to fetch count' });
    }
});

/**
 * GET /api/notifications/reasons
 * Get list of valid excuse reasons
 */
router.get('/reasons', (req, res) => {
    res.json({
        success: true,
        reasons: EXCUSE_REASONS
    });
});

/**
 * POST /api/notifications/mark-excused
 * Mark a student as excused for today
 */
router.post('/mark-excused', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }

        const user = req.session?.user;
        if (!user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { nfc_id, reason, note } = req.body;

        if (!nfc_id) {
            return res.status(400).json({ error: 'Student NFC ID required' });
        }

        if (!reason || !EXCUSE_REASONS.includes(reason)) {
            return res.status(400).json({ 
                error: 'Valid reason required',
                valid_reasons: EXCUSE_REASONS
            });
        }

        // Get student info
        const student = await db.collection('students').findOne({ 
            $or: [
                { nfc_id: nfc_id },
                { nfc_id: String(nfc_id) },
                { nfc_id: parseInt(nfc_id) }
            ]
        });

        if (!student) {
            return res.status(404).json({ error: 'Student not found' });
        }

        // Check permissions - admin can mark any, adviser only their section
        if (user.role !== 'admin') {
            const userSections = [];
            if (user.advised_section) userSections.push(user.advised_section);
            if (!userSections.includes(student.section)) {
                return res.status(403).json({ error: 'Not authorized to mark this student' });
            }
        }

        const today = getPhilippineDate();
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { 
            timeZone: 'Asia/Manila',
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        const name = student.name || `${student.first_name || ''} ${student.last_name || ''}`.trim();

        // Check if record already exists for today
        const existing = await db.collection('attendance').findOne({
            nfc_id: String(nfc_id),
            date: { $regex: `^${today}` }
        });

        if (existing) {
            // Update existing record to excused
            await db.collection('attendance').updateOne(
                { _id: existing._id },
                {
                    $set: {
                        status: 'excused',
                        excuse_reason: reason,
                        excuse_note: note || null,
                        marked_by: user.id,
                        marked_by_name: user.name,
                        marked_at: now
                    }
                }
            );
        } else {
            // Create new excused record
            await db.collection('attendance').insertOne({
                nfc_id: String(nfc_id),
                tamtap_id: student.tamtap_id || '',
                name,
                section: student.section || '',
                grade: student.grade || '',
                date: `${today} ${timeStr}`,
                time: timeStr,
                session: now.getHours() < 12 ? 'AM' : 'PM',
                status: 'excused',
                excuse_reason: reason,
                excuse_note: note || null,
                marked_by: user.id,
                marked_by_name: user.name,
                marked_at: now,
                photo: null
            });
        }

        res.json({
            success: true,
            message: `${name} marked as excused`,
            data: {
                nfc_id,
                name,
                status: 'excused',
                reason,
                marked_by: user.name
            }
        });

    } catch (error) {
        console.error('[ERROR] Mark excused error:', error.message);
        res.status(500).json({ error: 'Failed to mark student as excused' });
    }
});

/**
 * POST /api/notifications/mark-absent
 * Confirm a student as absent for today
 */
router.post('/mark-absent', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }

        const user = req.session?.user;
        if (!user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { nfc_id } = req.body;

        if (!nfc_id) {
            return res.status(400).json({ error: 'Student NFC ID required' });
        }

        // Get student info
        const student = await db.collection('students').findOne({ 
            $or: [
                { nfc_id: nfc_id },
                { nfc_id: String(nfc_id) },
                { nfc_id: parseInt(nfc_id) }
            ]
        });

        if (!student) {
            return res.status(404).json({ error: 'Student not found' });
        }

        // Check permissions
        if (user.role !== 'admin') {
            const userSections = [];
            if (user.advised_section) userSections.push(user.advised_section);
            if (!userSections.includes(student.section)) {
                return res.status(403).json({ error: 'Not authorized to mark this student' });
            }
        }

        const today = getPhilippineDate();
        const now = new Date();
        const name = student.name || `${student.first_name || ''} ${student.last_name || ''}`.trim();

        // Check if already marked
        const existing = await db.collection('attendance').findOne({
            nfc_id: String(nfc_id),
            date: { $regex: `^${today}` }
        });

        if (existing) {
            return res.status(409).json({ 
                error: 'Student already has attendance record for today',
                current_status: existing.status
            });
        }

        // Create absent record
        await db.collection('attendance').insertOne({
            nfc_id: String(nfc_id),
            tamtap_id: student.tamtap_id || '',
            name,
            section: student.section || '',
            grade: student.grade || '',
            date: today,
            time: null,
            session: null,
            status: 'absent',
            marked_by: user.id,
            marked_by_name: user.name,
            marked_at: now,
            photo: null
        });

        res.json({
            success: true,
            message: `${name} marked as absent`,
            data: {
                nfc_id,
                name,
                status: 'absent',
                marked_by: user.name
            }
        });

    } catch (error) {
        console.error('[ERROR] Mark absent error:', error.message);
        res.status(500).json({ error: 'Failed to mark student as absent' });
    }
});

/**
 * POST /api/notifications/bulk-absent
 * Mark all pending students as absent (for end-of-day processing)
 * Admin only
 */
router.post('/bulk-absent', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }

        const user = req.session?.user;
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { section } = req.body; // Optional: limit to specific section
        const today = getPhilippineDate();
        const now = new Date();

        // Get all students (optionally filtered by section)
        let studentQuery = {};
        if (section) {
            studentQuery.section = section;
        }

        const allStudents = await db.collection('students')
            .find(studentQuery)
            .toArray();

        // Get today's attendance
        const attendanceToday = await db.collection('attendance')
            .find({ date: { $regex: `^${today}` } })
            .project({ nfc_id: 1 })
            .toArray();

        const tappedIds = new Set(attendanceToday.map(a => String(a.nfc_id)));

        // Filter to pending students
        const pending = allStudents.filter(s => !tappedIds.has(String(s.nfc_id)));

        if (pending.length === 0) {
            return res.json({
                success: true,
                message: 'No pending students to mark',
                marked: 0
            });
        }

        // Create absent records for all pending
        const absentRecords = pending.map(student => ({
            nfc_id: String(student.nfc_id),
            tamtap_id: student.tamtap_id || '',
            name: student.name || `${student.first_name || ''} ${student.last_name || ''}`.trim(),
            section: student.section || '',
            grade: student.grade || '',
            date: today,
            time: null,
            session: null,
            status: 'absent',
            marked_by: 'system',
            marked_by_name: 'Auto-marked',
            marked_at: now,
            photo: null
        }));

        await db.collection('attendance').insertMany(absentRecords);

        res.json({
            success: true,
            message: `${absentRecords.length} students marked as absent`,
            marked: absentRecords.length
        });

    } catch (error) {
        console.error('[ERROR] Bulk absent error:', error.message);
        res.status(500).json({ error: 'Failed to mark students as absent' });
    }
});

module.exports = router;
