/**
 * TAMTAP Configuration
 * Environment-based configuration for server and database
 */

require('dotenv').config({ path: '../.env' });

const config = {
    // Server Configuration
    server: {
        port: parseInt(process.env.API_SERVER_PORT) || 3000,
        host: process.env.API_SERVER_HOST || '0.0.0.0'
    },

    // MongoDB Configuration
    mongodb: {
        uri: process.env.MONGODB_URI,
        database: process.env.MONGODB_NAME,
        options: {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000
        }
    },

    // Session Configuration (for login)
    session: {
        secret: process.env.SESSION_SECRET || 'tamtap-local-secret-change-in-production',
        name: 'tamtap.sid',
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: false,  // Set true if using HTTPS
            maxAge: 8 * 60 * 60 * 1000  // 8 hours
        }
    },

    // Photo Configuration
    photos: {
        baseDir: '../assets/attendance_photos',
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

module.exports = config;module.exports = config;
