/**
 * TAMTAP Academic Calendar Routes
 * Manages instructional days, suspensions, and no-class sessions
 * 
 * Priority Order:
 * 1. School-wide suspension (Admin)
 * 2. Section no-class declaration (Teacher)
 * 3. Weekend rules (Sat disabled by default, Sun always off)
 * 4. Normal instructional day (Mon-Fri)
 */

const express = require('express');
const router = express.Router();

// ========================================
// DAY STATUS TYPES
// ========================================
const DAY_STATUS = {
    INSTRUCTIONAL: 'instructional',
    SUSPENSION: 'suspension',
    NO_CLASS: 'no-class',
    WEEKEND: 'weekend',
    SATURDAY_MAKEUP: 'saturday-makeup'
};

// ========================================
// HELPER: Check if date is a weekend
// Returns: { isWeekend, day, isSaturday, isSunday }
// ========================================
function checkWeekend(dateStr) {
    const date = new Date(dateStr + 'T00:00:00');
    const day = date.getDay(); // 0 = Sunday, 6 = Saturday
    
    return {
        isWeekend: day === 0 || day === 6,
        day: day,
        dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day],
        isSaturday: day === 6,
        isSunday: day === 0
    };
}

// ========================================
// HELPER: Get day status for a date/section
// This is the core logic that determines if
// attendance should be recorded
// ========================================
async function getDayStatus(db, dateStr, section = null) {
    const weekend = checkWeekend(dateStr);
    
    // Priority 1: Check for school-wide suspension
    const suspension = await db.collection('calendar').findOne({
        type: 'suspension',
        $or: [
            { date: dateStr },
            { 
                startDate: { $lte: dateStr },
                endDate: { $gte: dateStr }
            }
        ]
    });
    
    if (suspension) {
        return {
            status: DAY_STATUS.SUSPENSION,
            isInstructional: false,
            label: 'School Suspended',
            reason: suspension.reason || 'School-wide suspension',
            record: suspension
        };
    }
    
    // Priority 2: Check for section-specific no-class
    if (section) {
        const noClass = await db.collection('calendar').findOne({
            type: 'no-class',
            date: dateStr,
            section: section
        });
        
        if (noClass) {
            return {
                status: DAY_STATUS.NO_CLASS,
                isInstructional: false,
                label: 'No Class Session',
                reason: noClass.reason || 'Class cancelled',
                section: section,
                record: noClass
            };
        }
    }
    
    // Priority 3: Weekend rules
    if (weekend.isSunday) {
        return {
            status: DAY_STATUS.WEEKEND,
            isInstructional: false,
            label: 'Sunday',
            reason: 'Sunday - No classes'
        };
    }
    
    if (weekend.isSaturday) {
        // Check if Saturday is enabled as make-up day
        const saturdayMakeup = await db.collection('calendar').findOne({
            type: 'saturday-makeup',
            date: dateStr
        });
        
        if (saturdayMakeup) {
            return {
                status: DAY_STATUS.SATURDAY_MAKEUP,
                isInstructional: true,
                label: 'Saturday Make-up Class',
                reason: saturdayMakeup.reason || 'Make-up class day',
                record: saturdayMakeup
            };
        }
        
        return {
            status: DAY_STATUS.WEEKEND,
            isInstructional: false,
            label: 'Saturday',
            reason: 'Saturday - No classes (not a make-up day)'
        };
    }
    
    // Priority 4: Normal instructional day (Mon-Fri)
    return {
        status: DAY_STATUS.INSTRUCTIONAL,
        isInstructional: true,
        label: 'Class Day',
        dayName: weekend.dayName
    };
}

// ========================================
// GET /api/calendar/status
// Check day status for a specific date
// @query date - YYYY-MM-DD (default: today)
// @query section - Optional section filter
// ========================================
router.get('/status', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const dateStr = req.query.date || new Date().toISOString().split('T')[0];
        const section = req.query.section || null;
        
        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
        }
        
        const status = await getDayStatus(db, dateStr, section);
        
        res.json({
            success: true,
            date: dateStr,
            section: section,
            ...status
        });
        
    } catch (error) {
        console.error('[ERROR] Get calendar status error:', error.message);
        res.status(500).json({ error: 'Failed to get calendar status' });
    }
});

