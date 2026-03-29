/**
 * TAMTAP v2.0 - Express.js API Server with Auth
 * TamTap NFC-Based Attendance System | FEU Roosevelt Marikina
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
const MongoStore = require('connect-mongo').default;
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const config = require('./config');
const logger = require('./utils/Logger');

// ========================================
// GLOBAL ERROR HANDLERS
// ========================================
// Prevent unhandled MongoDB auth errors from crashing the server
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection:', reason?.message || reason);
});

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

// Session middleware — lazy initialization
// The actual session handler is set up in startServer() after DB connection attempt.
// We use a proxy middleware so it's in the middleware chain BEFORE routes.
let sessionHandler = null;
app.use((req, res, next) => {
    if (sessionHandler) {
        return sessionHandler(req, res, next);
    }
    next(); // No session configured yet (during startup), skip
});

// Request logging
app.use((req, res, next) => {
    logger.api(`${req.method} ${req.url}`);
    next();
});

// ========================================
// MONGODB CONNECTION WITH FALLBACK
// ========================================
let db = null;
let mongoClient = null;
let dbSource = null;  // 'local' | 'cloud' | null
let reconnectTimer = null;

/**
 * Connect to a specific MongoDB URI.
 * Returns { client, db } on success, null on failure.
 */
async function connectToUri(uri, label) {
    let client = null;
    try {
        const maskedUri = uri.replace(/:[^:@]+@/, ':****@');
        logger.database(`Connecting to ${label} MongoDB: ${maskedUri}`);
        
        client = new MongoClient(uri, {
            ...config.mongodb.options,
            authSource: 'admin'
        });
        await client.connect();
        const database = client.db(config.mongodb.database);
        
        // Test connection
        await database.command({ ping: 1 });
        logger.success(`${label} MongoDB connected successfully`);
        
        return { client, db: database };
    } catch (error) {
        logger.warn(`${label} MongoDB connection failed: ${error.message}`);
        if (client) {
            try { await client.close(); } catch (_) { /* ignore */ }
        }
        return null;
    }
}

/**
 * Connect with fallback: Local MongoDB → Cloud MongoDB → No DB
 * Returns true if any database connected.
 */
async function connectWithFallback() {
    // Try local first (primary)
    const local = await connectToUri(config.mongodb.uri, 'Local');
    if (local) {
        mongoClient = local.client;
        db = local.db;
        dbSource = 'local';
        logger.success('Database source: LOCAL MongoDB (primary)');
        await createIndexes();
        return true;
    }
    
    // Try cloud fallback
    if (config.mongodb.remoteUri) {
        logger.warn('Local MongoDB failed. Switching to fallback cloud MongoDB...');
        const cloud = await connectToUri(config.mongodb.remoteUri, 'Cloud');
        if (cloud) {
            mongoClient = cloud.client;
            db = cloud.db;
            dbSource = 'cloud';
            logger.success('Database source: CLOUD MongoDB (fallback)');
            await createIndexes();
            return true;
        }
    }
    
    // No database available
    logger.warn('All MongoDB connections failed. Running WITHOUT database.');
    logger.warn('System will use JSON fallback only. Background reconnect active.');
    mongoClient = null;
    db = null;
    dbSource = null;
    return false;
}

/**
 * Background reconnect: periodically check if local MongoDB is back.
 * When it comes back, switch from cloud/none → local.
 */
