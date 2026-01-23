/**
 * TAMTAP Admin Routes
 * Admin-only endpoints for teacher and student registration
 * 
 * Contract: Only ADMIN can register teachers and students
 *           No self-registration allowed
 * 
 * POST /api/admin/teachers          - Register new teacher
 * PUT  /api/admin/teachers/:id      - Update teacher (sections)
 * DELETE /api/admin/teachers/:id    - Remove teacher
 * 
 * POST /api/admin/students          - Register new student
 * POST /api/admin/students/bulk     - Bulk register students (CSV)
 * PUT  /api/admin/students/:nfc_id  - Update student
 * DELETE /api/admin/students/:nfc_id - Remove student
 * 
 * GET  /api/admin/sections          - List all sections
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

const { requireAuth, requireAdmin } = require('../middleware/auth');

// All admin routes require admin role
router.use(requireAuth, requireAdmin);

// ========================================
// TEACHER MANAGEMENT
// ========================================

/**
 * GET /api/admin/teachers
 * List all teachers with their assigned sections
 */
router.get('/teachers', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ success: false, error: 'Database not available' });
        }

        const teachers = await db.collection('teachers')
            .find({})
            .project({ password: 0 })  // Exclude password
            .sort({ name: 1 })
            .toArray();

        res.json({
            success: true,
            count: teachers.length,
            data: teachers.map(t => ({
                id: t._id,
                username: t.username,
                name: t.name,
                email: t.email || '',
                sections_handled: t.sections_handled || [],
                created: t.created || ''
            }))
        });

    } catch (error) {
        console.error('[ERROR] Get teachers error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch teachers' });
    }
});

/**
 * POST /api/admin/teachers
 * Register new teacher account
 * Body: { username, password, name, email?, sections_handled? }
 */
router.post('/teachers', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ success: false, error: 'Database not available' });
        }

        const { username, password, name, email, sections_handled } = req.body;

        // Validation
        if (!username || !password || !name) {
            return res.status(400).json({ 
                success: false, 
                error: 'Username, password, and name are required' 
            });
        }

        if (password.length < 6) {
            return res.status(400).json({ 
                success: false, 
                error: 'Password must be at least 6 characters' 
            });
        }

        // Check if username exists
        const existing = await db.collection('teachers').findOne({ 
            username: username.toLowerCase() 
        });
        if (existing) {
            return res.status(409).json({ 
                success: false, 
                error: 'Username already exists' 
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert teacher
        const result = await db.collection('teachers').insertOne({
            username: username.toLowerCase(),
            password: hashedPassword,
            name: name,
            email: email || '',
            sections_handled: sections_handled || [],
            created: new Date().toISOString()
        });

        console.log(`[INFO] Teacher registered: ${username} by ${req.user.username}`);

        res.status(201).json({
            success: true,
            message: 'Teacher registered successfully',
            data: {
                id: result.insertedId,
                username: username.toLowerCase(),
                name: name,
                sections_handled: sections_handled || []
            }
        });

    } catch (error) {
        console.error('[ERROR] Register teacher error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to register teacher' });
    }
});

/**
 * PUT /api/admin/teachers/:id
 * Update teacher (name, email, sections, password)
 */
router.put('/teachers/:id', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ success: false, error: 'Database not available' });
        }

        const { ObjectId } = require('mongodb');
        const teacherId = req.params.id;
        const { name, email, sections_handled, password } = req.body;

        const updateData = {};
        if (name) updateData.name = name;
        if (email !== undefined) updateData.email = email;
        if (sections_handled) updateData.sections_handled = sections_handled;
        if (password && password.length >= 6) {
            updateData.password = await bcrypt.hash(password, 10);
        }

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ success: false, error: 'No update data provided' });
        }

        updateData.updated = new Date().toISOString();

        const result = await db.collection('teachers').updateOne(
            { _id: new ObjectId(teacherId) },
            { $set: updateData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, error: 'Teacher not found' });
        }

        console.log(`[INFO] Teacher updated: ${teacherId} by ${req.user.username}`);

        res.json({ success: true, message: 'Teacher updated successfully' });

    } catch (error) {
        console.error('[ERROR] Update teacher error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to update teacher' });
    }
});

/**
 * DELETE /api/admin/teachers/:id
 * Remove teacher account
 */
router.delete('/teachers/:id', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ success: false, error: 'Database not available' });
        }

        const { ObjectId } = require('mongodb');
        const teacherId = req.params.id;

        const result = await db.collection('teachers').deleteOne({
            _id: new ObjectId(teacherId)
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, error: 'Teacher not found' });
        }

        console.log(`[INFO] Teacher deleted: ${teacherId} by ${req.user.username}`);

        res.json({ success: true, message: 'Teacher deleted successfully' });

    } catch (error) {
        console.error('[ERROR] Delete teacher error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to delete teacher' });
    }
});

