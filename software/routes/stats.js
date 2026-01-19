/**
 * TAMTAP Statistics Routes
 * GET /api/stats - Dashboard statistics
 * GET /api/stats/daily - Daily attendance summary
 * GET /api/stats/weekly - Weekly attendance summary
 */

const express = require('express');
const router = express.Router();

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
 * Query params: ?days=7&section=11-A (optional)
 */
router.get('/daily', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const days = parseInt(req.query.days) || 7;
        const section = req.query.section;
        const dailyStats = [];
        
        for (let i = 0; i < days; i++) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            
            // Build query with optional section filter
            const query = { date: { $regex: `^${dateStr}` } };
            if (section) {
                query.section = section;
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
            section: section || 'all',
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
