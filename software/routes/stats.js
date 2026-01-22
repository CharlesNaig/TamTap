/**
 * TAMTAP Statistics Routes
 * GET /api/stats - Dashboard statistics
 * GET /api/stats/summary - Attendance summary with present/late/absent counts
 * GET /api/stats/daily - Daily attendance summary
 * GET /api/stats/weekly - Weekly attendance summary
 */

const express = require('express');
const router = express.Router();

/**
 * LATE THRESHOLD CONFIGURATION
 * Students arriving after this time are marked as late
 * Format: 24-hour (HH:MM)
 */
const LATE_THRESHOLD = {
    AM: '07:30',  // AM session: late if after 7:30 AM
    PM: '13:00'   // PM session: late if after 1:00 PM
};

/**
 * Helper: Check if a time is late based on session
 * @param {string} time - Time string (HH:MM or HH:MM:SS)
 * @param {string} session - 'AM' or 'PM'
 * @returns {boolean} True if late
 */
function isLate(time, session) {
    if (!time || !session) return false;
    
    // Normalize time to HH:MM
    const timeParts = time.split(':');
    if (timeParts.length < 2) return false;
    
    const timeMinutes = parseInt(timeParts[0]) * 60 + parseInt(timeParts[1]);
    const threshold = LATE_THRESHOLD[session] || LATE_THRESHOLD.AM;
    const thresholdParts = threshold.split(':');
    const thresholdMinutes = parseInt(thresholdParts[0]) * 60 + parseInt(thresholdParts[1]);
    
    return timeMinutes > thresholdMinutes;
}

// Import calendar helper for day status checks
let getDayStatus = null;
let DAY_STATUS = null;

// Lazy load to avoid circular dependency
function loadCalendarHelper() {
    if (!getDayStatus) {
        const calendar = require('./calendar');
        getDayStatus = calendar.getDayStatus;
        DAY_STATUS = calendar.DAY_STATUS;
    }
}

/**
 * GET /api/stats/summary
 * Get attendance summary with present/late/absent breakdown
 * Respects academic calendar (no absences on non-instructional days)
 * @query date - Date in YYYY-MM-DD format (default: today)
 * @query section - Optional: Filter by single section
 * @query sections - Optional: Filter by multiple sections (comma-separated)
 */
router.get('/summary', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        loadCalendarHelper();
        
        const dateParam = req.query.date || new Date().toISOString().split('T')[0];
        const section = req.query.section;
        const sections = req.query.sections;
        
        // Check calendar status for the date
        const calendarStatus = await getDayStatus(db, dateParam, section);
        
        // If not an instructional day, return special response
        if (!calendarStatus.isInstructional) {
            return res.json({
                success: true,
                date: dateParam,
                section: section || sections || 'all',
                isInstructional: false,
                calendarStatus: calendarStatus.status,
                calendarLabel: calendarStatus.label,
                calendarReason: calendarStatus.reason,
                stats: {
                    totalStudents: 0,
                    onTime: 0,
                    late: 0,
                    absent: 0,  // No absences on non-instructional days
                    present: 0,
                    attendanceRate: null  // N/A for non-instructional days
                },
                thresholds: LATE_THRESHOLD
            });
        }
        
        // Build student query for total count
        const studentQuery = {};
        if (section) {
            studentQuery.section = section;
        } else if (sections) {
            const sectionList = sections.split(',').map(s => s.trim()).filter(Boolean);
            if (sectionList.length > 0) {
                studentQuery.section = { $in: sectionList };
            }
        }
        
        // Get total students in scope
        const totalStudents = await db.collection('students').countDocuments(studentQuery);
        
        // Build attendance query
        const attendanceQuery = {
            date: { $regex: `^${dateParam}` }
        };
        
        if (section) {
            attendanceQuery.section = section;
        } else if (sections) {
            const sectionList = sections.split(',').map(s => s.trim()).filter(Boolean);
            if (sectionList.length > 0) {
                attendanceQuery.section = { $in: sectionList };
            }
        }
        
        // Fetch attendance records for the date
        const records = await db.collection('attendance')
            .find(attendanceQuery)
            .toArray();
        
        // Count present and late
        let onTime = 0;
        let late = 0;
        
        for (const record of records) {
            // Check if record has explicit status
            if (record.status === 'late') {
                late++;
            } else if (record.status === 'present') {
                onTime++;
            } else {
                // No explicit status - compute based on time threshold
                if (isLate(record.time, record.session)) {
                    late++;
                } else {
                    onTime++;
                }
            }
        }
        
        // Absent = total students - those who have attendance record
        const presentCount = onTime + late;
        const absent = Math.max(0, totalStudents - presentCount);
        
        // Calculate attendance rate
        const attendanceRate = totalStudents > 0
            ? Math.round((presentCount / totalStudents) * 100)
            : 0;
        
        res.json({
            success: true,
            date: dateParam,
            section: section || sections || 'all',
            isInstructional: true,
            calendarStatus: calendarStatus.status,
            calendarLabel: calendarStatus.label,
            stats: {
                totalStudents: totalStudents,
                onTime: onTime,
                late: late,
                absent: absent,
                present: presentCount,
                attendanceRate: attendanceRate
            },
            thresholds: LATE_THRESHOLD
        });
        
    } catch (error) {
        console.error('[ERROR] Get summary stats error:', error.message);
        res.status(500).json({ error: 'Failed to fetch summary statistics' });
    }
});