/**
 * POST /api/admin/teachers/:id/reset-password
 * Reset teacher password (Admin only)
 * 
 * Body options:
 *   { useDefault: true }                    - Set to default: tamtap@{firstname}
 *   { newPassword: "custompassword" }       - Set custom password
 *   { forceChange: true }                   - Force password change on next login
 * 
 * Returns: { success, message, defaultPassword? }
 */
router.post('/teachers/:id/reset-password', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ success: false, error: 'Database not available' });
        }

        const { ObjectId } = require('mongodb');
        const teacherId = req.params.id;
        const { useDefault, newPassword, forceChange } = req.body;

        // Find teacher first
        const teacher = await db.collection('teachers').findOne({
            _id: new ObjectId(teacherId)
        });

        if (!teacher) {
            return res.status(404).json({ success: false, error: 'Teacher not found' });
        }

        let passwordToSet;
        let isDefaultPassword = false;

        if (useDefault) {
            // Default password: tamtap@{firstname in lowercase}
            const firstName = teacher.name.split(' ')[0].toLowerCase();
            passwordToSet = `tamtap@${firstName}`;
            isDefaultPassword = true;
        } else if (newPassword) {
            if (newPassword.length < 6) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Password must be at least 6 characters' 
                });
            }
            passwordToSet = newPassword;
        } else {
            return res.status(400).json({ 
                success: false, 
                error: 'Provide useDefault:true or newPassword' 
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(passwordToSet, 10);

        // Update teacher
        const updateData = {
            password: hashedPassword,
            passwordResetAt: new Date().toISOString(),
            passwordResetBy: req.user.username
        };

        // Add force change flag if requested
        if (forceChange) {
            updateData.forcePasswordChange = true;
        }

        await db.collection('teachers').updateOne(
            { _id: new ObjectId(teacherId) },
            { $set: updateData }
        );

        // Log the action
        console.log(`[INFO] Password reset for teacher ${teacher.username} by ${req.user.username} (default: ${isDefaultPassword}, forceChange: ${!!forceChange})`);

        // Log to audit collection
        await db.collection('audit_log').insertOne({
            action: 'password_reset',
            targetType: 'teacher',
            targetId: teacherId,
            targetUsername: teacher.username,
            performedBy: req.user.username,
            isDefaultPassword: isDefaultPassword,
            forceChange: !!forceChange,
            timestamp: new Date().toISOString()
        });

        const response = {
            success: true,
            message: `Password reset for ${teacher.name}`,
            forceChange: !!forceChange
        };

        // Only include the default password in response if it was used
        // (so admin can tell the teacher)
        if (isDefaultPassword) {
            response.defaultPassword = passwordToSet;
        }

        res.json(response);

    } catch (error) {
        console.error('[ERROR] Reset password error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to reset password' });
    }
});

// ========================================
// STUDENT MANAGEMENT
// ========================================

/**
 * GET /api/admin/students
 * List all students
 */
router.get('/students', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ success: false, error: 'Database not available' });
        }

        const { section, grade } = req.query;
        const filter = {};
        if (section) filter.section = section;
        if (grade) filter.grade = grade;

        const students = await db.collection('students')
            .find(filter)
            .sort({ section: 1, name: 1 })
            .toArray();

        res.json({
            success: true,
            count: students.length,
            data: students.map(s => ({
                nfc_id: s.nfc_id,
                tamtap_id: s.tamtap_id || '',
                name: s.name || `${s.first_name || ''} ${s.last_name || ''}`.trim(),
                first_name: s.first_name || '',
                last_name: s.last_name || '',
                grade: s.grade || '',
                section: s.section || '',
                registered: s.registered || ''
            }))
        });

    } catch (error) {
        console.error('[ERROR] Get students error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch students' });
    }
});

/**
 * POST /api/admin/students
 * Register new student
 * Body: { nfc_id, name, grade, section, first_name?, last_name? }
 */
router.post('/students', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ success: false, error: 'Database not available' });
        }

        const { nfc_id, name, first_name, last_name, grade, section } = req.body;

        // Validation
        if (!nfc_id || !section) {
            return res.status(400).json({ 
                success: false, 
                error: 'NFC ID and section are required' 
            });
        }

        // Check if NFC ID exists
        const existing = await db.collection('students').findOne({ nfc_id: nfc_id });
        if (existing) {
            return res.status(409).json({ 
                success: false, 
                error: 'NFC ID already registered' 
            });
        }

        // Generate tamtap_id
        const lastStudent = await db.collection('students')
            .find({})
            .sort({ tamtap_id: -1 })
            .limit(1)
            .toArray();
        
        const nextId = lastStudent.length > 0 
            ? (parseInt(lastStudent[0].tamtap_id) || 0) + 1 
            : 1;
        const tamtap_id = String(nextId).padStart(3, '0');

        // Build student name
        const studentName = name || `${first_name || ''} ${last_name || ''}`.trim();

        // Insert student
        const result = await db.collection('students').insertOne({
            nfc_id: nfc_id,
            tamtap_id: tamtap_id,
            name: studentName,
            first_name: first_name || '',
            last_name: last_name || '',
            grade: grade || '',
            section: section,
            registered: new Date().toISOString()
        });

        console.log(`[INFO] Student registered: ${tamtap_id} - ${studentName} by ${req.user.username}`);

        res.status(201).json({
            success: true,
            message: 'Student registered successfully',
            data: {
                nfc_id: nfc_id,
                tamtap_id: tamtap_id,
                name: studentName,
                section: section
            }
        });

    } catch (error) {
        console.error('[ERROR] Register student error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to register student' });
    }
});