// ========================================
// GET /api/calendar/suspensions
// List all suspensions (Admin only)
// @query from - Start date filter
// @query to - End date filter
// ========================================
router.get('/suspensions', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const { from, to } = req.query;
        const query = { type: 'suspension' };
        
        if (from && to) {
            query.$or = [
                { date: { $gte: from, $lte: to } },
                { startDate: { $lte: to }, endDate: { $gte: from } }
            ];
        }
        
        const suspensions = await db.collection('calendar')
            .find(query)
            .sort({ date: -1, startDate: -1 })
            .toArray();
        
        res.json({
            success: true,
            count: suspensions.length,
            suspensions: suspensions
        });
        
    } catch (error) {
        console.error('[ERROR] Get suspensions error:', error.message);
        res.status(500).json({ error: 'Failed to get suspensions' });
    }
});

// ========================================
// POST /api/calendar/suspension
// Create school-wide suspension (Admin only)
// @body date - Single date (YYYY-MM-DD)
// @body startDate - Range start (YYYY-MM-DD)
// @body endDate - Range end (YYYY-MM-DD)
// @body reason - Required reason
// ========================================
router.post('/suspension', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        // Check admin role
        if (!req.session?.user || req.session.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        const { date, startDate, endDate, reason } = req.body;
        
        if (!reason) {
            return res.status(400).json({ error: 'Reason is required' });
        }
        
        // Validate: either single date or date range
        if (!date && (!startDate || !endDate)) {
            return res.status(400).json({ error: 'Provide either date or startDate/endDate' });
        }
        
        const record = {
            type: 'suspension',
            reason: reason,
            createdBy: req.session.user.username,
            createdAt: new Date().toISOString()
        };
        
        if (date) {
            record.date = date;
        } else {
            record.startDate = startDate;
            record.endDate = endDate;
        }
        
        // Check for duplicates
        const existingQuery = date 
            ? { type: 'suspension', date: date }
            : { type: 'suspension', startDate: startDate, endDate: endDate };
        
        const existing = await db.collection('calendar').findOne(existingQuery);
        if (existing) {
            return res.status(409).json({ error: 'Suspension already exists for this date' });
        }
        
        const result = await db.collection('calendar').insertOne(record);
        
        console.log(`[INFO] Suspension created by ${req.session.user.username}: ${date || `${startDate} to ${endDate}`}`);
        
        res.json({
            success: true,
            message: 'Suspension created',
            id: result.insertedId,
            record: record
        });
        
    } catch (error) {
        console.error('[ERROR] Create suspension error:', error.message);
        res.status(500).json({ error: 'Failed to create suspension' });
    }
});

// ========================================
// DELETE /api/calendar/suspension/:id
// Remove suspension (Admin only)
// ========================================
router.delete('/suspension/:id', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        // Check admin role
        if (!req.session?.user || req.session.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        const { ObjectId } = require('mongodb');
        const id = req.params.id;
        
        let objectId;
        try {
            objectId = new ObjectId(id);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid ID format' });
        }
        
        const result = await db.collection('calendar').deleteOne({
            _id: objectId,
            type: 'suspension'
        });
        
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Suspension not found' });
        }
        
        console.log(`[INFO] Suspension ${id} deleted by ${req.session.user.username}`);
        
        res.json({
            success: true,
            message: 'Suspension removed'
        });
        
    } catch (error) {
        console.error('[ERROR] Delete suspension error:', error.message);
        res.status(500).json({ error: 'Failed to delete suspension' });
    }
});

// ========================================
// GET /api/calendar/no-class
// List no-class sessions
// @query section - Filter by section
// @query from - Start date filter
// @query to - End date filter
// ========================================
router.get('/no-class', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const { section, from, to } = req.query;
        const query = { type: 'no-class' };
        
        if (section) {
            query.section = section;
        }
        
        if (from && to) {
            query.date = { $gte: from, $lte: to };
        }
        
        const noClassSessions = await db.collection('calendar')
            .find(query)
            .sort({ date: -1 })
            .toArray();
        
        res.json({
            success: true,
            count: noClassSessions.length,
            sessions: noClassSessions
        });
        
    } catch (error) {
        console.error('[ERROR] Get no-class sessions error:', error.message);
        res.status(500).json({ error: 'Failed to get no-class sessions' });
    }
});

