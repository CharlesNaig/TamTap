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
 * DEFAULT LATE THRESHOLD CONFIGURATION (fallback if no section schedule)
 * Students arriving after this time are marked as late
 * Format: 24-hour (HH:MM)
 */
const DEFAULT_LATE_THRESHOLD = {
    AM: '07:30',  // AM session: late if after 7:30 AM
    PM: '13:00'   // PM session: late if after 1:00 PM
};

const DEFAULT_GRACE_PERIOD = 20;      // Minutes after scheduled start = Late
const DEFAULT_ABSENT_THRESHOLD = 60;  // Minutes after scheduled start = Absent

/**
 * Get day name from date string
 */
function getDayName(dateStr) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const date = new Date(dateStr + 'T00:00:00');
    return days[date.getDay()];
}

/**
 * Convert time string (HH:MM or HH:MM:SS) to minutes since midnight
 */
function timeToMinutes(time) {
    if (!time) return null;
    const parts = time.split(':');
    if (parts.length < 2) return null;
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

/**
 * Helper: Determine attendance status based on arrival time and section schedule
 * @param {string} arrivalTime - Time string (HH:MM or HH:MM:SS)
 * @param {string} session - 'AM' or 'PM'
 * @param {Object} sectionSchedule - Section schedule object (or null for default)
 * @param {string} dayName - Day of week (monday, tuesday, etc.)
 * @returns {string} 'present', 'late', or 'absent'
 */
function getAttendanceStatus(arrivalTime, session, sectionSchedule, dayName) {
    if (!arrivalTime) return 'absent';
    
    const arrivalMinutes = timeToMinutes(arrivalTime);
    if (arrivalMinutes === null) return 'present';  // Fallback if can't parse
    
    // Get scheduled start time
    let scheduledStart = null;
    let gracePeriod = DEFAULT_GRACE_PERIOD;
    let absentThreshold = DEFAULT_ABSENT_THRESHOLD;
    
    if (sectionSchedule && sectionSchedule.weekly_schedule && sectionSchedule.weekly_schedule[dayName]) {
        const daySchedule = sectionSchedule.weekly_schedule[dayName];
        scheduledStart = timeToMinutes(daySchedule.start);
        gracePeriod = sectionSchedule.grace_period_minutes || DEFAULT_GRACE_PERIOD;
        absentThreshold = sectionSchedule.absent_threshold_minutes || DEFAULT_ABSENT_THRESHOLD;
    } else {
        // Fallback to default thresholds
        const threshold = DEFAULT_LATE_THRESHOLD[session] || DEFAULT_LATE_THRESHOLD.AM;
        scheduledStart = timeToMinutes(threshold);
    }
    
    if (scheduledStart === null) {
        // Can't determine schedule, use session-based fallback
        const threshold = DEFAULT_LATE_THRESHOLD[session] || DEFAULT_LATE_THRESHOLD.AM;
        scheduledStart = timeToMinutes(threshold);
    }
    
    // Calculate lateness
    const lateBy = arrivalMinutes - scheduledStart;
    
    if (lateBy <= 0) {
        return 'present';  // On time or early
    } else if (lateBy <= gracePeriod) {
        return 'late';     // Within grace period = Late
    } else if (lateBy > absentThreshold) {
        return 'absent';   // Beyond absent threshold
    } else {
        return 'late';     // Between grace and absent threshold = still Late
    }
}

/**
 * Legacy helper for backward compatibility
 */
function isLate(time, session) {
    const status = getAttendanceStatus(time, session, null, null);
    return status === 'late';
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
                    excused: 0,
                    absent: 0,  // No absences on non-instructional days
                    present: 0,
                    attendanceRate: null  // N/A for non-instructional days
                },
                thresholds: DEFAULT_LATE_THRESHOLD
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
        
        // Fetch section schedules for proper late/absent calculation
        const dayName = getDayName(dateParam);
        const sectionSchedules = {};
        
        const allSchedules = await db.collection('schedules').find({}).toArray();
        for (const sched of allSchedules) {
            sectionSchedules[sched.section] = sched;
        }
        
        // Count by status
        let onTime = 0;
        let late = 0;
        let excused = 0;
        let markedAbsent = 0;  // Explicitly marked as absent
        
        for (const record of records) {
            // Check if record has explicit status
            if (record.status === 'excused') {
                excused++;
            } else if (record.status === 'absent') {
                markedAbsent++;
            } else if (record.status === 'late') {
                late++;
            } else if (record.status === 'present') {
                onTime++;
            } else {
                // No explicit status - compute based on section schedule
                const sectionSched = sectionSchedules[record.section] || null;
                const computedStatus = getAttendanceStatus(record.time, record.session, sectionSched, dayName);
                
                if (computedStatus === 'late') {
                    late++;
                } else if (computedStatus === 'absent') {
                    markedAbsent++;
                } else {
                    onTime++;
                }
            }
        }
        
        // Absent = total students - (on time + late + excused + marked absent)
        const accountedFor = onTime + late + excused + markedAbsent;
        const notTapped = Math.max(0, totalStudents - accountedFor);
        const totalAbsent = markedAbsent + notTapped;  // Include both marked and not-tapped
        
        // Present = on time + late (not excused, not absent)
        const presentCount = onTime + late;
        
        // Calculate attendance rate (present / total)
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
                excused: excused,
                absent: totalAbsent,
                present: presentCount,
                attendanceRate: attendanceRate
            },
            thresholds: DEFAULT_LATE_THRESHOLD,
            graceMinutes: DEFAULT_GRACE_PERIOD,
            absentMinutes: DEFAULT_ABSENT_THRESHOLD
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