/**
 * POST /api/admin/students/bulk
 * Bulk register students from array
 * Body: { students: [{ nfc_id, name, grade, section }, ...] }
 */
router.post('/students/bulk', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ success: false, error: 'Database not available' });
        }

        const { students } = req.body;

        if (!students || !Array.isArray(students) || students.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Students array required' 
            });
        }

        // Get starting tamtap_id
        const lastStudent = await db.collection('students')
            .find({})
            .sort({ tamtap_id: -1 })
            .limit(1)
            .toArray();
        
        let nextId = lastStudent.length > 0 
            ? (parseInt(lastStudent[0].tamtap_id) || 0) + 1 
            : 1;

        const results = { success: 0, failed: 0, errors: [] };

        for (const student of students) {
            try {
                if (!student.nfc_id || !student.section) {
                    results.failed++;
                    results.errors.push(`Missing nfc_id or section for: ${student.name || 'unknown'}`);
                    continue;
                }

                // Check duplicate
                const existing = await db.collection('students').findOne({ nfc_id: student.nfc_id });
                if (existing) {
                    results.failed++;
                    results.errors.push(`NFC ID already exists: ${student.nfc_id}`);
                    continue;
                }

                const tamtap_id = String(nextId++).padStart(3, '0');
                const studentName = student.name || `${student.first_name || ''} ${student.last_name || ''}`.trim();

                await db.collection('students').insertOne({
                    nfc_id: student.nfc_id,
                    tamtap_id: tamtap_id,
                    name: studentName,
                    first_name: student.first_name || '',
                    last_name: student.last_name || '',
                    grade: student.grade || '',
                    section: student.section,
                    registered: new Date().toISOString()
                });

                results.success++;

            } catch (e) {
                results.failed++;
                results.errors.push(`Failed to insert: ${student.nfc_id} - ${e.message}`);
            }
        }

        console.log(`[INFO] Bulk import: ${results.success} success, ${results.failed} failed by ${req.user.username}`);

        res.json({
            success: true,
            message: `Imported ${results.success} students, ${results.failed} failed`,
            results: results
        });

    } catch (error) {
        console.error('[ERROR] Bulk register error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to bulk register students' });
    }
});

/**
 * PUT /api/admin/students/:nfc_id
 * Update student
 */
router.put('/students/:nfc_id', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ success: false, error: 'Database not available' });
        }

        const nfcId = req.params.nfc_id;
        const { name, first_name, last_name, grade, section } = req.body;

        const updateData = {};
        if (name) updateData.name = name;
        if (first_name !== undefined) updateData.first_name = first_name;
        if (last_name !== undefined) updateData.last_name = last_name;
        if (grade !== undefined) updateData.grade = grade;
        if (section) updateData.section = section;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ success: false, error: 'No update data provided' });
        }

        updateData.updated = new Date().toISOString();

        const result = await db.collection('students').updateOne(
            { nfc_id: nfcId },
            { $set: updateData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, error: 'Student not found' });
        }

        console.log(`[INFO] Student updated: ${nfcId} by ${req.user.username}`);

        res.json({ success: true, message: 'Student updated successfully' });

    } catch (error) {
        console.error('[ERROR] Update student error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to update student' });
    }
});

/**
 * DELETE /api/admin/students/:nfc_id
 * Remove student
 */
router.delete('/students/:nfc_id', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ success: false, error: 'Database not available' });
        }

        const nfcId = req.params.nfc_id;

        const result = await db.collection('students').deleteOne({ nfc_id: nfcId });

        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, error: 'Student not found' });
        }

        console.log(`[INFO] Student deleted: ${nfcId} by ${req.user.username}`);

        res.json({ success: true, message: 'Student deleted successfully' });

    } catch (error) {
        console.error('[ERROR] Delete student error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to delete student' });
    }
});

// ========================================
// SECTIONS
// ========================================

/**
 * GET /api/admin/sections
 * List all unique sections from students
 */
