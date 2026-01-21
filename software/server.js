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

// Request logging (INFO level)
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.url}`);
    next();
});

// ========================================
// MONGODB CONNECTION
// ========================================
let db = null;
let mongoClient = null;

async function connectMongoDB() {
    try {
        console.log('[INFO] Connecting to MongoDB:', config.mongodb.uri.replace(/:[^:@]+@/, ':****@'));
        console.log('[INFO] Database name:', config.mongodb.database);
        
        mongoClient = new MongoClient(config.mongodb.uri, config.mongodb.options);
        await mongoClient.connect();
        db = mongoClient.db(config.mongodb.database);
        
        // Test connection
        await db.command({ ping: 1 });
        console.log('[INFO] MongoDB connected successfully');
        
        // Create indexes
        await createIndexes();
        
        return true;
    } catch (error) {
        console.error('[ERROR] MongoDB connection failed:', error.message);
        return false;
    }
}

async function createIndexes() {
    try {
        // Student indexes
        await db.collection('students').createIndex({ nfc_id: 1 }, { unique: true });
        await db.collection('students').createIndex({ tamtap_id: 1 });
        
        // Teacher indexes
        await db.collection('teachers').createIndex({ nfc_id: 1 }, { unique: true });
        await db.collection('teachers').createIndex({ tamtap_id: 1 });
        
        // Attendance indexes
        await db.collection('attendance').createIndex({ nfc_id: 1, date: 1 });
        await db.collection('attendance').createIndex({ date: -1 });
        
        console.log('[INFO] MongoDB indexes created');
    } catch (error) {
        console.warn('[WARN] Index creation warning:', error.message);
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
    console.log(`[INFO] Client connected (${connectedClients} total)`);
    
    // Send current system status on connect
    socket.emit('system:status', {
        status: 'online',
        mongodb: db !== null,
        clients: connectedClients,
        timestamp: new Date().toISOString()
    });
    
    socket.on('disconnect', () => {
        connectedClients--;
        console.log(`[INFO] Client disconnected (${connectedClients} total)`);
    });
});

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

// Serve attendance photos
const photosPath = path.resolve(__dirname, config.photos.baseDir);
app.use('/photos', express.static(photosPath, {
    maxAge: config.photos.maxAge
}));

// ========================================
// API ROUTES
// ========================================

// Import route modules
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const attendanceRoutes = require('./routes/attendance');
const studentsRoutes = require('./routes/students');
const statsRoutes = require('./routes/stats');

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/teachers', studentsRoutes);  // Reuse for teachers
app.use('/api/stats', statsRoutes);

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
        
        console.log('[INFO] Hardware attendance received:', record.name);
        
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
        console.error('[ERROR] Hardware attendance error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/hardware/fail
 * Called by tamtap.py when attendance fails (no face detected)
 */
app.post('/api/hardware/fail', (req, res) => {
    try {
        const data = req.body;
        
        console.log('[INFO] Hardware attendance failed:', data.reason || 'unknown');
        
        // Broadcast failure to clients
        broadcast('attendance:fail', {
            nfc_id: data.nfc_id || '',
            reason: data.reason || 'Face detection failed',
            name: data.name || ''
        });
        
        res.json({ success: true, message: 'Failure broadcasted' });
        
    } catch (error) {
        console.error('[ERROR] Hardware fail error:', error.message);
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
        console.error('[ERROR] Hardware status error:', error.message);
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
    console.error('[ERROR]', err.message);
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
    console.log('========================================');
    console.log('  TAMTAP v2.0 - API Server with Auth');
    console.log('  NFC-Based Attendance System');
    console.log('========================================');
    
    // Connect to MongoDB
    const mongoConnected = await connectMongoDB();
    if (!mongoConnected) {
        console.warn('[WARN] Running without MongoDB - some features disabled');
    }
    
    // Start HTTP server
    server.listen(config.server.port, config.server.host, () => {
        console.log(`[INFO] Server running on http://${config.server.host}:${config.server.port}`);
        console.log(`[INFO] Socket.IO ready for connections`);
        console.log(`[INFO] Photos served from: ${photosPath}`);
        console.log('========================================');
    });
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n[INFO] Shutting down...');
    
    if (mongoClient) {
        await mongoClient.close();
        console.log('[INFO] MongoDB connection closed');
    }
    
    server.close(() => {
        console.log('[INFO] Server closed');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    process.emit('SIGINT');
});

// Start the server
startServer();
