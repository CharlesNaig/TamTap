/**
 * Philippine timezone date utilities.
 * Centralized to avoid scattered timezone-unaware Date calls.
 *
 * All TAMTAP backend routes should use these instead of
 * `new Date().toISOString().split('T')[0]` which returns UTC dates.
 */

/**
 * Get today's date string in Asia/Manila timezone.
 * @returns {string} YYYY-MM-DD
 */
function getPhilippineDate() {
    const now = new Date();
    const phTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
    const year = phTime.getFullYear();
    const month = String(phTime.getMonth() + 1).padStart(2, '0');
    const day = String(phTime.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Get a Date object adjusted to Asia/Manila timezone.
 * @returns {Date}
 */
function getPhilippineDateObj() {
    const now = new Date();
    return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
}

module.exports = { getPhilippineDate, getPhilippineDateObj };
