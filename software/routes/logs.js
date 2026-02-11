/**
 * TAMTAP v2.0 - System Logs Route
 * Live log streaming for systemd services on Raspberry Pi
 * 
 * Services:
 * - tamtap-buttons: GPIO button listener
 * - tamtap-server: Node.js backend
 * - tamtap.service: Hardware NFC/camera service (if exists)
 */

const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const logger = require('../utils/Logger');

// Service identifiers matching SyslogIdentifier in .service files
const SERVICES = {
    'buttons': 'tamtap-buttons',
    'server': 'tamtap-server', 
    'hardware': 'tamtap'  // Main hardware service
};

// Store active log streams per socket
const activeStreams = new Map();

/**
 * GET /api/logs/health
 * Quick check: is journalctl available and can we read each service?
 * Returns per-service reachability so the admin console can show status.
 */
router.get('/health', requireAuth, requireAdmin, async (req, res) => {
    try {
        const results = {};

        for (const [key, syslogId] of Object.entries(SERVICES)) {
            try {
                const logs = await fetchJournalLogs(syslogId, 1);
                const hasReal = logs.length > 0 && !logs[0].message.includes('journalctl');
                results[key] = { ok: hasReal, syslogId, lastEntry: logs[0] || null };
            } catch (e) {
                results[key] = { ok: false, syslogId, error: e.message };
            }
        }

        const allOk = Object.values(results).every(r => r.ok);

        res.json({
            success: true,
            healthy: allOk,
            platform: process.platform,
            services: results
        });
    } catch (error) {
        logger.error('Logs health check error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/logs/:service
 * Fetch recent logs for a specific service
 * Query params: lines (default 50)
 */
router.get('/:service', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { service } = req.params;
        const lines = Math.min(parseInt(req.query.lines) || 50, 200);  // Cap at 200
        
        if (!SERVICES[service]) {
            return res.status(400).json({
                success: false,
                error: `Invalid service. Valid: ${Object.keys(SERVICES).join(', ')}`
            });
        }
        
        const syslogId = SERVICES[service];
        
        // Use journalctl to fetch logs (Pi uses systemd)
        const logs = await fetchJournalLogs(syslogId, lines);
        
        res.json({
            success: true,
            service,
            syslogId,
            lines: logs.length,
            logs
        });
    } catch (error) {
        logger.error('Logs fetch error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/logs
 * Fetch logs from all 3 services combined
 */
router.get('/', requireAuth, requireAdmin, async (req, res) => {
    try {
        const lines = Math.min(parseInt(req.query.lines) || 30, 100);
        
        const allLogs = {};
        
        for (const [key, syslogId] of Object.entries(SERVICES)) {
            try {
                allLogs[key] = await fetchJournalLogs(syslogId, lines);
            } catch (e) {
                allLogs[key] = [{ timestamp: new Date().toISOString(), message: `Error: ${e.message}`, level: 'error' }];
            }
        }
        
        res.json({
            success: true,
            services: Object.keys(SERVICES),
            logs: allLogs
        });
    } catch (error) {
        logger.error('Logs fetch error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Fetch logs from journalctl
 * @param {string} syslogId - SyslogIdentifier from service file
 * @param {number} lines - Number of lines to fetch
 * @returns {Promise<Array>} Parsed log entries
 */
function fetchJournalLogs(syslogId, lines) {
    return new Promise((resolve, reject) => {
        // journalctl -t <syslog-identifier> -n <lines> --no-pager -o json
        const args = [
            '-t', syslogId,
            '-n', String(lines),
            '--no-pager',
            '-o', 'json'
        ];
        
        const proc = spawn('journalctl', args);
        let stdout = '';
        let stderr = '';
        
        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        proc.on('close', (code) => {
            if (code !== 0 && stderr) {
                // On Windows or when journalctl unavailable, return mock data
                return resolve([{
                    timestamp: new Date().toISOString(),
                    message: `journalctl not available (code ${code}). Run on Raspberry Pi.`,
                    level: 'warn',
                    service: syslogId
                }]);
            }
            
            try {
                // Parse JSON lines output
                const logs = stdout.trim().split('\n')
                    .filter(line => line.trim())
                    .map(line => {
                        try {
                            const entry = JSON.parse(line);
                            return {
                                timestamp: new Date(parseInt(entry.__REALTIME_TIMESTAMP) / 1000).toISOString(),
                                message: entry.MESSAGE || '',
                                priority: entry.PRIORITY,
                                level: priorityToLevel(entry.PRIORITY),
                                service: syslogId
                            };
                        } catch (e) {
                            return { timestamp: new Date().toISOString(), message: line, level: 'info', service: syslogId };
                        }
                    });
                
                resolve(logs);
            } catch (e) {
                resolve([{ timestamp: new Date().toISOString(), message: stdout || 'No logs', level: 'info', service: syslogId }]);
            }
        });
        
        proc.on('error', (err) => {
            // journalctl not found (Windows dev environment)
            resolve([{
                timestamp: new Date().toISOString(),
                message: `journalctl unavailable: ${err.message}. Deploy to Raspberry Pi for live logs.`,
                level: 'warn',
                service: syslogId
            }]);
        });
    });
}

/**
 * Convert syslog priority to log level
 */
function priorityToLevel(priority) {
    const levels = {
        '0': 'emerg',
        '1': 'alert', 
        '2': 'crit',
        '3': 'error',
        '4': 'warn',
        '5': 'notice',
        '6': 'info',
        '7': 'debug'
    };
    return levels[priority] || 'info';
}

/**
 * Setup Socket.IO log streaming
 * Call this from server.js with the io instance
 */
function setupLogStreaming(io) {
    io.on('connection', (socket) => {
        // Handle log subscription
        socket.on('logs:subscribe', (services) => {
            const requested = Array.isArray(services) ? services : Object.keys(SERVICES);
            
            logger.socket(`Client subscribed to logs: ${requested.join(', ')}`);
            
            // Start journalctl follow for each service
            requested.forEach(serviceKey => {
                const syslogId = SERVICES[serviceKey];
                if (!syslogId) return;
                
                const streamKey = `${socket.id}-${serviceKey}`;
                
                // Spawn journalctl -f (follow mode)
                const proc = spawn('journalctl', [
                    '-t', syslogId,
                    '-f',  // Follow
                    '--no-pager',
                    '-o', 'json',
                    '-n', '0'  // Don't show old logs
                ]);
                
                proc.stdout.on('data', (data) => {
                    const lines = data.toString().trim().split('\n');
                    lines.forEach(line => {
                        try {
                            const entry = JSON.parse(line);
                            socket.emit('logs:entry', {
                                service: serviceKey,
                                timestamp: new Date(parseInt(entry.__REALTIME_TIMESTAMP) / 1000).toISOString(),
                                message: entry.MESSAGE || '',
                                level: priorityToLevel(entry.PRIORITY)
                            });
                        } catch (e) {
                            // Non-JSON line
                            socket.emit('logs:entry', {
                                service: serviceKey,
                                timestamp: new Date().toISOString(),
                                message: line,
                                level: 'info'
                            });
                        }
                    });
                });
                
                proc.on('error', (err) => {
                    socket.emit('logs:error', {
                        service: serviceKey,
                        error: `Stream unavailable: ${err.message}`
                    });
                });
                
                activeStreams.set(streamKey, proc);
            });
        });
        
        // Handle unsubscribe
        socket.on('logs:unsubscribe', () => {
            cleanupStreams(socket.id);
        });
        
        // Cleanup on disconnect
        socket.on('disconnect', () => {
            cleanupStreams(socket.id);
        });
    });
}

/**
 * Cleanup log streams for a socket
 */
function cleanupStreams(socketId) {
    for (const [key, proc] of activeStreams.entries()) {
        if (key.startsWith(socketId)) {
            try {
                proc.kill();
            } catch (e) {}
            activeStreams.delete(key);
        }
    }
}

module.exports = router;
module.exports.setupLogStreaming = setupLogStreaming;
