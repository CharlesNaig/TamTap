/**
 * TAMTAP Logger - Signale-based logging
 * Colorful, structured console logging for the attendance system
 */

const { Signale } = require('signale');

class Logger extends Signale {
    constructor(scope = 'TAMTAP') {
        super({
            disabled: false,
            interactive: false,
            logLevel: 'info',
            scope: scope,
            types: {
                info: {
                    badge: 'ℹ',
                    color: 'blue',
                    label: 'info',
                    logLevel: 'info'
                },
                success: {
                    badge: '✔',
                    color: 'green',
                    label: 'success',
                    logLevel: 'info'
                },
                warn: {
                    badge: '⚠',
                    color: 'yellow',
                    label: 'warn',
                    logLevel: 'warn'
                },
                error: {
                    badge: '✖',
                    color: 'red',
                    label: 'error',
                    logLevel: 'error'
                },
                debug: {
                    badge: '🐛',
                    color: 'magenta',
                    label: 'debug',
                    logLevel: 'debug'
                },
                database: {
                    badge: '🗄',
                    color: 'cyan',
                    label: 'database',
                    logLevel: 'info'
                },
                server: {
                    badge: '🚀',
                    color: 'green',
                    label: 'server',
                    logLevel: 'info'
                },
                socket: {
                    badge: '📡',
                    color: 'magenta',
                    label: 'socket',
                    logLevel: 'info'
                },
                auth: {
                    badge: '🔐',
                    color: 'yellow',
                    label: 'auth',
                    logLevel: 'info'
                },
                api: {
                    badge: '📨',
                    color: 'blue',
                    label: 'api',
                    logLevel: 'info'
                },
                hardware: {
                    badge: '🔧',
                    color: 'cyan',
                    label: 'hardware',
                    logLevel: 'info'
                },
                export: {
                    badge: '📄',
                    color: 'white',
                    label: 'export',
                    logLevel: 'info'
                },
                attendance: {
                    badge: '📋',
                    color: 'green',
                    label: 'attendance',
                    logLevel: 'info'
                }
            }
        });
    }

    /**
     * Log startup banner
     */
    banner() {
        console.log('');
        console.log('========================================');
        console.log('  🦬 TAMTAP v2.0 - Attendance Server');
        console.log('  TamTap NFC-Based Attendance System');
        console.log('  FEU Roosevelt Marikina');
        console.log('========================================');
        console.log('');
    }

    /**
     * Create a scoped logger instance
     * @param {string} scope - Scope name (e.g., 'Auth', 'Export')
     * @returns {Logger} - Scoped logger instance
     */
    createScope(scope) {
        return new Logger(scope);
    }
}

// Export singleton instance
const logger = new Logger();

// Also export class for creating scoped loggers
module.exports = logger;
module.exports.Logger = Logger;