router.get('/sections', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ success: false, error: 'Database not available' });
        }

        const sections = await db.collection('students').distinct('section');

        // Get student count per section
        const sectionStats = [];
        for (const section of sections) {
            if (!section) continue;
            const count = await db.collection('students').countDocuments({ section });
            sectionStats.push({ name: section, studentCount: count });
        }

        res.json({
            success: true,
            count: sectionStats.length,
            data: sectionStats.sort((a, b) => a.name.localeCompare(b.name))
        });

    } catch (error) {
        console.error('[ERROR] Get sections error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch sections' });
    }
});

// ========================================
// SYSTEM SETTINGS
// ========================================

/**
 * GET /api/admin/settings
 * Get all system settings
 */
router.get('/settings', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ success: false, error: 'Database not available' });
        }

        const settings = await db.collection('settings').find({}).toArray();
        
        // Convert to key-value object
        const settingsObj = {};
        settings.forEach(s => {
            settingsObj[s.key] = s.value;
        });

        // Ensure defaults exist
        if (settingsObj.saturdayClassesEnabled === undefined) {
            settingsObj.saturdayClassesEnabled = false;
        }

        res.json({
            success: true,
            data: settingsObj
        });

    } catch (error) {
        console.error('[ERROR] Get settings error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch settings' });
    }
});

/**
 * GET /api/admin/settings/:key
 * Get a specific setting
 */
router.get('/settings/:key', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ success: false, error: 'Database not available' });
        }

        const setting = await db.collection('settings').findOne({ key: req.params.key });
        
        if (!setting) {
            // Return default values for known settings
            const defaults = {
                saturdayClassesEnabled: false,
                lateThresholdMinutes: 15,
                attendanceStartTime: '07:00',
                attendanceEndTime: '17:00'
            };
            
            if (defaults.hasOwnProperty(req.params.key)) {
                return res.json({
                    success: true,
                    data: { key: req.params.key, value: defaults[req.params.key] }
                });
            }
            
            return res.status(404).json({ success: false, error: 'Setting not found' });
        }

        res.json({
            success: true,
            data: setting
        });

    } catch (error) {
        console.error('[ERROR] Get setting error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch setting' });
    }
});

/**
 * PUT /api/admin/settings/:key
 * Update a system setting
 * Body: { value: any }
 */
router.put('/settings/:key', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ success: false, error: 'Database not available' });
        }

        const { key } = req.params;
        const { value } = req.body;

        if (value === undefined) {
            return res.status(400).json({ success: false, error: 'Value is required' });
        }

        // Whitelist of allowed settings
        const allowedSettings = [
            'saturdayClassesEnabled',
            'lateThresholdMinutes',
            'attendanceStartTime',
            'attendanceEndTime'
        ];

        if (!allowedSettings.includes(key)) {
            return res.status(400).json({ success: false, error: 'Invalid setting key' });
        }

        // Upsert the setting
        await db.collection('settings').updateOne(
            { key: key },
            { 
                $set: { 
                    key: key,
                    value: value,
                    updatedBy: req.user.username,
                    updatedAt: new Date().toISOString()
                }
            },
            { upsert: true }
        );

        console.log(`[INFO] Setting ${key} updated to ${value} by ${req.user.username}`);

        // Log to audit
        await db.collection('audit_log').insertOne({
            action: 'setting_change',
            key: key,
            value: value,
            performedBy: req.user.username,
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            message: `Setting '${key}' updated successfully`,
            data: { key, value }
        });

    } catch (error) {
        console.error('[ERROR] Update setting error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to update setting' });
    }
});

/**
 * POST /api/admin/settings/saturday-toggle
 * Toggle Saturday classes (convenience endpoint)
 */
router.post('/settings/saturday-toggle', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ success: false, error: 'Database not available' });
        }

        // Get current value
        const setting = await db.collection('settings').findOne({ key: 'saturdayClassesEnabled' });
        const currentValue = setting ? setting.value : false;
        const newValue = !currentValue;

        // Update
        await db.collection('settings').updateOne(
            { key: 'saturdayClassesEnabled' },
            { 
                $set: { 
                    key: 'saturdayClassesEnabled',
                    value: newValue,
                    updatedBy: req.user.username,
                    updatedAt: new Date().toISOString()
                }
            },
            { upsert: true }
        );

        console.log(`[INFO] Saturday classes ${newValue ? 'ENABLED' : 'DISABLED'} by ${req.user.username}`);

        // Log to audit
        await db.collection('audit_log').insertOne({
            action: 'saturday_toggle',
            value: newValue,
            performedBy: req.user.username,
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            message: `Saturday classes ${newValue ? 'enabled' : 'disabled'}`,
            saturdayClassesEnabled: newValue
        });

    } catch (error) {
        console.error('[ERROR] Toggle Saturday error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to toggle Saturday classes' });
    }
});

module.exports = router;