/**
 * GET /api/stats
 * Get dashboard statistics
 */
router.get('/', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const today = new Date().toISOString().split('T')[0];
        
        // Get counts
        const [studentCount, teacherCount, todayAttendance, totalAttendance] = await Promise.all([
            db.collection('students').countDocuments(),
            db.collection('teachers').countDocuments(),
            db.collection('attendance').countDocuments({
                date: { $regex: `^${today}` }
            }),
            db.collection('attendance').countDocuments()
        ]);
        
        // Get today's session breakdown
        const todayRecords = await db.collection('attendance')
            .find({ date: { $regex: `^${today}` } })
            .toArray();
        
        const amCount = todayRecords.filter(r => r.session === 'AM').length;
        const pmCount = todayRecords.filter(r => r.session === 'PM').length;
        
        // Get latest attendance records (last 5)
        const latestRecords = await db.collection('attendance')
            .find({})
            .sort({ date: -1 })
            .limit(5)
            .toArray();
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            stats: {
                students: studentCount,
                teachers: teacherCount,
                totalUsers: studentCount + teacherCount,
                todayAttendance: todayAttendance,
                todayAM: amCount,
                todayPM: pmCount,
                totalAttendance: totalAttendance,
                attendanceRate: studentCount > 0 
                    ? Math.round((todayAttendance / studentCount) * 100) 
                    : 0
            },
            latest: latestRecords.map(r => ({
                name: r.name,
                role: r.role,
                time: r.time,
                session: r.session
            }))
        });
        
    } catch (error) {
        console.error('[ERROR] Get stats error:', error.message);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

/**
 * GET /api/stats/daily
 * Get daily attendance summary for the last 7 days
 * Query params: 
 *   ?days=7 (number of days to fetch)
 *   ?section=11-A (single section filter)
 *   ?sections=11-A,11-B (multiple sections filter)
 */
router.get('/daily', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const days = parseInt(req.query.days) || 7;
        const section = req.query.section;
        const sections = req.query.sections;
        const dailyStats = [];
        
        for (let i = 0; i < days; i++) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            
            // Build query with optional section filter
            const query = { date: { $regex: `^${dateStr}` } };
            
            if (section) {
                query.section = section;
            } else if (sections) {
                const sectionList = sections.split(',').map(s => s.trim()).filter(Boolean);
                if (sectionList.length > 0) {
                    query.section = { $in: sectionList };
                }
            }
            
            const count = await db.collection('attendance').countDocuments(query);
            
            dailyStats.push({
                date: dateStr,
                day: date.toLocaleDateString('en-US', { weekday: 'short' }),
                count: count
            });
        }
        
        res.json({
            success: true,
            days: days,
            section: section || sections || 'all',
            data: dailyStats.reverse()  // Oldest first
        });
        
    } catch (error) {
        console.error('[ERROR] Get daily stats error:', error.message);
        res.status(500).json({ error: 'Failed to fetch daily statistics' });
    }
});

/**
 * GET /api/stats/sections
 * Get attendance breakdown by section for today
 */
router.get('/sections', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const today = new Date().toISOString().split('T')[0];
        
        // Get all sections from students
        const sections = await db.collection('students').distinct('section');
        
        const sectionStats = [];
        
        for (const section of sections) {
            if (!section) continue;
            
            // Count students in section
            const totalInSection = await db.collection('students').countDocuments({ section });
            
            // Count attendance today for this section
            const presentToday = await db.collection('attendance').countDocuments({
                date: { $regex: `^${today}` },
                section: section
            });
            
            sectionStats.push({
                section: section,
                total: totalInSection,
                present: presentToday,
                absent: totalInSection - presentToday,
                rate: totalInSection > 0 
                    ? Math.round((presentToday / totalInSection) * 100) 
                    : 0
            });
        }
        
        // Sort by section name
        sectionStats.sort((a, b) => a.section.localeCompare(b.section));
        
        res.json({
            success: true,
            date: today,
            data: sectionStats
        });
        
    } catch (error) {
        console.error('[ERROR] Get section stats error:', error.message);
        res.status(500).json({ error: 'Failed to fetch section statistics' });
    }
});

/**
 * GET /api/stats/grades
 * Get attendance breakdown by grade for today
 */
router.get('/grades', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const today = new Date().toISOString().split('T')[0];
        
        // Get all grades from students
        const grades = await db.collection('students').distinct('grade');
        
        const gradeStats = [];
        
        for (const grade of grades) {
            if (!grade) continue;
            
            // Count students in grade
            const totalInGrade = await db.collection('students').countDocuments({ grade });
            
            // Count attendance today for this grade
            const presentToday = await db.collection('attendance').countDocuments({
                date: { $regex: `^${today}` },
                grade: grade
            });
            
            gradeStats.push({
                grade: grade,
                total: totalInGrade,
                present: presentToday,
                absent: totalInGrade - presentToday,
                rate: totalInGrade > 0 
                    ? Math.round((presentToday / totalInGrade) * 100) 
                    : 0
            });
        }
        
        // Sort by grade
        gradeStats.sort((a, b) => a.grade.localeCompare(b.grade));
        
        res.json({
            success: true,
            date: today,
            data: gradeStats
        });
        
    } catch (error) {
        console.error('[ERROR] Get grade stats error:', error.message);
        res.status(500).json({ error: 'Failed to fetch grade statistics' });
    }
});

module.exports = router;
