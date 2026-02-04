/**
 * TAMTAP v2.0 - Express.js API Server with Auth
 * NFC-Based Attendance System | FEU Roosevelt Marikina
 * 
 * Features:
 * - REST API for attendance and student data
 * - Socket.IO for real-time dashboard updates
 * - Session-based auth for admin/teacher login
 * - Static file serving for attendance photos
 * 
 * Contract: No public registration - admin creates all accounts
 */

const express = require('express');
const http = require('http');
const session = require('express-session');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const config = require('./config');
const logger = require('./utils/Logger');

// ========================================
// EXPRESS APP SETUP
// ========================================
const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware (before routes)
app.use(session(config.session));

// Request logging
app.use((req, res, next) => {
    logger.api(`${req.method} ${req.url}`);
    next();
});

// ========================================
// MONGODB CONNECTION
// ========================================
let db = null;
let mongoClient = null;

async function connectMongoDB() {
    try {
        logger.database('Connecting to MongoDB:', config.mongodb.uri.replace(/:[^:@]+@/, ':****@'));
        logger.database('Database name:', config.mongodb.database);
        
        mongoClient = new MongoClient(config.mongodb.uri, config.mongodb.options);
        await mongoClient.connect();
        db = mongoClient.db(config.mongodb.database);
        
        // Test connection
        await db.command({ ping: 1 });
        logger.success('MongoDB connected successfully');
        
        // Create indexes
        await createIndexes();
        
        return true;
    } catch (error) {
        logger.error('MongoDB connection failed:', error.message);
        return false;
    }
}

async function createIndexes() {
    try {
        // Student indexes - NFC ID is REQUIRED for students
        await db.collection('students').createIndex({ nfc_id: 1 }, { unique: true });
        await db.collection('students').createIndex({ tamtap_id: 1 });
        
        // Teacher indexes - NFC ID is OPTIONAL for teachers
        // Drop old non-sparse index if it exists (migration)
        try {
            await db.collection('teachers').dropIndex('nfc_id_1');
            logger.database('Dropped old teachers.nfc_id index');
        } catch (e) {
            // Index may not exist, ignore
        }
        
        // Use sparse index to allow multiple null values (teachers without NFC cards)
        await db.collection('teachers').createIndex(
            { nfc_id: 1 }, 
            { unique: true, sparse: true }  // sparse: ignores documents where nfc_id is null/missing
        );
        await db.collection('teachers').createIndex({ tamtap_id: 1 });
        await db.collection('teachers').createIndex({ username: 1 }, { unique: true });
        
        // Attendance indexes
        await db.collection('attendance').createIndex({ nfc_id: 1, date: 1 });
        await db.collection('attendance').createIndex({ date: -1 });
        
        // Calendar indexes (for academic calendar logic)
        await db.collection('calendar').createIndex({ type: 1, date: 1 });
        await db.collection('calendar').createIndex({ type: 1, startDate: 1, endDate: 1 });
        await db.collection('calendar').createIndex({ type: 1, section: 1, date: 1 });
        
        // Settings index (for admin settings like Saturday classes)
        await db.collection('settings').createIndex({ key: 1 }, { unique: true });
        
        // Schedules indexes (section schedules with adviser assignments)
        await db.collection('schedules').createIndex({ section: 1 }, { unique: true });
        await db.collection('schedules').createIndex({ adviser_id: 1 });
        
        // Clean up: Remove nfc_id field from teachers where it's null (prevents sparse index issues)
        await db.collection('teachers').updateMany(
            { nfc_id: null },
            { $unset: { nfc_id: "" } }
        );
        
        logger.success('MongoDB indexes created');
    } catch (error) {
        logger.warn('Index creation warning:', error.message);
    }
}

// Make db accessible to routes
app.use((req, res, next) => {
    req.db = db;
    req.io = io;
    next();
});

// ========================================
// SOCKET.IO SETUP
// ========================================
const io = new Server(server, config.socketio);

// Track connected clients
let connectedClients = 0;

