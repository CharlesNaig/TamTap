/**
 * TAMTAP Auth Routes
 * Login/Logout for admin and teacher accounts
 * 
 * POST /api/auth/login   - Login with username/password
 * POST /api/auth/logout  - Destroy session
 * GET  /api/auth/me      - Get current user info
 * 
 * Contract: No public registration - admin creates all accounts
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');

/**
 * POST /api/auth/login
 * Authenticate admin or teacher
 * Body: { username, password }
 */
router.post('/login', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ 
                success: false, 
                error: 'Database not available' 
            });
        }

        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Username and password required' 
            });
        }

        // Check admins collection first
        let user = await db.collection('admins').findOne({ username: username.toLowerCase() });
        let role = 'admin';

        // If not admin, check teachers
        if (!user) {
            user = await db.collection('teachers').findOne({ username: username.toLowerCase() });
            role = 'teacher';
        }

        if (!user) {
            console.log(`[WARN] Login failed: user not found - ${username}`);
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid username or password' 
            });
        }

        // Verify password
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            console.log(`[WARN] Login failed: invalid password - ${username}`);
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid username or password' 
            });
        }

        // Create session
        req.session.user = {
            id: user._id.toString(),
            username: user.username,
            name: user.name || user.username,
            role: role,
            sections_handled: user.sections_handled || []  // For teachers
        };

        console.log(`[INFO] Login successful: ${username} (${role})`);

        res.json({
            success: true,
            user: {
                username: user.username,
                name: user.name || user.username,
                role: role,
                sections_handled: user.sections_handled || []
            }
        });

    } catch (error) {
        console.error('[ERROR] Login error:', error.message);
        res.status(500).json({ 
            success: false, 
            error: 'Login failed' 
        });
    }
});

/**
 * POST /api/auth/logout
 * Destroy session
 */
router.post('/logout', (req, res) => {
    const username = req.session?.user?.username || 'unknown';
    
    req.session.destroy((err) => {
        if (err) {
            console.error('[ERROR] Logout error:', err.message);
            return res.status(500).json({ 
                success: false, 
                error: 'Logout failed' 
            });
        }
        
        console.log(`[INFO] Logout: ${username}`);
        res.json({ success: true });
    });
});

/**
 * GET /api/auth/me
 * Get current authenticated user info
 */
router.get('/me', requireAuth, (req, res) => {
    res.json({
        success: true,
        user: {
            username: req.user.username,
            name: req.user.name,
            role: req.user.role,
            sections_handled: req.user.sections_handled || []
        }
    });
});

module.exports = router;
