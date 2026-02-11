/**
 * TAMTAP v2.0 - Filename Sanitizer Utility
 * 
 * Mirrors the Python sanitize_filename() from hardware/tamtap.py.
 * Handles Filipino names with ñ/Ñ and other accented characters.
 */

/**
 * Character map for common accented/special characters.
 * Focused on Filipino name support (ñ → n).
 */
const CHAR_MAP = {
    'ñ': 'n', 'Ñ': 'N',
    'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u',
    'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U'
};

/**
 * Sanitize text for use in filenames.
 * - Maps ñ→n, Ñ→N (Filipino name support)
 * - Normalizes Unicode NFC before stripping
 * - Keeps only ASCII alphanumeric and underscore
 * - Replaces spaces with underscores
 * - Max 30 characters
 * 
 * @param {string} text - Raw text to sanitize (e.g., student name)
 * @returns {string} Sanitized filename-safe string
 */
function sanitizeFilename(text) {
    if (!text || typeof text !== 'string') return 'Unknown';

    // Normalize to NFC (composed form)
    let normalized = text.normalize('NFC');

    // Map accented/special chars
    let mapped = '';
    for (const ch of normalized) {
        mapped += CHAR_MAP[ch] || ch;
    }

    // Replace spaces with underscores, keep only ASCII alphanumeric + underscore
    let sanitized = mapped.replace(/ /g, '_').replace(/[^A-Za-z0-9_]/g, '_');

    // Collapse consecutive underscores
    sanitized = sanitized.replace(/_+/g, '_');

    // Strip leading/trailing underscores, cap at 30 chars
    return sanitized.replace(/^_+|_+$/g, '').slice(0, 30);
}

module.exports = { sanitizeFilename };