io.on('connection', (socket) => {
    connectedClients++;
    logger.socket(`Client connected (${connectedClients} total)`);
    
    // Send current system status on connect
    socket.emit('system:status', {
        status: 'online',
        mongodb: db !== null,
        clients: connectedClients,
        timestamp: new Date().toISOString()
    });
    
    socket.on('disconnect', () => {
        connectedClients--;
        logger.socket(`Client disconnected (${connectedClients} total)`);
    });
});

// Setup live log streaming via Socket.IO
const { setupLogStreaming } = require('./routes/logs');
setupLogStreaming(io);

// Broadcast helper function
function broadcast(event, data) {
    io.emit(event, {
        ...data,
        timestamp: new Date().toISOString()
    });
}

// Make broadcast accessible
app.set('broadcast', broadcast);

// ========================================
// STATIC FILES
// ========================================

// Serve frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Serve assets (logos, icons, backgrounds)
const assetsPath = path.resolve(__dirname, '../assets');
app.use('/assets', express.static(assetsPath, {
    maxAge: 86400000  // 1 day cache
}));

// Serve attendance photos with fallback
// Priority: External SD (/mnt/tamtap_photos) → Internal (assets/attendance_photos)
const externalPhotosPath = '/mnt/tamtap_photos';
const internalPhotosPath = path.resolve(__dirname, config.photos.baseDir);

// Custom middleware for photo fallback
app.use('/photos', (req, res, next) => {
    const fs = require('fs');
    const requestedPath = req.path;
    
    // Try external storage first
    const externalFile = path.join(externalPhotosPath, requestedPath);
    if (fs.existsSync(externalFile)) {
        return res.sendFile(externalFile, {
            maxAge: config.photos.maxAge
        });
    }
    
    // Fallback to internal storage
    const internalFile = path.join(internalPhotosPath, requestedPath);
    if (fs.existsSync(internalFile)) {
        return res.sendFile(internalFile, {
            maxAge: config.photos.maxAge
        });
    }
    
    // Not found
    res.status(404).json({ error: 'Photo not found' });
});

// ========================================
// API ROUTES
// ========================================

// Import route modules
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const attendanceRoutes = require('./routes/attendance');
const studentsRoutes = require('./routes/students');
const statsRoutes = require('./routes/stats');
const calendarRoutes = require('./routes/calendar');
const exportRoutes = require('./routes/export');
const schedulesRoutes = require('./routes/schedules');
const notificationsRoutes = require('./routes/notifications');
const logsRoutes = require('./routes/logs');

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/teachers', studentsRoutes);  // Reuse for teachers
app.use('/api/stats', statsRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/schedules', schedulesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/logs', logsRoutes);

// ========================================
// DEBUG ENDPOINT (Remove in production)
// ========================================
app.get('/api/debug/attendance', async (req, res) => {
    try {
        if (!db) {
            return res.json({ error: 'Database not connected' });
        }
        
        const count = await db.collection('attendance').countDocuments();
        const latest = await db.collection('attendance')
            .find({})
            .sort({ date: -1 })
            .limit(5)
            .toArray();
        
        res.json({
            mongodb_connected: true,
            total_records: count,
            latest_5: latest
        });
    } catch (e) {
        res.json({ error: e.message });
    }
});

// ========================================
// PUBLIC GALLERY ENDPOINT (for Login Page)
// ========================================

/**
 * GET /api/gallery/recent
 * Returns recent attendance photos for login page display
 * Public endpoint - no authentication required
 */
app.get('/api/gallery/recent', async (req, res) => {
    try {
        if (!db) {
            return res.json({ success: true, photos: [] });
        }
        
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        
        // Get recent attendance records with photos
        const records = await db.collection('attendance')
            .find({ photo: { $exists: true, $ne: null, $ne: '' } })
            .sort({ date: -1, time: -1 })
            .limit(limit)
            .toArray();
        
        const photos = records.map(r => {
            const dateOnly = r.date ? r.date.split(' ')[0] : '';
            return {
                url: `/photos/${dateOnly}/${r.photo}`,
                name: r.name?.split(' ')[0] || 'Student',
                time: r.time || '',
                section: r.section || ''
            };
        });
        
        res.json({ success: true, photos });
        
    } catch (error) {
        logger.error('Gallery fetch error:', error.message);
        res.json({ success: true, photos: [] });
    }
});

