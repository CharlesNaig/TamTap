/**
 * TAMTAP Hardware Key Middleware
 * Authenticates requests from the Raspberry Pi hardware (tamtap.py)
 * 
 * The hardware sends X-Hardware-Key header with a shared secret.
 * This prevents students from forging attendance via curl/Postman.
 */

const config = require('../config');

/**
 * Require valid hardware API key in X-Hardware-Key header.
 * Used on /api/hardware/* endpoints.
 */
function requireHardwareKey(req, res, next) {
    const key = req.headers['x-hardware-key'];
    const expected = config.hardwareSecret;

    if (!expected) {
        // No secret configured — allow (dev mode / backward compat)
        return next();
    }

    if (!key || key !== expected) {
        return res.status(401).json({
            success: false,
            error: 'Invalid or missing hardware key'
        });
    }

    return next();
}

/**
 * Allow either session auth OR hardware key.
 * Used on routes that both the dashboard and hardware need to access.
 */
function requireAuthOrHardwareKey(req, res, next) {
    // Check session first
    if (req.session && req.session.user) {
        req.user = req.session.user;
        return next();
    }

    // Fall back to hardware key
    const key = req.headers['x-hardware-key'];
    const expected = config.hardwareSecret;

    if (expected && key === expected) {
        return next();
    }

    return res.status(401).json({
        success: false,
        error: 'Authentication required'
    });
}

module.exports = { requireHardwareKey, requireAuthOrHardwareKey };