// ========================================
// POST /api/calendar/no-class
// Declare no-class session (Teacher only)
// @body date - Date (YYYY-MM-DD)
// @body section - Section (must be in teacher's sections_handled)
// @body reason - Required reason
// ========================================
router.post('/no-class', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        // Check teacher role
        if (!req.session?.user || !['teacher', 'admin'].includes(req.session.user.role)) {
            return res.status(403).json({ error: 'Teacher or Admin access required' });
        }
        
        const { date, section, reason } = req.body;
        
        if (!date || !section || !reason) {
            return res.status(400).json({ error: 'Date, section, and reason are required' });
        }
        
        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
        }
        
        // Check if teacher handles this section (admin can declare for any section)
        const user = req.session.user;
        if (user.role === 'teacher') {
            const sections = user.sections_handled || [];
            if (!sections.includes(section)) {
                return res.status(403).json({ 
                    error: 'You can only declare no-class for sections you handle',
                    yourSections: sections
                });
            }
        }
        
        // Check for duplicates
        const existing = await db.collection('calendar').findOne({
            type: 'no-class',
            date: date,
            section: section
        });
        
        if (existing) {
            return res.status(409).json({ error: 'No-class session already exists for this date and section' });
        }
        
        const record = {
            type: 'no-class',
            date: date,
            section: section,
            reason: reason,
            createdBy: user.username,
            createdAt: new Date().toISOString()
        };
        
        const result = await db.collection('calendar').insertOne(record);
        
        console.log(`[INFO] No-class declared by ${user.username}: ${section} on ${date}`);
        
        res.json({
            success: true,
            message: 'No-class session declared',
            id: result.insertedId,
            record: record
        });
        
    } catch (error) {
        console.error('[ERROR] Create no-class session error:', error.message);
        res.status(500).json({ error: 'Failed to create no-class session' });
    }
});

// ========================================
// DELETE /api/calendar/no-class/:id
// Remove no-class session (Teacher/Admin)
// ========================================
router.delete('/no-class/:id', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        // Check teacher/admin role
        if (!req.session?.user || !['teacher', 'admin'].includes(req.session.user.role)) {
            return res.status(403).json({ error: 'Teacher or Admin access required' });
        }
        
        const { ObjectId } = require('mongodb');
        const id = req.params.id;
        
        let objectId;
        try {
            objectId = new ObjectId(id);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid ID format' });
        }
        
        // Get the record first
        const record = await db.collection('calendar').findOne({
            _id: objectId,
            type: 'no-class'
        });
        
        if (!record) {
            return res.status(404).json({ error: 'No-class session not found' });
        }
        
        // Teachers can only delete their own declarations
        const user = req.session.user;
        if (user.role === 'teacher' && record.createdBy !== user.username) {
            return res.status(403).json({ error: 'You can only remove your own no-class declarations' });
        }
        
        await db.collection('calendar').deleteOne({ _id: objectId });
        
        console.log(`[INFO] No-class ${id} deleted by ${user.username}`);
        
        res.json({
            success: true,
            message: 'No-class session removed'
        });
        
    } catch (error) {
        console.error('[ERROR] Delete no-class session error:', error.message);
        res.status(500).json({ error: 'Failed to delete no-class session' });
    }
});

// ========================================
// GET /api/calendar/saturday-makeups
// List Saturday make-up days
// ========================================
router.get('/saturday-makeups', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const makeups = await db.collection('calendar')
            .find({ type: 'saturday-makeup' })
            .sort({ date: -1 })
            .toArray();
        
        res.json({
            success: true,
            count: makeups.length,
            makeups: makeups
        });
        
    } catch (error) {
        console.error('[ERROR] Get saturday makeups error:', error.message);
        res.status(500).json({ error: 'Failed to get saturday makeups' });
    }
});

