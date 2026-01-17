/**
 * TAMTAP Configuration
 * Environment-based configuration for server and database
 */

const config = {
    // Server Configuration
    server: {
        port: process.env.PORT || 3000,
        host: process.env.HOST || '0.0.0.0'  // Listen on all interfaces for LAN access
    },

    // MongoDB Configuration
    mongodb: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
        database: process.env.MONGODB_DB || 'tamtap',
        options: {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000
        }
    },

    // Photo Configuration
    photos: {
        baseDir: process.env.PHOTO_DIR || '../assets/attendance_photos',
        maxAge: 86400000  // 1 day cache
    },

    // Socket.IO Configuration
    socketio: {
        cors: {
            origin: '*',  // Allow all origins for LAN
            methods: ['GET', 'POST']
        },
        pingTimeout: 60000,
        pingInterval: 25000
    },

    // API Configuration
    api: {
        rateLimit: {
            windowMs: 60000,  // 1 minute
            max: 100          // 100 requests per minute
        }
    }
};

module.exports = config;
