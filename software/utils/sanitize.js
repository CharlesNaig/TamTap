/**
 * TAMTAP Input Sanitization Utilities
 * Prevents NoSQL injection via $regex and other operator attacks
 */

/**
 * Validate and sanitize a date string.
 * Only allows YYYY-MM-DD format — rejects everything else.
 * @param {string} str - Input to validate
 * @returns {string|null} Validated date string or null if invalid
 */
function sanitizeDate(str) {
    if (!str || typeof str !== 'string') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
    return str;
}

/**
 * Escape regex special characters in a string.
 * Use when building $regex from user input that isn't a date.
 * @param {string} str - Input to escape
 * @returns {string} Escaped string safe for RegExp
 */
function escapeRegex(str) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a date $regex query safely.
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @returns {Object|null} MongoDB query fragment like { $regex: '^2026-03-03' } or null
 */
function buildDateRegex(dateStr) {
    const safe = sanitizeDate(dateStr);
    if (!safe) return null;
    return { $regex: `^${safe}` };
}

module.exports = { sanitizeDate, escapeRegex, buildDateRegex };