// ========================================
// POST /api/calendar/saturday-makeup
// Enable Saturday as make-up day (Admin only)
// @body date - Saturday date (YYYY-MM-DD)
// @body reason - Optional reason
// ========================================
router.post('/saturday-makeup', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        // Check admin role
        if (!req.session?.user || req.session.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        const { date, reason } = req.body;
        
        if (!date) {
            return res.status(400).json({ error: 'Date is required' });
        }
        
        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
        }
        
        // Validate that it's actually a Saturday
        const weekend = checkWeekend(date);
        if (!weekend.isSaturday) {
            return res.status(400).json({ 
                error: 'Date must be a Saturday',
                provided: weekend.dayName
            });
        }
        
        // Check for duplicates
        const existing = await db.collection('calendar').findOne({
            type: 'saturday-makeup',
            date: date
        });
        
        if (existing) {
            return res.status(409).json({ error: 'Saturday make-up already exists for this date' });
        }
        
        const record = {
            type: 'saturday-makeup',
            date: date,
            reason: reason || 'Make-up class day',
            createdBy: req.session.user.username,
            createdAt: new Date().toISOString()
        };
        
        const result = await db.collection('calendar').insertOne(record);
        
        console.log(`[INFO] Saturday make-up enabled by ${req.session.user.username}: ${date}`);
        
        res.json({
            success: true,
            message: 'Saturday make-up day enabled',
            id: result.insertedId,
            record: record
        });
        
    } catch (error) {
        console.error('[ERROR] Create saturday makeup error:', error.message);
        res.status(500).json({ error: 'Failed to create saturday makeup' });
    }
});

// ========================================
// DELETE /api/calendar/saturday-makeup/:id
// Remove Saturday make-up day (Admin only)
// ========================================
router.delete('/saturday-makeup/:id', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        // Check admin role
        if (!req.session?.user || req.session.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        const { ObjectId } = require('mongodb');
        const id = req.params.id;
        
        let objectId;
        try {
            objectId = new ObjectId(id);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid ID format' });
        }
        
        const result = await db.collection('calendar').deleteOne({
            _id: objectId,
            type: 'saturday-makeup'
        });
        
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Saturday make-up not found' });
        }
        
        console.log(`[INFO] Saturday make-up ${id} deleted by ${req.session.user.username}`);
        
        res.json({
            success: true,
            message: 'Saturday make-up day removed'
        });
        
    } catch (error) {
        console.error('[ERROR] Delete saturday makeup error:', error.message);
        res.status(500).json({ error: 'Failed to delete saturday makeup' });
    }
});

// ========================================
// GET /api/calendar/range
// Get calendar status for a date range
// @query from - Start date (YYYY-MM-DD)
// @query to - End date (YYYY-MM-DD)
// @query section - Optional section filter
// ========================================
router.get('/range', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const { from, to, section } = req.query;
        
        if (!from || !to) {
            return res.status(400).json({ error: 'from and to dates are required' });
        }
        
        // Validate date formats
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
            return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
        }
        
        // Generate dates in range
        const dates = [];
        const current = new Date(from + 'T00:00:00');
        const end = new Date(to + 'T00:00:00');
        
        while (current <= end) {
            const dateStr = current.toISOString().split('T')[0];
            const status = await getDayStatus(db, dateStr, section);
            
            dates.push({
                date: dateStr,
                ...status
            });
            
            current.setDate(current.getDate() + 1);
        }
        
        // Count summary
        const summary = {
            total: dates.length,
            instructional: dates.filter(d => d.isInstructional).length,
            suspended: dates.filter(d => d.status === DAY_STATUS.SUSPENSION).length,
            noClass: dates.filter(d => d.status === DAY_STATUS.NO_CLASS).length,
            weekends: dates.filter(d => d.status === DAY_STATUS.WEEKEND).length,
            saturdayMakeups: dates.filter(d => d.status === DAY_STATUS.SATURDAY_MAKEUP).length
        };
        
        res.json({
            success: true,
            from: from,
            to: to,
            section: section || 'all',
            summary: summary,
            dates: dates
        });
        
    } catch (error) {
        console.error('[ERROR] Get calendar range error:', error.message);
        res.status(500).json({ error: 'Failed to get calendar range' });
    }
});

// Export router and helper function for use in other routes
module.exports = router;
module.exports.getDayStatus = getDayStatus;
module.exports.DAY_STATUS = DAY_STATUS;