function startBackgroundReconnect() {
    if (reconnectTimer) return;
    
    const interval = config.mongodb.reconnectIntervalMs;
    logger.info(`Background MongoDB reconnect started (every ${interval / 1000}s)`);
    
    reconnectTimer = setInterval(async () => {
        // If already on local, just verify it's still alive
        if (dbSource === 'local') {
            try {
                await db.command({ ping: 1 });
                return; // Still connected, nothing to do
            } catch (error) {
                logger.warn('Local MongoDB connection lost! Switching to fallback...');
                // Clean up dead connection
                try { await mongoClient.close(); } catch (_) { /* ignore */ }
                mongoClient = null;
                db = null;
                dbSource = null;
                
                // Try cloud as immediate fallback
                if (config.mongodb.remoteUri) {
                    const cloud = await connectToUri(config.mongodb.remoteUri, 'Cloud');
                    if (cloud) {
                        mongoClient = cloud.client;
                        db = cloud.db;
                        dbSource = 'cloud';
                        logger.success('Switched to CLOUD MongoDB (fallback)');
                        return;
                    }
                }
                
                logger.warn('No database available. Waiting for local MongoDB to return...');
                return;
            }
        }
        
        // If on cloud or no DB, try to reconnect to local
        const local = await connectToUri(config.mongodb.uri, 'Local');
        if (local) {
            // Close existing cloud connection if any
            if (mongoClient) {
                try { await mongoClient.close(); } catch (_) { /* ignore */ }
            }
            
            mongoClient = local.client;
            db = local.db;
            const previousSource = dbSource;
            dbSource = 'local';
            
            logger.success('='.repeat(50));
            logger.success('Local MongoDB is back online! Reconnected successfully.');
            logger.success(`Switched from ${previousSource || 'no database'} → LOCAL MongoDB`);
            logger.success('='.repeat(50));
            
            await createIndexes();
            return;
        }
        
        // If we have no DB at all, also try cloud
        if (!dbSource && config.mongodb.remoteUri) {
            const cloud = await connectToUri(config.mongodb.remoteUri, 'Cloud');
            if (cloud) {
                mongoClient = cloud.client;
                db = cloud.db;
                dbSource = 'cloud';
                logger.success('Cloud MongoDB reconnected (fallback)');
            }
        }
    }, interval);
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
        
        // Attendance indexes — unique prevents duplicate attendance per student per day
        // Drop old non-unique index if it exists before creating unique version
        try {
            await db.collection('attendance').dropIndex('nfc_id_1_date_1');
            logger.database('Dropped old attendance.nfc_id+date index (was non-unique)');
        } catch (e) {
            // Index may not exist or already unique, ignore
        }
        await db.collection('attendance').createIndex({ nfc_id: 1, date: 1 }, { unique: true });
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
        
        // Initialize tamtap_id counter if not exists
        const existingCounter = await db.collection('counters').findOne({ _id: 'tamtap_id' });
        if (!existingCounter) {
            // Seed from max existing tamtap_id across students and teachers
            const [maxStudent, maxTeacher] = await Promise.all([
                db.collection('students').find({}).sort({ tamtap_id: -1 }).limit(1).toArray(),
                db.collection('teachers').find({}).sort({ tamtap_id: -1 }).limit(1).toArray()
            ]);
            const maxStudentId = maxStudent.length > 0 ? (parseInt(maxStudent[0].tamtap_id) || 0) : 0;
            const maxTeacherId = maxTeacher.length > 0 ? (parseInt(maxTeacher[0].tamtap_id) || 0) : 0;
            const seedValue = Math.max(maxStudentId, maxTeacherId);
            await db.collection('counters').insertOne({ _id: 'tamtap_id', seq: seedValue });
            logger.info(`Initialized tamtap_id counter at ${seedValue}`);
        }
        
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

// Server-side guard: redirect non-admin users away from /admin
app.get('/admin', (req, res, next) => {
    if (!req.session || !req.session.user) {
        return res.redirect('/login');
    }
    if (req.session.user.role !== 'admin') {
        return res.redirect('/dashboard');
    }
    next();
});

// Serve frontend files (extensions: ['html'] enables clean URLs like /login → /login.html)
app.use(express.static(path.join(__dirname, 'public'), {
    extensions: ['html']
}));

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
const archiveRoutes = require('./routes/archive');
const { requireHardwareKey } = require('./middleware/hardwareAuth');

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
app.use('/api/archive', archiveRoutes);

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
        
        // Get recent attendance records with photos — project only needed fields
        const records = await db.collection('attendance')
            .find({ photo: { $exists: true, $nin: [null, ''] } })
            .project({ photo: 1, date: 1, time: 1 })
            .sort({ date: -1, time: -1 })
            .limit(limit)
            .toArray();
        
        const photos = records.map(r => {
            const dateOnly = r.date ? r.date.split(' ')[0] : '';
            return {
                url: `/photos/${dateOnly}/${r.photo}`,
                time: r.time || ''
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
 * Protected by hardware API key
 */
app.post('/api/hardware/attendance', requireHardwareKey, (req, res) => {
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
            status: record.status || 'present',
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
 * Protected by hardware API key
 */
app.post('/api/hardware/fail', requireHardwareKey, (req, res) => {
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
 * Protected by hardware API key
 */
app.post('/api/hardware/status', requireHardwareKey, (req, res) => {
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
        dbSource: dbSource,
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
    // API routes get JSON response
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Not found' });
    }
    // Everything else gets the 404 page
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// ========================================
// SERVER STARTUP
// ========================================
async function startServer() {
    logger.banner();
    
    // Connect to MongoDB with fallback chain: Local → Cloud → No DB
    const mongoConnected = await connectWithFallback();
    if (!mongoConnected) {
        logger.warn('Running without MongoDB - some features disabled');
    }
    
    // Setup session handler (applied via lazy proxy middleware declared earlier)
    if (db && dbSource) {
        // Use MongoDB-backed sessions
        const mongoStoreUri = dbSource === 'local' ? config.mongodb.uri : config.mongodb.remoteUri;
        sessionHandler = session({
            ...config.session,
            store: MongoStore.create({
                mongoUrl: mongoStoreUri,
                dbName: config.mongodb.database,
                ttl: Math.floor(config.session.cookie.maxAge / 1000),
                touchAfter: 3600,
                crypto: {
                    secret: config.session.secret
                }
            })
        });
        logger.info(`Session store: MongoDB (${dbSource})`);
    } else {
        // Fallback to MemoryStore (sessions lost on restart, but system works)
        sessionHandler = session({
            ...config.session
            // No store = default MemoryStore
        });
        logger.warn('Session store: MemoryStore (fallback — sessions lost on restart)');
    }
    
    // Start background reconnect loop
    startBackgroundReconnect();
    
    // Start HTTP server
    server.listen(config.server.port, config.server.host, () => {
        logger.server(`Server running on http://${config.server.host}:${config.server.port} or http://localhost:${config.server.port}`);
        logger.server(`Database source: ${dbSource || 'none (JSON fallback)'}`);
        logger.socket('Socket.IO ready for connections');
        logger.info(`Photos served from: ${internalPhotosPath}`);
    });
}

// Graceful shutdown
process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    
    // Stop background reconnect
    if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
    }
    
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
