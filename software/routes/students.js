/**
 * TAMTAP Students/Teachers Routes
 * GET /api/students - All students
 * GET /api/teachers - All teachers
 * GET /api/students/:nfc_id - Single student
 */

const express = require('express');
const router = express.Router();

/**
 * Determine collection based on route path
 */
function getCollection(req) {
    return req.baseUrl.includes('teachers') ? 'teachers' : 'students';
}

/**
 * GET /api/students or /api/teachers
 * Get all users of that type
 */
router.get('/', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const collection = getCollection(req);
        
        const users = await db.collection(collection)
            .find({})
            .sort({ tamtap_id: 1 })
            .toArray();
        
        res.json({
            success: true,
            type: collection,
            count: users.length,
            data: users.map(u => ({
                nfc_id: u.nfc_id,
                tamtap_id: u.tamtap_id || '',
                name: u.name || `${u.first_name || ''} ${u.last_name || ''}`.trim(),
                first_name: u.first_name || '',
                last_name: u.last_name || '',
                email: u.email || '',
                grade: u.grade || '',
                section: u.section || '',
                registered: u.registered || ''
            }))
        });
        
    } catch (error) {
        console.error('[ERROR] Get users error:', error.message);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

/**
 * GET /api/students/:nfc_id or /api/teachers/:nfc_id
 * Get single user by NFC ID
 */
router.get('/:nfc_id', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const collection = getCollection(req);
        const nfcId = req.params.nfc_id;
        
        const user = await db.collection(collection).findOne({ nfc_id: nfcId });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({
            success: true,
            type: collection.slice(0, -1),  // Remove 's' for singular
            data: {
                nfc_id: user.nfc_id,
                tamtap_id: user.tamtap_id || '',
                name: user.name || `${user.first_name || ''} ${user.last_name || ''}`.trim(),
                first_name: user.first_name || '',
                last_name: user.last_name || '',
                email: user.email || '',
                grade: user.grade || '',
                section: user.section || '',
                registered: user.registered || ''
            }
        });
        
    } catch (error) {
        console.error('[ERROR] Get user error:', error.message);
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

/**
 * GET /api/students/grade/:grade
 * Get students by grade
 */
router.get('/grade/:grade', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const grade = req.params.grade;
        
        const students = await db.collection('students')
            .find({ grade: grade })
            .sort({ section: 1, name: 1 })
            .toArray();
        
        res.json({
            success: true,
            grade: grade,
            count: students.length,
            data: students.map(u => ({
                nfc_id: u.nfc_id,
                tamtap_id: u.tamtap_id || '',
                name: u.name || `${u.first_name || ''} ${u.last_name || ''}`.trim(),
                section: u.section || '',
                email: u.email || ''
            }))
        });
        
    } catch (error) {
        console.error('[ERROR] Get students by grade error:', error.message);
        res.status(500).json({ error: 'Failed to fetch students' });
    }
});

/**
 * GET /api/students/section/:section
 * Get students by section (supports comma-separated list)
 */
router.get('/section/:section', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const sectionParam = decodeURIComponent(req.params.section);
        
        // Support comma-separated sections for teachers with multiple sections
        const sectionList = sectionParam.split(',').map(s => s.trim()).filter(Boolean);
        
        let query = {};
        if (sectionList.length === 1) {
            query = { section: sectionList[0] };
        } else if (sectionList.length > 1) {
            query = { section: { $in: sectionList } };
        }
        
        const students = await db.collection('students')
            .find(query)
            .sort({ section: 1, name: 1 })
            .toArray();
        
        res.json({
            success: true,
            section: sectionParam,
            count: students.length,
            data: students.map(u => ({
                nfc_id: u.nfc_id,
                tamtap_id: u.tamtap_id || '',
                name: u.name || `${u.first_name || ''} ${u.last_name || ''}`.trim(),
                grade: u.grade || '',
                section: u.section || '',
                email: u.email || ''
            }))
        });
        
    } catch (error) {
        console.error('[ERROR] Get students by section error:', error.message);
        res.status(500).json({ error: 'Failed to fetch students' });
    }
});

module.exports = router;