// ========================================
// HARDWARE BRIDGE ENDPOINT
// ========================================

/**
 * POST /api/hardware/attendance
 * Called by tamtap.py when attendance is recorded
 * Broadcasts to all connected Socket.IO clients
 */
app.post('/api/hardware/attendance', (req, res) => {
    try {
        const record = req.body;
        
        if (!record || !record.nfc_id) {
            return res.status(400).json({ error: 'Invalid attendance record' });
        }
        
        logger.hardware('Attendance received:', record.name);
        
        // Broadcast to all connected clients
        broadcast('attendance:new', {
            nfc_id: record.nfc_id,
            tamtap_id: record.tamtap_id || '',
            name: record.name,
            role: record.role,
            date: record.date,
            time: record.time,
            session: record.session,
            photo: record.photo,
            grade: record.grade || '',
            section: record.section || ''
        });
        
        res.json({ success: true, message: 'Attendance broadcasted' });
        
    } catch (error) {
        logger.error('Hardware attendance error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/hardware/fail
 * Called by tamtap.py when attendance fails (no face detected or schedule declined)
 */
app.post('/api/hardware/fail', (req, res) => {
    try {
        const data = req.body;
        const reason = data.reason || 'unknown';
        
        // Map decline reasons to user-friendly messages
        const declineMessages = {
            'NO_CLASSES_TODAY': 'No classes scheduled today',
            'TOO_EARLY': 'Too early - classes haven\'t started',
            'CLASSES_ENDED': 'Classes have ended for today',
            'SCHEDULE_DECLINED': 'Tap declined by schedule',
            'NO_FACE_DETECTED': 'No face detected',
            'EYES_NOT_VISIBLE': 'Eyes not visible in photo',
            'FACE_PARTIALLY_VISIBLE': 'Face partially visible',
            'MULTIPLE_FACES_DETECTED': 'Multiple faces detected',
            'DETECTION_TIMEOUT': 'Face detection timed out'
        };
        
        const friendlyReason = declineMessages[reason] || reason;
        
        logger.hardware('Attendance failed:', friendlyReason);
        
        // Broadcast failure to clients with decline reason
        broadcast('attendance:fail', {
            nfc_id: data.nfc_id || '',
            name: data.name || '',
            reason: friendlyReason,
            decline_code: reason,
            timestamp: new Date().toISOString()
        });
        
        res.json({ success: true, message: 'Failure broadcasted' });
        
    } catch (error) {
        logger.error('Hardware fail error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/hardware/status
 * Called by tamtap.py for system status updates
 */
app.post('/api/hardware/status', (req, res) => {
    try {
        const status = req.body;
        
        // Broadcast system status
        broadcast('system:status', {
            hardware: status.state || 'unknown',
            mongodb: db !== null,
            clients: connectedClients,
            ...status
        });
        
        res.json({ success: true });
        
    } catch (error) {
        logger.error('Hardware status error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========================================
// HEALTH CHECK
// ========================================
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        mongodb: db !== null,
        clients: connectedClients,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// ========================================
// ERROR HANDLING
// ========================================
app.use((err, req, res, next) => {
    logger.error(err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// ========================================
// SERVER STARTUP
// ========================================
async function startServer() {
    logger.banner();
    
    // Connect to MongoDB
    const mongoConnected = await connectMongoDB();
    if (!mongoConnected) {
        logger.warn('Running without MongoDB - some features disabled');
    }
    
    // Start HTTP server
    server.listen(config.server.port, config.server.host, () => {
        logger.server(`Server running on http://${config.server.host}:${config.server.port} or http://localhost:${config.server.port}`);
        logger.socket('Socket.IO ready for connections');
        logger.info(`Photos served from: ${internalPhotosPath}`);
    });
}

// Graceful shutdown
process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    
    if (mongoClient) {
        await mongoClient.close();
        logger.database('MongoDB connection closed');
    }
    
    server.close(() => {
        logger.success('Server closed');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    process.emit('SIGINT');
});

// Start the server
startServer();
