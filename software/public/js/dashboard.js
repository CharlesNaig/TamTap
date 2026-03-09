// ========================================
// GLOBALS
// ========================================
let currentUser = null;
let socket = null;
let currentRecords = [];
let currentDateRange = 'today';
let breakdownAvailable = false; // Track if backend provides status breakdown
let currentView = 'attendance';  // 'attendance' | 'roster' | 'not-tapped' | 'schedules'
let currentSection = '';             // Currently selected section ('' = all)
let rosterData = null;               // Cached roster from /api/students/section/:section
let schedulesData = null;            // Cached schedules from /api/schedules
let currentStudentNfcId = null;      // NFC ID of student in detail modal
let currentStudentName = null;       // Name of student in detail modal
let rosterSort = { field: 'name', dir: 'asc' }; // Roster sort state

// ========================================
// PERMISSION HELPER
// Only admin or section adviser can mark excused/absent
// ========================================
function canMarkAttendance(section) {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    return currentUser.advised_section === section;
}

// ========================================
// TIMEZONE HELPER - Asia/Manila (UTC+8)
// ========================================
function getPhilippineDate() {
    // Get current date in Philippines timezone
    const now = new Date();
    const phTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
    const year = phTime.getFullYear();
    const month = String(phTime.getMonth() + 1).padStart(2, '0');
    const day = String(phTime.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getPhilippineDateObj() {
    // Get Date object representing current time in Philippines
    const now = new Date();
    return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
}

// ========================================
// AUTH CHECK (GET /api/auth/me)
// Redirect to login if not authenticated
// ========================================
async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (!res.ok) {
            window.location.replace('/login');
            return;
        }
        const data = await res.json();
        if (!data.success || !data.user) {
            window.location.replace('/login');
            return;
        }
        
        currentUser = data.user;
        
        // Auth verified - show page content
        document.body.classList.remove('auth-loading');
        
        // Update UI with user info
        document.getElementById('user-name').textContent = currentUser.name;
        document.getElementById('welcome-name').textContent = currentUser.name;
        document.getElementById('menu-user-name').textContent = currentUser.name;
        document.getElementById('menu-user-role').textContent = 
            currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1);
        
        // Set user initials
        const nameParts = currentUser.name.split(' ');
        const initials = nameParts.length >= 2 
            ? nameParts[0][0] + nameParts[nameParts.length - 1][0]
            : currentUser.name.substring(0, 2);
        document.getElementById('user-initials').textContent = initials.toUpperCase();
        
        // Show Admin Panel link if user is admin
        if (currentUser.role === 'admin') {
            document.getElementById('admin-link').classList.remove('hidden');
        }
        
        // Initialize dashboard
        initDashboard();
        
    } catch (e) {
        console.error('[ERROR] Auth check failed:', e);
        window.location.replace('/login');
    }
}

// ========================================
// LOGOUT (POST /api/auth/logout)
// ========================================
async function logout() {
    showPreloader('Logging out...');
    try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {
        console.error('[ERROR] Logout error:', e);
    }
    navigateTo('/login', 'Redirecting to login...');
}

// ========================================
// DASHBOARD INITIALIZATION
// ========================================
async function initDashboard() {
    // Populate section dropdown from user's sections_handled
    populateSectionDropdown();
    
    // Set default date display
    updateDateDisplay();
    
    // Connect Socket.IO
    initSocket();
    
    // Load notification count (only for admin/advisers)
    if (currentUser.role === 'admin' || currentUser.advised_section) {
        loadNotificationCount();
    } else {
        const notifBtn = document.getElementById('notification-btn');
        if (notifBtn) notifBtn.classList.add('hidden');
    }
    
    // Load initial data
    refreshData();
}

// ========================================
// SECTION DROPDOWN
// Backend: Uses sections_handled from GET /api/auth/me
// ========================================
function populateSectionDropdown() {
    const select = document.getElementById('section-select');
    if (!select) {
        console.error('[ERROR] Section select not found');
        return;
    }
    
    const sections = currentUser?.sections_handled || [];
    console.log('[DEBUG] Sections handled:', sections);
    
    select.innerHTML = '<option value="">All Sections</option>';
    sections.forEach(s => {
        select.innerHTML += `<option value="${s}">${s}</option>`;
    });
    
    const display = document.getElementById('current-section-display');
    if (display) display.textContent = 'All Sections';
}

function onSectionChange() {
    const select = document.getElementById('section-select');
    currentSection = select ? select.value : '';
    
    document.getElementById('current-section-display').textContent = currentSection || 'All Sections';
    rosterData = null; // Invalidate roster cache on section change
    refreshData();
}

// ========================================
// DATE RANGE TABS
// ========================================
let customDate = null; // For custom date picker

function setDateRange(range) {
    currentDateRange = range;
    
    // Update tab styles
    document.querySelectorAll('.date-tab').forEach(tab => {
        tab.classList.remove('bg-feu-green', 'text-white');
        tab.classList.add('text-gray-600', 'hover:bg-gray-100');
    });
    const activeTab = document.getElementById(`tab-${range}`);
    if (activeTab) {
        activeTab.classList.remove('text-gray-600', 'hover:bg-gray-100');
        activeTab.classList.add('bg-feu-green', 'text-white');
    }
    
    // Show/hide custom date picker
    const datePicker = document.getElementById('custom-date-picker');
    if (range === 'custom') {
        datePicker.classList.remove('hidden');
        datePicker.classList.add('flex');
        // Set default to today if not set
        if (!document.getElementById('custom-date').value) {
            document.getElementById('custom-date').value = getPhilippineDate();
        }
        // Set max date to today (no future dates)
        document.getElementById('custom-date').max = getPhilippineDate();
    } else {
        datePicker.classList.add('hidden');
        datePicker.classList.remove('flex');
        customDate = null;
    }
    
    updateDateDisplay();
    refreshData();
}

function onCustomDateChange() {
    const dateInput = document.getElementById('custom-date');
    const selectedDate = new Date(dateInput.value);
    const day = selectedDate.getDay();
    
    // Check if Sunday (disabled)
    if (day === 0) {
        Swal.fire({
            icon: 'warning',
            title: 'Sunday Selected',
            text: 'Sundays are non-instructional days. No classes.',
            confirmButtonColor: '#0a8249'
        });
        return;
    }
    
    // Check if Saturday (need to verify if enabled)
    if (day === 6) {
        // Check Saturday setting from backend
        checkSaturdayEnabled(dateInput.value);
        return;
    }
    
    customDate = dateInput.value;
    updateDateDisplay();
    refreshData();
}

async function checkSaturdayEnabled(dateValue) {
    try {
        const res = await fetch('/api/calendar/saturday-status', { credentials: 'include' });
        const data = await res.json();
        
        if (!data.saturdayClassesEnabled) {
            Swal.fire({
                icon: 'warning',
                title: 'Saturday Classes Disabled',
                text: 'Saturday classes are currently disabled by admin.',
                confirmButtonColor: '#0a8249'
            });
            return;
        }
        
        customDate = dateValue;
        updateDateDisplay();
        refreshData();
    } catch (e) {
        console.error('[ERROR] Failed to check Saturday status:', e);
        customDate = dateValue;
        updateDateDisplay();
        refreshData();
    }
}

function updateDateDisplay() {
    const today = new Date();
    let display = '';
    let summaryDisplay = '';
    
    switch (currentDateRange) {
        case 'today':
            display = today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            summaryDisplay = 'Today';
            break;
        case 'week':
            const weekStart = new Date(today);
            weekStart.setDate(today.getDate() - today.getDay());
            display = `Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
            summaryDisplay = 'This Week';
            break;
        case 'month':
            display = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            summaryDisplay = 'This Month';
            break;
        case 'custom':
            if (customDate) {
                const d = new Date(customDate);
                display = d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                summaryDisplay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            } else {
                display = 'Select a date';
                summaryDisplay = 'Custom Date';
            }
            break;
        case 'semester':
            display = 'Current Semester';
            summaryDisplay = 'This Semester';
            break;
    }
    
    document.getElementById('date-display').textContent = display;
    document.getElementById('current-date-display').textContent = summaryDisplay;
    document.getElementById('summary-date-range').textContent = summaryDisplay;
}

// ========================================
// SOCKET.IO INITIALIZATION
// Contract events: attendance:new, system:status
// ========================================
function initSocket() {
    try {
        socket = io();
        
        socket.on('connect', () => {
            updateConnectionStatus(true);
            console.log('[INFO] Socket.IO connected');
        });
        
        socket.on('disconnect', () => {
            updateConnectionStatus(false);
            console.log('[WARN] Socket.IO disconnected');
        });
        
        // Real-time attendance update
        socket.on('attendance:new', (data) => {
            console.log('[INFO] New attendance:', data);
            
            // Only inject into table if viewing today
            const isViewingToday = currentDateRange === 'today';
            
            if (isViewingToday) {
                // Check if matches current section filter
                const userSections = currentUser.sections_handled || [];
                
                if (!currentSection) {
                    // "All My Sections" - check if in user's sections
                    if (userSections.length === 0 || userSections.includes(data.section)) {
                        addRecordToTable(data, true);
                        updateLocalStats();
                        updateStats();
                    }
                } else if (data.section === currentSection) {
                    addRecordToTable(data, true);
                    updateLocalStats();
                    updateStats();
                }
                
                // Re-render secondary views if active
                if (currentView === 'roster') renderRoster();
                else if (currentView === 'not-tapped') renderNotTapped();
            }
            
            // Always show toast notification regardless of view
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: `${data.name} checked in!`,
                showConfirmButton: false,
                timer: 3000
            });
        });
        
        socket.on('system:status', (data) => {
            console.log('[INFO] System status:', data);
        });
        
    } catch (e) {
        console.error('[ERROR] Socket.IO init failed:', e);
        updateConnectionStatus(false);
    }
}

function updateConnectionStatus(connected) {
    const badge = document.getElementById('connection-status');
    if (connected) {
        badge.className = 'px-2 py-0.5 rounded-full text-xs bg-white/20 inline-flex items-center gap-1';
        badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span><span class="hidden sm:inline">Live</span>';
    } else {
        badge.className = 'px-2 py-0.5 rounded-full text-xs bg-red-500/80 inline-flex items-center gap-1';
        badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-white"></span><span class="hidden sm:inline">Offline</span>';
    }
}

// ========================================
// SKELETON LOADING HELPERS
// ========================================
function showSkeletons() {
    // Show skeletons
    const skelCards = document.getElementById('summary-cards-skeleton');
    const skelTable = document.getElementById('attendance-table-skeleton');
    const skelMobile = document.getElementById('attendance-cards-skeleton');
    
    if (skelCards) skelCards.classList.remove('hidden');
    if (skelTable) skelTable.classList.remove('hidden');
    if (skelMobile) skelMobile.classList.remove('hidden');
    
    // Hide content
    const summaryCards = document.getElementById('summary-cards');
    const table = document.getElementById('attendance-table');
    const cards = document.getElementById('attendance-cards');
    const empty = document.getElementById('empty-state');
    
    if (summaryCards) summaryCards.classList.add('hidden');
    if (table) table.classList.add('hidden');
    if (cards) cards.classList.add('hidden');
    if (empty) empty.classList.add('hidden');
}

function hideSkeletons() {
    // Hide skeletons
    const skelCards = document.getElementById('summary-cards-skeleton');
    const skelTable = document.getElementById('attendance-table-skeleton');
    const skelMobile = document.getElementById('attendance-cards-skeleton');
    
    if (skelCards) skelCards.classList.add('hidden');
    if (skelTable) skelTable.classList.add('hidden');
    if (skelMobile) skelMobile.classList.add('hidden');
    
    // Show summary cards (always visible)
    const summaryCards = document.getElementById('summary-cards');
    if (summaryCards) {
        summaryCards.classList.remove('hidden');
        summaryCards.classList.add('grid');
    }
    
    // Show attendance content based on records
    const table = document.getElementById('attendance-table');
    const cards = document.getElementById('attendance-cards');
    const empty = document.getElementById('empty-state');
    
    if (currentRecords && currentRecords.length > 0) {
        if (table) table.classList.remove('hidden');
        if (cards) cards.classList.remove('hidden');
        if (empty) empty.classList.add('hidden');
    } else {
        if (table) table.classList.add('hidden');
        if (cards) cards.classList.add('hidden');
        if (empty) empty.classList.remove('hidden');
    }
    
    console.log('[DEBUG] hideSkeletons complete, records:', currentRecords?.length || 0);
}

// ========================================
// DATA LOADING
// ========================================
async function refreshData() {
    const icon = document.getElementById('refresh-icon');
    if (icon) icon.classList.add('fa-spin');
    
    // Show skeleton loading
    showSkeletons();
    
    try {
        // Load data with 15-second timeout
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Request timeout')), 15000)
        );
        
        await Promise.race([
            Promise.all([
                loadAttendance().catch(e => console.error('[ERROR] loadAttendance:', e)),
                loadStats().catch(e => console.error('[ERROR] loadStats:', e))
            ]),
            timeoutPromise
        ]);
        
    } catch (err) {
        console.error('[ERROR] Data loading failed:', err.message);
    }
    
    // Always hide skeletons and show content
    if (icon) icon.classList.remove('fa-spin');
    hideSkeletons();

    // Re-render secondary views if active (they depend on currentRecords)
    if (currentView === 'roster') renderRoster();
    else if (currentView === 'not-tapped') loadRoster().then(() => renderNotTapped());
}

// ========================================
// GET DATE RANGE FOR API
// Returns {from, to} based on currentDateRange
// ========================================
function getDateRange() {
    const today = getPhilippineDateObj();
    const todayStr = getPhilippineDate();
    
    switch (currentDateRange) {
        case 'today':
            return { from: todayStr, to: todayStr };
        case 'week': {
            const weekStart = new Date(today);
            weekStart.setDate(today.getDate() - today.getDay());
            const year = weekStart.getFullYear();
            const month = String(weekStart.getMonth() + 1).padStart(2, '0');
            const day = String(weekStart.getDate()).padStart(2, '0');
            return { 
                from: `${year}-${month}-${day}`, 
                to: todayStr 
            };
        }
        case 'month': {
            const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
            const year = monthStart.getFullYear();
            const month = String(monthStart.getMonth() + 1).padStart(2, '0');
            return { 
                from: `${year}-${month}-01`, 
                to: todayStr 
            };
        }
        case 'custom': {
            // Single day from custom date picker
            if (customDate) {
                return { from: customDate, to: customDate };
            }
            return { from: todayStr, to: todayStr };
        }
        default:
            return { from: todayStr, to: todayStr };
    }
}

// ========================================
// LOAD ATTENDANCE
// Backend: GET /api/attendance/:date (single day)
//          GET /api/attendance/range/query?from=&to= (range)
// ========================================
async function loadAttendance() {
    console.log('[DEBUG] loadAttendance started');
    try {
        const section = currentSection;
        const { from, to } = getDateRange();
        
        console.log('[DEBUG] Date range:', from, 'to', to, 'Section:', section || 'all');
        
        let url;
        let queryParams = [];
        
        // Choose endpoint based on date range
        if (from === to) {
            // Single day - use /:date endpoint
            url = `/api/attendance/${from}`;
        } else {
            // Date range - use /range/query endpoint
            url = '/api/attendance/range/query';
            queryParams.push(`from=${from}`, `to=${to}`);
        }
        
        // Add section filter
        if (section) {
            queryParams.push(`section=${encodeURIComponent(section)}`);
        } else {
            // All sections for this teacher
            const sections = currentUser?.sections_handled || [];
            if (sections.length > 0) {
                queryParams.push(`sections=${encodeURIComponent(sections.join(','))}`);
            }
        }
        
        if (queryParams.length > 0) {
            url += (url.includes('?') ? '&' : '?') + queryParams.join('&');
        }
        
        console.log('[DEBUG] Fetching attendance:', url);
        
        const res = await fetch(url, { credentials: 'include' });
        console.log('[DEBUG] Attendance response status:', res.status);
        
        if (!res.ok) {
            console.error('[ERROR] Attendance fetch failed:', res.status);
            return;
        }
        
        const data = await res.json();
        console.log('[DEBUG] Attendance data:', data.success, 'records:', data.records?.length || 0);
        
        if (!data.success) {
            return;
        }
        
        currentRecords = data.records || [];
        const recordCount = document.getElementById('record-count');
        if (recordCount) recordCount.textContent = `${currentRecords.length} records`;
        
        if (currentRecords.length === 0) {
            return;
        }
        
        renderTable(currentRecords);
        updateLocalStats();
        console.log('[DEBUG] loadAttendance complete');
        
    } catch (e) {
        console.error('[ERROR] Load attendance failed:', e);
    }
}

function showEmptyState() {
    document.getElementById('attendance-table').innerHTML = '';
    document.getElementById('empty-state').classList.remove('hidden');
    document.getElementById('record-count').textContent = '0 records';
    currentRecords = [];
    updateLocalStats(); // Reset stats display
}

// ========================================
// LOCAL STATS CALCULATION
// Calculates breakdown from currentRecords
// since backend doesn't provide this data
// ========================================
function updateLocalStats() {
    // Count status from currently loaded records
    let onTime = 0;
    let late = 0;
    let absent = 0;
    
    currentRecords.forEach(r => {
        switch (r.status) {
            case 'present':
                onTime++;
                break;
            case 'late':
                late++;
                break;
            case 'absent':
                absent++;
                break;
            default:
                // Unknown status - count as present
                onTime++;
        }
    });
    
    // Update the breakdown cards with local data
    document.getElementById('count-ontime').textContent = onTime;
    document.getElementById('count-late').textContent = late;
    document.getElementById('count-absent').textContent = absent;
    
    // Enable the cards since we now have local data
    document.getElementById('summary-cards').classList.remove('card-disabled');
    document.getElementById('summary-unavailable').classList.add('hidden');
    
    // Update the breakdown notice
    const notice = document.getElementById('breakdown-notice');
    if (currentRecords.length > 0) {
        notice.classList.add('hidden');
    } else {
        notice.innerHTML = '<i class="fas fa-info-circle mr-1"></i> No records to calculate breakdown';
        notice.classList.remove('hidden');
    }
    
    // Update attendance rate from local data
    const total = currentRecords.length;
    if (total > 0) {
        const presentCount = onTime + late; // Present includes on-time and late
        const rate = Math.round((presentCount / total) * 100);
        document.getElementById('attendance-rate').textContent = `${rate}%`;
        document.getElementById('attendance-bar').style.width = `${rate}%`;
    }
}

// ========================================
// VIEW SWITCHING (Attendance / Roster / Not-Tapped / Schedules)
// ========================================
function setView(view) {
    currentView = view;

    // Toggle visibility
    ['attendance', 'roster', 'not-tapped', 'schedules'].forEach(v => {
        const el = document.getElementById(`view-${v}`);
        if (el) el.classList.toggle('hidden', v !== view);
    });

    // Update tab styles
    document.querySelectorAll('.view-tab').forEach(tab => {
        tab.classList.remove('bg-feu-green', 'text-white');
        tab.classList.add('text-gray-600', 'hover:bg-white/60');
    });
    const activeTab = document.getElementById(`view-tab-${view}`);
    if (activeTab) {
        activeTab.classList.remove('text-gray-600', 'hover:bg-white/60');
        activeTab.classList.add('bg-feu-green', 'text-white');
    }

    // Load data for the selected view
    if (view === 'roster') {
        loadRoster();
    } else if (view === 'not-tapped') {
        loadRoster().then(() => renderNotTapped());
    } else if (view === 'schedules') {
        loadTeacherSchedules();
    }
}

// ========================================
// SCHEDULES: Load + Render + Edit (Teacher)
// Backend: GET /api/schedules, PUT /api/schedules/:section
// ========================================
async function loadTeacherSchedules() {
    try {
        const res = await fetch('/api/schedules', { credentials: 'include' });
        const data = await res.json();

        if (data.success) {
            schedulesData = data.data || [];
            renderTeacherSchedules();
        } else {
            throw new Error(data.error || 'Failed to load schedules');
        }
    } catch (err) {
        console.error('[ERROR] loadTeacherSchedules:', err.message);
        const tbody = document.getElementById('schedules-table');
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-red-400"><i class="fas fa-exclamation-circle mr-1"></i> Failed to load schedules</td></tr>';
    }
}

function getScheduleSummary(ws) {
    if (!ws) return { weekday: '07:00–17:00', sat: 'None' };
    const mon = ws.monday || { start: '07:00', end: '17:00' };
    const sat = ws.saturday || {};
    return {
        weekday: `${mon.start || '07:00'}–${mon.end || '17:00'}`,
        sat: sat.start ? `${sat.start}–${sat.end}` : 'None'
    };
}

function renderTeacherSchedules() {
    const tbody = document.getElementById('schedules-table');
    const cards = document.getElementById('schedules-cards');
    const empty = document.getElementById('schedules-empty');
    const count = document.getElementById('schedules-count');

    if (!schedulesData || schedulesData.length === 0) {
        if (tbody) tbody.innerHTML = '';
        if (cards) cards.innerHTML = '';
        if (empty) empty.classList.remove('hidden');
        if (count) count.textContent = '0 schedules';
        return;
    }

    if (empty) empty.classList.add('hidden');
    if (count) count.textContent = `${schedulesData.length} schedule${schedulesData.length !== 1 ? 's' : ''}`;

    // Desktop table
    if (tbody) {
        tbody.innerHTML = schedulesData.map(s => {
            const summary = getScheduleSummary(s.weekly_schedule);
            return `
                <tr class="hover:bg-gray-50">
                    <td class="px-3 lg:px-4 py-3">
                        <span class="inline-flex items-center gap-1.5">
                            <i class="fas fa-users text-feu-green text-xs"></i>
                            <span class="font-medium">${escapeHtml(s.section)}</span>
                        </span>
                    </td>
                    <td class="px-3 lg:px-4 py-3 text-gray-600">${s.adviser_name ? escapeHtml(s.adviser_name) : '<span class="text-gray-400">—</span>'}</td>
                    <td class="px-3 lg:px-4 py-3 font-mono text-sm">${summary.weekday}</td>
                    <td class="px-3 lg:px-4 py-3 font-mono text-sm hidden md:table-cell ${summary.sat === 'None' ? 'text-gray-400' : 'text-yellow-600'}">${summary.sat}</td>
                    <td class="px-3 lg:px-4 py-3 hidden lg:table-cell">${s.grace_period_minutes || 20} min</td>
                    <td class="px-3 lg:px-4 py-3 text-center">
                        <button onclick="editTeacherSchedule('${escapeHtml(s.section)}')"
                                class="text-blue-600 hover:text-blue-800 hover:bg-blue-50 p-1.5 rounded-lg transition" title="Edit Schedule">
                            <i class="fas fa-edit"></i>
                        </button>
                    </td>
                </tr>`;
        }).join('');
    }

    // Mobile cards
    if (cards) {
        cards.innerHTML = schedulesData.map(s => {
            const summary = getScheduleSummary(s.weekly_schedule);
            return `
                <div class="p-3 hover:bg-gray-50">
                    <div class="flex justify-between items-start mb-2">
                        <div>
                            <h4 class="font-semibold text-gray-800 text-sm">${escapeHtml(s.section)}</h4>
                            <p class="text-xs text-gray-500">${s.adviser_name ? escapeHtml(s.adviser_name) : 'No adviser'}</p>
                        </div>
                        <button onclick="editTeacherSchedule('${escapeHtml(s.section)}')"
                                class="text-blue-600 hover:bg-blue-50 p-1.5 rounded-lg transition" title="Edit">
                            <i class="fas fa-edit text-sm"></i>
                        </button>
                    </div>
                    <div class="grid grid-cols-3 gap-2 text-xs text-gray-600">
                        <div><span class="text-gray-400">M–F:</span> ${summary.weekday}</div>
                        <div><span class="text-gray-400">Sat:</span> ${summary.sat}</div>
                        <div><span class="text-gray-400">Grace:</span> ${s.grace_period_minutes || 20}m</div>
                    </div>
                </div>`;
        }).join('');
    }
}

async function editTeacherSchedule(section) {
    const schedule = schedulesData?.find(s => s.section === section);
    if (!schedule) return;

    const ws = schedule.weekly_schedule || {};
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Build the schedule edit form HTML
    let formHtml = '<div class="text-left space-y-3">';
    formHtml += '<p class="text-xs text-gray-500 mb-2">Edit arrival and dismissal times for each day.</p>';
    formHtml += '<div class="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-2 items-center text-sm">';
    formHtml += '<span class="font-medium text-gray-500 text-xs">Day</span><span class="font-medium text-gray-500 text-xs text-center">Start</span><span class="font-medium text-gray-500 text-xs text-center">End</span>';

    days.forEach((day, i) => {
        const d = ws[day] || {};
        const startVal = d.start || (day === 'saturday' ? '' : '07:00');
        const endVal = d.end || (day === 'saturday' ? '' : '17:00');
        formHtml += `
            <span class="text-gray-700 font-medium">${dayLabels[i]}</span>
            <input type="time" id="swal-${day}-start" value="${startVal}" class="border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center focus:ring-2 focus:ring-feu-green/30 focus:border-feu-green outline-none">
            <input type="time" id="swal-${day}-end" value="${endVal}" class="border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center focus:ring-2 focus:ring-feu-green/30 focus:border-feu-green outline-none">`;
    });
    formHtml += '</div>';

    // Grace period and absent threshold
    formHtml += `
        <div class="grid grid-cols-2 gap-3 pt-2 border-t">
            <div>
                <label class="text-xs text-gray-500 block mb-1">Grace Period (min)</label>
                <input type="number" id="swal-grace" value="${schedule.grace_period_minutes || 20}" min="0" max="120"
                       class="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center focus:ring-2 focus:ring-feu-green/30 focus:border-feu-green outline-none">
            </div>
            <div>
                <label class="text-xs text-gray-500 block mb-1">Absent After (min)</label>
                <input type="number" id="swal-absent" value="${schedule.absent_threshold_minutes || 60}" min="0" max="240"
                       class="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center focus:ring-2 focus:ring-feu-green/30 focus:border-feu-green outline-none">
            </div>
        </div>`;
    formHtml += '</div>';

    const result = await Swal.fire({
        title: `Edit: ${section}`,
        html: formHtml,
        width: 420,
        showCancelButton: true,
        confirmButtonText: 'Save Changes',
        confirmButtonColor: '#0a8249',
        preConfirm: () => {
            const weekly_schedule = {};
            days.forEach(day => {
                const start = document.getElementById(`swal-${day}-start`).value || null;
                const end = document.getElementById(`swal-${day}-end`).value || null;
                weekly_schedule[day] = { start, end };
            });
            const grace_period_minutes = parseInt(document.getElementById('swal-grace').value) || 20;
            const absent_threshold_minutes = parseInt(document.getElementById('swal-absent').value) || 60;
            return { weekly_schedule, grace_period_minutes, absent_threshold_minutes };
        }
    });

    if (!result.isConfirmed || !result.value) return;

    try {
        const res = await fetch(`/api/schedules/${encodeURIComponent(section)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(result.value)
        });
        const data = await res.json();

        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: 'Schedule Updated',
                text: `${section} schedule has been saved`,
                timer: 1500,
                showConfirmButton: false
            });
            schedulesData = null; // Clear cache
            loadTeacherSchedules(); // Reload
        } else {
            throw new Error(data.error || 'Failed to save');
        }
    } catch (err) {
        Swal.fire({
            icon: 'error',
            title: 'Save Failed',
            text: err.message,
            confirmButtonColor: '#0a8249'
        });
    }
}

// ========================================
// ROSTER: Load + Render
// Backend: GET /api/students/section/:section
// ========================================
async function loadRoster() {
    // Use cached data if available
    if (rosterData) {
        renderRoster();
        return;
    }

    const section = currentSection;

    // Build sections string (comma-separated)
    let sections = section;
    if (!sections) {
        const userSections = currentUser?.sections_handled || [];
        sections = userSections.join(',');
    }

    if (!sections) {
        rosterData = [];
        renderRoster();
        return;
    }

    try {
        const res = await fetch(`/api/students/section/${encodeURIComponent(sections)}`, { credentials: 'include' });
        const json = await res.json();
        if (json.success) {
            // Sort alphabetically by name
            rosterData = (json.data || []).sort((a, b) => a.name.localeCompare(b.name));
        } else {
            rosterData = [];
        }
    } catch (err) {
        console.error('[ROSTER] Failed to load:', err);
        rosterData = [];
    }

    renderRoster();
}

function renderRoster() {
    const tbody = document.getElementById('roster-table');
    const cards = document.getElementById('roster-cards');
    const emptyEl = document.getElementById('roster-empty');
    const countEl = document.getElementById('roster-count');
    const searchEl = document.getElementById('roster-search');
    
    if (!rosterData || rosterData.length === 0) {
        tbody.innerHTML = '';
        cards.innerHTML = '';
        emptyEl.classList.remove('hidden');
        countEl.textContent = '0 students';
        return;
    }

    emptyEl.classList.add('hidden');

    // Apply search filter
    const query = (searchEl?.value || '').toLowerCase().trim();
    let filtered = rosterData;
    if (query) {
        filtered = rosterData.filter(s => 
            s.name.toLowerCase().includes(query) ||
            (s.tamtap_id || '').toLowerCase().includes(query) ||
            (s.section || '').toLowerCase().includes(query)
        );
    }

    // Apply sorting
    filtered = sortRosterData(filtered);

    countEl.textContent = query 
        ? `${filtered.length} of ${rosterData.length} students` 
        : `${rosterData.length} students`;

    // Build a lookup of today's attendance by nfc_id
    const attendanceMap = {};
    currentRecords.forEach(r => {
        if (r.nfc_id) attendanceMap[r.nfc_id] = r;
    });

    // Desktop table
    tbody.innerHTML = filtered.map((s, i) => {
        const att = attendanceMap[s.nfc_id];
        const statusHtml = att
            ? `<span class="status-dot ${getStatusDotClass(att.status)} mr-1"></span><span class="text-xs">${att.status || 'present'}</span>`
            : `<span class="w-2.5 h-2.5 rounded-full bg-gray-300 inline-block mr-1"></span><span class="text-xs text-gray-400">No tap</span>`;
        return `
        <tr class="clickable-row hover:bg-gray-50 cursor-pointer" onclick="showStudentHistory('${s.nfc_id}', '${escapeHtml(s.name)}')">
            <td class="px-3 lg:px-4 py-2 lg:py-3 text-center text-xs text-gray-400">${i + 1}</td>
            <td class="px-3 lg:px-4 py-2 lg:py-3 text-sm font-medium text-gray-900">${escapeHtml(s.name)}</td>
            <td class="px-3 lg:px-4 py-2 lg:py-3 hidden md:table-cell">
                <span class="bg-feu-green/10 text-feu-green px-2 py-0.5 rounded text-xs">${s.section || '--'}</span>
            </td>
            <td class="px-3 lg:px-4 py-2 lg:py-3 hidden lg:table-cell text-xs text-gray-500 font-mono">${s.tamtap_id || '--'}</td>
            <td class="px-3 lg:px-4 py-2 lg:py-3 text-center">${statusHtml}</td>
            <td class="px-3 lg:px-4 py-2 lg:py-3 text-center">
                <button onclick="event.stopPropagation(); showStudentHistory('${s.nfc_id}', '${escapeHtml(s.name)}')" 
                        class="text-feu-green hover:text-feu-green-dark text-xs font-medium">
                    <i class="fas fa-history mr-0.5"></i> View
                </button>
            </td>
        </tr>`;
    }).join('');

    // Mobile cards
    cards.innerHTML = filtered.map(s => {
        const att = attendanceMap[s.nfc_id];
        const statusHtml = att
            ? `<span class="status-dot ${getStatusDotClass(att.status)} mr-1"></span><span class="text-xs">${att.status || 'present'}</span>`
            : `<span class="w-2.5 h-2.5 rounded-full bg-gray-300 inline-block mr-1"></span><span class="text-xs text-gray-400">No tap</span>`;
        return `
        <div class="p-3 hover:bg-gray-50 cursor-pointer" onclick="showStudentHistory('${s.nfc_id}', '${escapeHtml(s.name)}')">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-feu-green/10 flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-user text-feu-green text-sm"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-gray-900 truncate">${escapeHtml(s.name)}</p>
                    <div class="flex items-center gap-2 mt-0.5">
                        ${statusHtml}
                        <span class="text-[10px] text-gray-400 ml-1">${s.section || ''}</span>
                    </div>
                </div>
                <i class="fas fa-chevron-right text-gray-300 text-xs"></i>
            </div>
        </div>`;
    }).join('');
}

function searchRoster(query) {
    renderRoster();
}

// ========================================
// ROSTER SORTING
// ========================================
function setRosterSort(field) {
    if (rosterSort.field === field) {
        // Toggle direction
        rosterSort.dir = rosterSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        rosterSort.field = field;
        rosterSort.dir = 'asc';
    }
    updateSortUI();
    renderRoster();
}

function updateSortUI() {
    const fields = ['name', 'tamtap_id', 'status'];
    fields.forEach(f => {
        const btn = document.getElementById(`sort-btn-${f}`);
        const icon = document.getElementById(`sort-icon-${f}`);
        const thIcon = document.getElementById(`th-icon-${f}`);
        const isActive = rosterSort.field === f;

        // Header buttons
        if (btn) {
            btn.className = isActive
                ? 'px-2 py-1 rounded-md text-[10px] sm:text-xs font-medium transition bg-white text-feu-green shadow-sm'
                : 'px-2 py-1 rounded-md text-[10px] sm:text-xs font-medium transition text-gray-500 hover:bg-gray-200';
        }
        if (icon) {
            icon.classList.toggle('hidden', !isActive);
            if (isActive) icon.className = `fas ${getSortIconClass(f)} text-[9px] ml-0.5`;
        }

        // Table header icons
        if (thIcon) {
            thIcon.classList.toggle('hidden', !isActive);
            if (isActive) thIcon.className = `fas ${getSortIconClass(f)} text-feu-green text-[9px] ml-0.5`;
        }
    });
}

function getSortIconClass(field) {
    const asc = rosterSort.dir === 'asc';
    if (field === 'name') return asc ? 'fa-arrow-up-a-z' : 'fa-arrow-down-z-a';
    if (field === 'tamtap_id') return asc ? 'fa-arrow-up-1-9' : 'fa-arrow-down-9-1';
    return asc ? 'fa-arrow-up' : 'fa-arrow-down';
}

function sortRosterData(data) {
    const { field, dir } = rosterSort;
    const mult = dir === 'asc' ? 1 : -1;

    // Build attendance lookup for status sorting
    const attendanceMap = {};
    currentRecords.forEach(r => {
        if (r.nfc_id) attendanceMap[r.nfc_id] = r;
    });

    const statusOrder = { 'present': 1, 'on-time': 1, 'late': 2, 'absent': 3, 'excused': 4 };

    return [...data].sort((a, b) => {
        if (field === 'name') {
            return mult * a.name.localeCompare(b.name);
        }
        if (field === 'tamtap_id') {
            const idA = parseInt((a.tamtap_id || '0').replace(/\D/g, '')) || 0;
            const idB = parseInt((b.tamtap_id || '0').replace(/\D/g, '')) || 0;
            return mult * (idA - idB);
        }
        if (field === 'status') {
            const attA = attendanceMap[a.nfc_id];
            const attB = attendanceMap[b.nfc_id];
            const sA = attA ? (statusOrder[attA.status] || 5) : 99;
            const sB = attB ? (statusOrder[attB.status] || 5) : 99;
            return mult * (sA - sB);
        }
        return 0;
    });
}

// ========================================
// NOT YET TAPPED: Render
// Cross-references roster vs currentRecords
// ========================================
function renderNotTapped() {
    const tbody = document.getElementById('not-tapped-table');
    const cards = document.getElementById('not-tapped-cards');
    const emptyEl = document.getElementById('not-tapped-empty');
    const countEl = document.getElementById('not-tapped-count');
    const noticeEl = document.getElementById('not-tapped-date-notice');

    // Show date notice if not viewing today
    const isToday = currentDateRange === 'today';
    if (noticeEl) noticeEl.classList.toggle('hidden', isToday);

    if (!rosterData || rosterData.length === 0) {
        tbody.innerHTML = '';
        cards.innerHTML = '';
        emptyEl.classList.remove('hidden');
        countEl.textContent = '-- students pending';
        return;
    }

    // Build set of nfc_ids that have tapped (from current records)
    const tappedIds = new Set();
    currentRecords.forEach(r => {
        if (r.nfc_id) tappedIds.add(r.nfc_id);
    });

    // Filter roster to students NOT in tappedIds
    const notTapped = rosterData.filter(s => !tappedIds.has(s.nfc_id));

    countEl.textContent = `${notTapped.length} of ${rosterData.length} students haven't tapped${isToday ? ' today' : ''}`;

    if (notTapped.length === 0) {
        tbody.innerHTML = '';
        cards.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
    }

    emptyEl.classList.add('hidden');

    // Desktop table
    tbody.innerHTML = notTapped.map((s, i) => `
        <tr class="clickable-row hover:bg-gray-50 cursor-pointer" onclick="showStudentHistory('${s.nfc_id}', '${escapeHtml(s.name)}')">
            <td class="px-3 lg:px-4 py-2 lg:py-3 text-center text-xs text-gray-400">${i + 1}</td>
            <td class="px-3 lg:px-4 py-2 lg:py-3 text-sm font-medium text-gray-900">${escapeHtml(s.name)}</td>
            <td class="px-3 lg:px-4 py-2 lg:py-3 hidden md:table-cell">
                <span class="bg-feu-green/10 text-feu-green px-2 py-0.5 rounded text-xs">${s.section || '--'}</span>
            </td>
            <td class="px-3 lg:px-4 py-2 lg:py-3 hidden lg:table-cell text-xs text-gray-500 font-mono">${s.tamtap_id || '--'}</td>
            <td class="px-3 lg:px-4 py-2 lg:py-3 text-center">
                <button onclick="event.stopPropagation(); showStudentHistory('${s.nfc_id}', '${escapeHtml(s.name)}')" 
                        class="text-feu-green hover:text-feu-green-dark text-xs font-medium">
                    <i class="fas fa-history mr-0.5"></i> View
                </button>
            </td>
        </tr>
    `).join('');

    // Mobile cards
    cards.innerHTML = notTapped.map(s => `
        <div class="p-3 hover:bg-gray-50 cursor-pointer" onclick="showStudentHistory('${s.nfc_id}', '${escapeHtml(s.name)}')">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-user-clock text-red-400 text-sm"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-gray-900 truncate">${escapeHtml(s.name)}</p>
                    <div class="flex items-center gap-2 mt-0.5">
                        <span class="w-2.5 h-2.5 rounded-full bg-gray-300 inline-block mr-1"></span>
                        <span class="text-xs text-gray-400">No tap</span>
                        <span class="text-[10px] text-gray-400 ml-1">${s.section || ''}</span>
                    </div>
                </div>
                <i class="fas fa-chevron-right text-gray-300 text-xs"></i>
            </div>
        </div>
    `).join('');
}

function renderTable(records) {
    const tbody = document.getElementById('attendance-table');
    document.getElementById('empty-state').classList.add('hidden');
    
    // Also render mobile cards
    renderMobileCards(records);
    
    tbody.innerHTML = records.map(r => `
        <tr class="clickable-row" onclick="showStudentHistory('${r.nfc_id}', '${escapeHtml(r.name)}')">
            <td class="px-3 lg:px-4 py-2 lg:py-3 text-center">
                ${getPhotoThumbnail(r)}
            </td>
            <td class="px-3 lg:px-4 py-2 lg:py-3 text-sm font-medium text-gray-900">${escapeHtml(r.name)}</td>
            <td class="px-3 lg:px-4 py-2 lg:py-3 text-center">
                <span class="status-dot ${getStatusDotClass(r.status)}" title="${r.status || 'present'}"></span>
            </td>
            <td class="px-3 lg:px-4 py-2 lg:py-3 text-sm text-gray-600">${r.time || '--'}</td>
            <td class="px-3 lg:px-4 py-2 lg:py-3 hidden md:table-cell">
                <span class="px-2 py-1 rounded text-xs ${r.session === 'AM' ? 'bg-yellow-100 text-yellow-700' : 'bg-indigo-100 text-indigo-700'}">
                    ${r.session || '--'}
                </span>
            </td>
            <td class="px-3 lg:px-4 py-2 lg:py-3 hidden lg:table-cell">
                <span class="bg-feu-green/10 text-feu-green px-2 py-0.5 rounded text-xs">${r.section || '--'}</span>
            </td>
            <td class="px-3 lg:px-4 py-2 lg:py-3 text-center">
                ${(r.status === 'present' || r.status === 'late') && canMarkAttendance(r.section) ? `
                    <button onclick="event.stopPropagation(); markExcused('${r.nfc_id}', '${escapeHtml(r.name)}')"
                            class="text-[#2664EB] hover:bg-blue-50 p-1.5 rounded-lg transition" title="Mark Excused">
                        <i class="fas fa-calendar-check text-xs"></i>
                    </button>` : ''}
            </td>
        </tr>
    `).join('');
}

// ========================================
// PHOTO HELPER FUNCTIONS
// ========================================
function getPhotoUrl(record) {
    // Photo path: /photos/{date}/{filename}
    // Record has: date (YYYY-MM-DD HH:MM:SS), photo (filename)
    if (!record.photo) return null;
    const dateStr = record.date ? record.date.split(' ')[0] : getPhilippineDate();
    return `/photos/${dateStr}/${record.photo}`;
}

function getPhotoThumbnail(record) {
    const photoUrl = getPhotoUrl(record);
    if (!photoUrl) {
        return `<div class="w-10 h-10 lg:w-12 lg:h-12 rounded-lg bg-gray-200 flex items-center justify-center mx-auto">
            <i class="fas fa-user text-gray-400 text-sm lg:text-base"></i>
        </div>`;
    }
    return `<img src="${photoUrl}" 
                 alt="${escapeHtml(record.name)}" 
                 class="w-10 h-10 lg:w-12 lg:h-12 rounded-lg object-cover mx-auto cursor-pointer hover:ring-2 hover:ring-feu-green transition shadow-sm"
                 onclick="event.stopPropagation(); showPhotoModal('${escapeHtml(record.name)}', '${photoUrl}', '${record.date || ''}', '${record.time || ''}')"
                 onerror="this.onerror=null; this.parentNode.innerHTML='<div class=\\'w-10 h-10 lg:w-12 lg:h-12 rounded-lg bg-gray-200 flex items-center justify-center mx-auto\\'><i class=\\'fas fa-user text-gray-400 text-sm lg:text-base\\'></i></div>'">`;
}

// ========================================
// MOBILE CARDS RENDERING
// ========================================
function renderMobileCards(records) {
    const container = document.getElementById('attendance-cards');
    if (!container) return;
    
    container.innerHTML = records.map(r => {
        const photoUrl = getPhotoUrl(r);
        const photoHtml = photoUrl 
            ? `<img src="${photoUrl}" alt="${escapeHtml(r.name)}" class="w-12 h-12 rounded-lg object-cover shadow-sm" onerror="this.onerror=null; this.src=''; this.className='hidden'; this.nextElementSibling.classList.remove('hidden');">
               <div class="hidden w-12 h-12 rounded-lg bg-gray-200 flex items-center justify-center"><i class="fas fa-user text-gray-400"></i></div>`
            : `<div class="w-12 h-12 rounded-lg bg-gray-200 flex items-center justify-center"><i class="fas fa-user text-gray-400"></i></div>`;
        
        return `
        <div class="p-3 hover:bg-gray-50 cursor-pointer" onclick="showStudentHistory('${r.nfc_id}', '${escapeHtml(r.name)}')">
            <div class="flex items-center gap-3">
                <div class="flex-shrink-0" onclick="event.stopPropagation(); ${photoUrl ? `showPhotoModal('${escapeHtml(r.name)}', '${photoUrl}', '${r.date || ''}', '${r.time || ''}')` : ''}">
                    ${photoHtml}
                </div>
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-gray-900 truncate">${escapeHtml(r.name)}</p>
                    <div class="flex items-center gap-2 mt-0.5">
                        <span class="status-dot ${getStatusDotClass(r.status)}"></span>
                        <span class="text-xs text-gray-500">${r.time || '--'}</span>
                        <span class="px-1.5 py-0.5 rounded text-[10px] ${r.session === 'AM' ? 'bg-yellow-100 text-yellow-700' : 'bg-indigo-100 text-indigo-700'}">${r.session || '--'}</span>
                    </div>
                </div>
                <div class="flex-shrink-0 flex items-center gap-1.5">
                    <span class="bg-feu-green/10 text-feu-green px-2 py-0.5 rounded text-xs">${r.section || '--'}</span>
                    ${(r.status === 'present' || r.status === 'late') && canMarkAttendance(r.section) ? `
                        <button onclick="event.stopPropagation(); markExcused('${r.nfc_id}', '${escapeHtml(r.name)}')"
                                class="text-[#2664EB] hover:bg-blue-50 p-1.5 rounded-lg transition" title="Mark Excused">
                            <i class="fas fa-calendar-check text-xs"></i>
                        </button>` : ''}
                </div>
            </div>
        </div>`;
    }).join('');
}

function addRecordToTable(record, prepend = false) {
    const tbody = document.getElementById('attendance-table');
    const cards = document.getElementById('attendance-cards');
    document.getElementById('empty-state').classList.add('hidden');
    
    // Ensure table and mobile cards are visible (not hidden by skeleton state)
    if (tbody) tbody.classList.remove('hidden');
    if (cards) cards.classList.remove('hidden');
    
    const row = document.createElement('tr');
    row.className = 'clickable-row fade-in';
    row.onclick = () => showStudentHistory(record.nfc_id, record.name);
    row.innerHTML = `
        <td class="px-3 lg:px-4 py-2 lg:py-3 text-center">
            ${getPhotoThumbnail(record)}
        </td>
        <td class="px-3 lg:px-4 py-2 lg:py-3 text-sm font-medium text-gray-900">${escapeHtml(record.name)}</td>
        <td class="px-3 lg:px-4 py-2 lg:py-3 text-center">
            <span class="status-dot ${getStatusDotClass(record.status)}" title="${record.status || 'present'}"></span>
        </td>
        <td class="px-3 lg:px-4 py-2 lg:py-3 text-sm text-gray-600">${record.time || '--'}</td>
        <td class="px-3 lg:px-4 py-2 lg:py-3 hidden md:table-cell">
            <span class="px-2 py-1 rounded text-xs ${record.session === 'AM' ? 'bg-yellow-100 text-yellow-700' : 'bg-indigo-100 text-indigo-700'}">
                ${record.session || '--'}
            </span>
        </td>
        <td class="px-3 lg:px-4 py-2 lg:py-3 hidden lg:table-cell">
            <span class="bg-feu-green/10 text-feu-green px-2 py-0.5 rounded text-xs">${record.section || '--'}</span>
        </td>
        <td class="px-3 lg:px-4 py-2 lg:py-3 text-center">
            ${(record.status === 'present' || record.status === 'late') && canMarkAttendance(record.section) ? `
                <button onclick="event.stopPropagation(); markExcused('${record.nfc_id}', '${escapeHtml(record.name)}')"
                        class="text-[#2664EB] hover:bg-blue-50 p-1.5 rounded-lg transition" title="Mark Excused">
                    <i class="fas fa-calendar-check text-xs"></i>
                </button>` : ''}
        </td>
    `;
    
    if (prepend) {
        tbody.insertBefore(row, tbody.firstChild);
        currentRecords.unshift(record);
    } else {
        tbody.appendChild(row);
        currentRecords.push(record);
    }
    
    // Also update mobile cards
    renderMobileCards(currentRecords);
    
    document.getElementById('record-count').textContent = `${currentRecords.length} records`;
}

// ========================================
// STATUS DOT CLASS
// Based strictly on status field from API
// ========================================
function getStatusDotClass(status) {
    switch (status) {
        case 'present': return 'status-present';
        case 'late': return 'status-late';
        case 'absent': return 'status-absent';
        case 'excused': return 'status-excused';
        default: return 'status-unknown'; // Unknown or missing status
    }
}

// ========================================
// LOAD STATS
// Backend: GET /api/stats (general stats)
//          GET /api/stats/summary (breakdown)
// Respects academic calendar status
// ========================================
async function loadStats() {
    console.log('[DEBUG] loadStats started');
    try {
        // Get current filters
        const section = currentSection;
        const today = getPhilippineDate();
        
        // Build summary URL with filters
        let summaryUrl = `/api/stats/summary?date=${today}`;
        if (section) {
            summaryUrl += `&section=${encodeURIComponent(section)}`;
        } else {
            const sections = currentUser?.sections_handled || [];
            if (sections.length > 0) {
                summaryUrl += `&sections=${encodeURIComponent(sections.join(','))}`;
            }
        }
        
        console.log('[DEBUG] Fetching stats from:', summaryUrl);
        
        // Fetch summary stats (section-filtered, includes totalStudents)
        const summaryRes = await fetch(summaryUrl, { credentials: 'include' });
        
        console.log('[DEBUG] Summary response:', summaryRes.status);
        
        const summaryData = await summaryRes.json();
        
        console.log('[DEBUG] Summary:', summaryData.success);
        
        // Check calendar status first
        if (summaryData.success && summaryData.isInstructional === false) {
            // Non-instructional day - show special state
            // Still update total students from summary (section-scoped)
            const totalStudents = document.getElementById('total-students');
            if (totalStudents) totalStudents.textContent = summaryData.stats?.totalStudents || 0;
            showNonInstructionalDay(summaryData.calendarLabel, summaryData.calendarReason);
            return;
        }
        
        // Hide any calendar notice
        hideCalendarNotice();
        
        // Summary stats (breakdown)
        if (summaryData.success && summaryData.stats) {
            const summary = summaryData.stats;
            
            // Update total students (section-scoped from summary)
            const totalStudents = document.getElementById('total-students');
            if (totalStudents) totalStudents.textContent = summary.totalStudents || 0;
            
            // Update counts
            document.getElementById('count-ontime').textContent = summary.onTime;
            document.getElementById('count-late').textContent = summary.late;
            document.getElementById('count-absent').textContent = summary.absent;
            
            // Update attendance rate from summary (section-specific)
            const rate = summary.attendanceRate || 0;
            document.getElementById('attendance-rate').textContent = `${rate}%`;
            document.getElementById('attendance-bar').style.width = `${rate}%`;
            
            // Enable summary cards
            breakdownAvailable = true;
            document.getElementById('summary-cards').classList.remove('card-disabled');
            document.getElementById('summary-unavailable').classList.add('hidden');
            document.getElementById('breakdown-notice').classList.add('hidden');
        } else {
            // Summary endpoint failed - show graceful degradation
            breakdownAvailable = false;
            showBreakdownUnavailable();
        }
        
    } catch (e) {
        console.error('[ERROR] Load stats failed:', e);
        showStatsUnavailable();
    }
}

// ========================================
// CALENDAR STATUS DISPLAY
// Shows when day is non-instructional
// ========================================
function showNonInstructionalDay(label, reason) {
    // Update breakdown notice with calendar info
    const notice = document.getElementById('breakdown-notice');
    notice.innerHTML = `
        <i class="fas fa-calendar-xmark mr-2"></i>
        <span class="font-semibold">${escapeHtml(label)}</span>
        ${reason ? `<span class="ml-2 opacity-80">- ${escapeHtml(reason)}</span>` : ''}
    `;
    notice.classList.remove('hidden');
    
    // Show N/A on summary cards
    document.getElementById('count-ontime').textContent = 'N/A';
    document.getElementById('count-late').textContent = 'N/A';
    document.getElementById('count-absent').textContent = 'N/A';
    document.getElementById('attendance-rate').textContent = 'N/A';
    document.getElementById('attendance-bar').style.width = '0%';
    
    // Disable cards with reduced opacity
    document.getElementById('summary-cards').classList.add('card-disabled');
    
    // Show unavailable banner with calendar-specific message
    const unavailable = document.getElementById('summary-unavailable');
    unavailable.innerHTML = `
        <i class="fas fa-info-circle text-blue-600 mr-2"></i>
        <span class="text-blue-700 text-sm">
            <strong>${escapeHtml(label)}</strong> - Attendance is not recorded on this day.
            ${reason ? `<br><span class="text-blue-500">${escapeHtml(reason)}</span>` : ''}
        </span>
    `;
    unavailable.className = 'bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 text-center';
    unavailable.classList.remove('hidden');
}

function hideCalendarNotice() {
    const unavailable = document.getElementById('summary-unavailable');
    unavailable.className = 'hidden bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 text-center';
}

function showBreakdownUnavailable() {
    // Show placeholder with clear messaging
    document.getElementById('count-ontime').textContent = 'N/A';
    document.getElementById('count-late').textContent = 'N/A';
    document.getElementById('count-absent').textContent = 'N/A';
    document.getElementById('summary-cards').classList.add('card-disabled');
    document.getElementById('summary-unavailable').classList.remove('hidden');
    document.getElementById('breakdown-notice').classList.remove('hidden');
}

function showStatsUnavailable() {
    document.getElementById('total-students').textContent = '--';
    document.getElementById('attendance-rate').textContent = '--%';
    document.getElementById('attendance-bar').style.width = '0%';
    showBreakdownUnavailable();
}

function updateStats() {
    // Re-fetch stats when new attendance comes in
    loadStats();
}

// ========================================
// STUDENT DETAIL MODAL
// Backend: GET /api/attendance/student/:nfc_id
// Shows summary cards + attendance history
// ========================================
async function showStudentHistory(nfcId, name) {
    // Store current student for export
    currentStudentNfcId = nfcId;
    currentStudentName = name;

    // Open the new detail modal
    document.getElementById('detail-student-name').textContent = name;
    document.getElementById('detail-student-section').textContent = 'Loading...';
    document.getElementById('detail-records').innerHTML = '<tr><td colspan="4" class="px-3 py-10 text-center"><img src="/assets/animations/tamtap-walk.gif" alt="Loading..." class="w-12 h-12 mx-auto mb-2"><span class="text-gray-400 text-sm">Loading history...</span></td></tr>';
    
    // Reset summary
    ['detail-total', 'detail-present', 'detail-late', 'detail-absent', 'detail-excused', 'detail-rate'].forEach(id => {
        document.getElementById(id).textContent = '--';
    });
    
    document.getElementById('student-detail-modal').classList.remove('hidden');
    document.getElementById('student-detail-modal').classList.add('flex');
    
    try {
        const res = await fetch(`/api/attendance/student/${nfcId}`, { credentials: 'include' });
        const data = await res.json();
        
        if (!data.success) {
            document.getElementById('detail-records').innerHTML = `
                <tr><td colspan="4" class="px-3 py-8 text-center text-red-400">
                    <i class="fas fa-exclamation-circle text-2xl mb-2"></i><br>
                    ${data.error || 'Failed to load'}
                </td></tr>`;
            return;
        }
        
        // Update student info
        if (data.student) {
            document.getElementById('detail-student-name').textContent = data.student.name;
            document.getElementById('detail-student-section').textContent = `${data.student.grade || ''} ${data.student.section}`.trim();
        }
        
        // Update summary cards
        if (data.summary) {
            document.getElementById('detail-total').textContent = data.summary.totalDays;
            document.getElementById('detail-present').textContent = data.summary.present;
            document.getElementById('detail-late').textContent = data.summary.late;
            document.getElementById('detail-absent').textContent = data.summary.absent;
            document.getElementById('detail-excused').textContent = data.summary.excused;
            document.getElementById('detail-rate').textContent = `${data.summary.attendanceRate}%`;
        }
        
        // Render records
        if (!data.records || data.records.length === 0) {
            document.getElementById('detail-records').innerHTML = `
                <tr><td colspan="4" class="px-3 py-8 text-center text-gray-400">
                    <i class="fas fa-inbox text-2xl mb-2"></i><br>No attendance records
                </td></tr>`;
            return;
        }
        
        document.getElementById('detail-records').innerHTML = data.records.map(r => {
            const dateStr = r.date ? r.date.split(' ')[0] : '--';
            const photoUrl = r.photo ? `/photos/${dateStr}/${r.photo}` : null;
            
            return `
                <tr class="hover:bg-gray-50">
                    <td class="px-2 sm:px-3 py-2 text-gray-700">${dateStr}</td>
                    <td class="px-2 sm:px-3 py-2 text-gray-600">${r.time || '--'}</td>
                    <td class="px-2 sm:px-3 py-2 text-center">
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${getStatusBadgeClass(r.status)}">
                            <span class="status-dot ${getStatusDotClass(r.status)}"></span>
                            <span class="hidden sm:inline">${r.status || 'present'}</span>
                        </span>
                    </td>
                    <td class="px-2 sm:px-3 py-2 text-center">
                        ${photoUrl 
                            ? `<button onclick="event.stopPropagation(); showPhotoModal('${escapeHtml(data.student?.name || name)}', '${photoUrl}', '${r.date}', '${r.time}')" class="text-feu-green hover:text-feu-green-dark"><i class="fas fa-image"></i></button>`
                            : `<span class="text-gray-300"><i class="fas fa-image"></i></span>`
                        }
                    </td>
                </tr>`;
        }).join('');
        
    } catch (e) {
        console.error('[ERROR] Load student detail failed:', e);
        document.getElementById('detail-records').innerHTML = `
            <tr><td colspan="4" class="px-3 py-8 text-center text-red-400">
                <i class="fas fa-exclamation-circle text-2xl mb-2"></i><br>Failed to load history
            </td></tr>`;
    }
}

function getStatusBadgeClass(status) {
    switch (status) {
        case 'present': return 'bg-green-100 text-green-700';
        case 'late': return 'bg-yellow-100 text-yellow-700';
        case 'absent': return 'bg-gray-200 text-gray-700';
        case 'excused': return 'bg-blue-100 text-[#2664EB]';
        default: return 'bg-gray-100 text-gray-600';
    }
}

function closeStudentDetailModal() {
    const modal = document.getElementById('student-detail-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

// Legacy alias for backward compatibility
function closeHistoryModal() {
    closeStudentDetailModal();
}

// ========================================
// PHOTO MODAL
// Displays attendance photo in larger view
// ========================================
function showPhotoModal(name, photoUrl, date, time) {
    const modal = document.getElementById('photo-modal');
    const img = document.getElementById('photo-modal-image');
    const loading = document.getElementById('photo-loading');
    const details = document.getElementById('photo-details');
    
    // Set student name
    document.getElementById('photo-student-name').textContent = name;
    
    // Show loading spinner
    loading.classList.remove('hidden');
    img.classList.add('opacity-0');
    
    // Set image source
    img.src = photoUrl;
    
    // Handle image load
    img.onload = function() {
        loading.classList.add('hidden');
        img.classList.remove('opacity-0');
    };
    
    // Handle image error
    img.onerror = function() {
        loading.innerHTML = '<i class="fas fa-image text-3xl text-gray-400"></i><p class="text-sm text-gray-500 mt-2">Photo not available</p>';
    };
    
    // Set details
    const dateDisplay = date ? date.split(' ')[0] : 'Unknown date';
    const timeDisplay = time || 'Unknown time';
    details.innerHTML = `
        <p><i class="fas fa-calendar text-feu-green mr-1.5"></i> ${dateDisplay}</p>
        <p class="mt-1"><i class="fas fa-clock text-feu-green mr-1.5"></i> ${timeDisplay}</p>
    `;
    
    // Show modal
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closePhotoModal() {
    const modal = document.getElementById('photo-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    
    // Reset image
    document.getElementById('photo-modal-image').src = '';
    document.getElementById('photo-loading').classList.remove('hidden');
    document.getElementById('photo-loading').innerHTML = '<img src="/assets/animations/tamtap-walk.gif" alt="Loading..." class="w-16 h-16 sm:w-20 sm:h-20"><p class="text-sm text-feu-green mt-2">Loading photo...</p>';
}

// ========================================
// PERSONAL INFO MODAL
// Backend: GET /api/auth/me
// ========================================
function showPersonalInfo() {
    closeSettingsMenu();
    
    const content = document.getElementById('personal-content');
    content.innerHTML = `
        <div class="space-y-4">
            <div class="flex items-center gap-4 pb-4 border-b">
                <div class="bg-feu-green text-white w-16 h-16 rounded-full flex items-center justify-center">
                    <i class="fas fa-user text-2xl"></i>
                </div>
                <div>
                    <p class="font-semibold text-lg text-gray-800">${escapeHtml(currentUser.name)}</p>
                    <p class="text-sm text-feu-green">${currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1)}</p>
                </div>
            </div>
            <div>
                <p class="text-xs text-gray-500 uppercase mb-1">Username</p>
                <p class="text-gray-800">${escapeHtml(currentUser.username)}</p>
            </div>
            ${currentUser.email ? `
            <div>
                <p class="text-xs text-gray-500 uppercase mb-1">Email</p>
                <p class="text-gray-800">${escapeHtml(currentUser.email)}</p>
            </div>
            ` : ''}
            <div>
                <p class="text-xs text-gray-500 uppercase mb-1">Sections Handled</p>
                <div class="flex flex-wrap gap-2">
                    ${(currentUser.sections_handled || []).map(s => 
                        `<span class="bg-feu-green/10 text-feu-green px-3 py-1 rounded-full text-sm">${escapeHtml(s)}</span>`
                    ).join('') || '<span class="text-gray-400">None assigned</span>'}
                </div>
            </div>
        </div>
    `;
    
    document.getElementById('personal-modal').classList.remove('hidden');
    document.getElementById('personal-modal').classList.add('flex');
}

function closePersonalModal() {
    document.getElementById('personal-modal').classList.add('hidden');
    document.getElementById('personal-modal').classList.remove('flex');
}

// ========================================
// HELP CENTER
// ========================================
function showHelpCenter() {
    closeSettingsMenu();
    Swal.fire({
        title: 'Help Center',
        html: `
            <div class="text-left text-sm space-y-3">
                <p><strong>TAMTAP</strong> is an NFC-based attendance tracking system.</p>
                <p><i class="fas fa-check-circle text-green-600 mr-2"></i>View attendance for your assigned sections</p>
                <p><i class="fas fa-check-circle text-green-600 mr-2"></i>Click on a student row to view their history</p>
                <p><i class="fas fa-check-circle text-green-600 mr-2"></i>Export attendance data to CSV</p>
                <p><i class="fas fa-check-circle text-green-600 mr-2"></i>Real-time updates via Socket.IO</p>
                <hr class="my-3">
                <p class="text-gray-500">For account issues, contact your administrator.</p>
            </div>
        `,
        confirmButtonColor: '#006A4E',
        confirmButtonText: 'Got it!'
    });
}

// ========================================
// SETTINGS MENU
// ========================================
function toggleSettingsMenu() {
    const menu = document.getElementById('settings-menu');
    menu.classList.toggle('hidden');
    // Close notification dropdown if open
    document.getElementById('notification-dropdown').classList.add('hidden');
}

function closeSettingsMenu() {
    document.getElementById('settings-menu').classList.add('hidden');
}

// ========================================
// NOTIFICATION DROPDOWN
// ========================================
let notificationData = null;

async function loadNotificationCount() {
    try {
        const res = await fetch('/api/notifications/count', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success) {
            updateNotificationBadge(data.count);
        }
    } catch (e) {
        console.error('[ERROR] Load notification count:', e);
    }
}

function updateNotificationBadge(count) {
    const badge = document.getElementById('notification-badge');
    if (!badge) return;
    
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function toggleNotificationDropdown() {
    const dropdown = document.getElementById('notification-dropdown');
    const isHidden = dropdown.classList.contains('hidden');
    
    // Close settings menu
    document.getElementById('settings-menu').classList.add('hidden');
    
    if (isHidden) {
        dropdown.classList.remove('hidden');
        loadNotifications();
    } else {
        dropdown.classList.add('hidden');
    }
}

async function loadNotifications() {
    const loading = document.getElementById('notification-loading');
    const empty = document.getElementById('notification-empty');
    const list = document.getElementById('notification-list');
    const footer = document.getElementById('notification-footer');
    const dateEl = document.getElementById('notification-date');
    
    loading.classList.remove('hidden');
    empty.classList.add('hidden');
    list.innerHTML = '';
    footer.classList.add('hidden');
    
    try {
        const res = await fetch('/api/notifications/pending', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        
        notificationData = data;
        dateEl.textContent = data.date || 'Today';
        
        loading.classList.add('hidden');
        
        if (!data.data || data.data.length === 0 || data.count === 0) {
            empty.classList.remove('hidden');
            updateNotificationBadge(0);
            return;
        }
        
        // Build section groups
        let html = '';
        for (const group of data.data) {
            html += `
                <div class="border-b last:border-b-0">
                    <div class="px-3 py-2 bg-gray-100 font-semibold text-sm text-gray-700 flex justify-between items-center">
                        <span>${escapeHtml(group.section)}</span>
                        <span class="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">${group.count} pending</span>
                    </div>
                    <ul class="divide-y">
            `;
            
            for (const student of group.students) {
                html += `
                    <li class="px-3 py-2 hover:bg-gray-50 flex items-center justify-between gap-2">
                        <div class="flex-1 min-w-0">
                            <p class="font-medium text-gray-800 truncate text-sm">${escapeHtml(student.name)}</p>
                            <p class="text-xs text-gray-500">${escapeHtml(student.tamtap_id || 'No ID')}</p>
                        </div>
                        <div class="flex items-center gap-1">
                            <button data-action="mark-excused" data-nfc="${escapeHtml(student.nfc_id)}" data-name="${escapeHtml(student.name)}" 
                                    class="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 hover:bg-yellow-200 rounded transition"
                                    title="Mark as Excused">
                                <i class="fas fa-calendar-check"></i>
                            </button>
                            <button data-action="mark-absent" data-nfc="${escapeHtml(student.nfc_id)}" data-name="${escapeHtml(student.name)}" 
                                    class="px-2 py-1 text-xs bg-red-100 text-red-700 hover:bg-red-200 rounded transition"
                                    title="Confirm Absent">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </li>
                `;
            }
            
            html += '</ul></div>';
        }
        
        list.innerHTML = html;
        footer.classList.remove('hidden');
        document.getElementById('notification-count-text').textContent = `${data.count} students pending`;
        updateNotificationBadge(data.count);
        
    } catch (e) {
        console.error('[ERROR] Load notifications:', e);
        loading.classList.add('hidden');
        list.innerHTML = '<div class="p-4 text-center text-red-500"><i class="fas fa-exclamation-circle mr-2"></i>Failed to load</div>';
    }
}

async function refreshNotifications() {
    await loadNotifications();
    await loadNotificationCount();
}

async function markExcused(nfcId, name) {
    // Fetch valid reasons
    const { value: reason } = await Swal.fire({
        title: 'Mark as Excused',
        text: `Select reason for ${name}`,
        input: 'select',
        inputOptions: {
            'Medical': 'Medical',
            'Family Emergency': 'Family Emergency',
            'School Activity': 'School Activity',
            'Weather': 'Weather',
            'Transportation': 'Transportation',
            'Other': 'Other'
        },
        inputPlaceholder: 'Select a reason',
        showCancelButton: true,
        confirmButtonText: 'Mark Excused',
        confirmButtonColor: '#0a8249',
        inputValidator: (value) => {
            if (!value) return 'Please select a reason';
        }
    });
    
    if (!reason) return;
    
    // Optional note for "Other"
    let note = null;
    if (reason === 'Other') {
        const { value: noteInput } = await Swal.fire({
            title: 'Add Note',
            input: 'textarea',
            inputPlaceholder: 'Enter reason details...',
            showCancelButton: true,
            confirmButtonText: 'Continue',
            confirmButtonColor: '#0a8249'
        });
        note = noteInput;
    }
    
    try {
        const res = await fetch('/api/notifications/mark-excused', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ nfc_id: nfcId, reason, note })
        });
        
        if (res.status === 403) {
            const errData = await res.json();
            Swal.fire({
                icon: 'warning',
                title: 'Not Authorized',
                text: errData.error || 'Only the section adviser can mark attendance status',
                confirmButtonColor: '#0a8249'
            });
            return;
        }
        
        const data = await res.json();
        
        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: 'Marked Excused',
                text: `${name} has been marked as excused`,
                timer: 1500,
                showConfirmButton: false
            });
            refreshNotifications();
            refreshData(); // Refresh main dashboard
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: e.message || 'Failed to mark excused',
            confirmButtonColor: '#0a8249'
        });
    }
}

async function markAbsent(nfcId, name) {
    const result = await Swal.fire({
        title: 'Confirm Absent',
        text: `Mark ${name} as absent for today?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, Mark Absent',
        confirmButtonColor: '#dc2626',
        cancelButtonText: 'Cancel'
    });
    
    if (!result.isConfirmed) return;
    
    try {
        const res = await fetch('/api/notifications/mark-absent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ nfc_id: nfcId })
        });
        
        if (res.status === 403) {
            const errData = await res.json();
            Swal.fire({
                icon: 'warning',
                title: 'Not Authorized',
                text: errData.error || 'Only the section adviser can mark attendance status',
                confirmButtonColor: '#0a8249'
            });
            return;
        }
        
        const data = await res.json();
        
        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: 'Marked Absent',
                text: `${name} has been marked as absent`,
                timer: 1500,
                showConfirmButton: false
            });
            refreshNotifications();
            refreshData();
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: e.message || 'Failed to mark absent',
            confirmButtonColor: '#0a8249'
        });
    }
}

// Close menu when clicking outside
document.addEventListener('click', (e) => {
    const menu = document.getElementById('settings-menu');
    if (!e.target.closest('#settings-menu') && !e.target.closest('[onclick="toggleSettingsMenu()"]')) {
        menu.classList.add('hidden');
    }
    // Close notification dropdown
    const notifDropdown = document.getElementById('notification-dropdown');
    if (!e.target.closest('#notification-dropdown') && !e.target.closest('#notification-btn')) {
        notifDropdown.classList.add('hidden');
    }
    // Close export menu
    const exportMenu = document.getElementById('export-menu');
    if (!e.target.closest('#export-menu') && !e.target.closest('[onclick="toggleExportMenu()"]')) {
        exportMenu.classList.add('hidden');
    }
});

// ========================================
// CSV EXPORT
// ========================================
function sanitizeCsvCell(value) {
    if (typeof value !== 'string') return value;
    // Escape double-quotes by doubling them
    let safe = value.replace(/"/g, '""');
    // Prefix formula-trigger characters to prevent CSV injection
    if (/^[=+\-@\t\r]/.test(safe)) {
        safe = "'" + safe;
    }
    return safe;
}

function exportCSV() {
    if (currentRecords.length === 0) {
        Swal.fire({ 
            icon: 'warning', 
            title: 'No Data', 
            text: 'No records to export',
            confirmButtonColor: '#006A4E'
        });
        return;
    }
    
    const section = currentSection || 'all';
    const today = getPhilippineDate();
    
    const headers = ['Name', 'Section', 'Date', 'Time', 'Session', 'Status'];
    const rows = currentRecords.map(r => [
        sanitizeCsvCell(r.name),
        sanitizeCsvCell(r.section || ''),
        sanitizeCsvCell(r.date || ''),
        sanitizeCsvCell(r.time || ''),
        sanitizeCsvCell(r.session || ''),
        sanitizeCsvCell(r.status || 'present')
    ]);
    
    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance_${section}_${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'CSV exported!',
        showConfirmButton: false,
        timer: 2000
    });
    closeExportMenu();
}

// ========================================
// EXPORT MENU
// ========================================
function toggleExportMenu() {
    const menu = document.getElementById('export-menu');
    menu.classList.toggle('hidden');
}

function closeExportMenu() {
    document.getElementById('export-menu').classList.add('hidden');
}

// ========================================
// XLSX EXPORT (Backend)
// ========================================
async function exportXLSX() {
    closeExportMenu();
    
    const section = currentSection;
    const { from, to } = getDateRange();
    
    Swal.fire({
        title: 'Generating Excel...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    try {
        const params = new URLSearchParams({ from, to });
        if (section) params.append('section', section);
        
        const res = await fetch(`/api/export/xlsx?${params}`, { credentials: 'include' });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.message || 'Export failed');
        }
        
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `attendance_${section || 'all'}_${from}_to_${to}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: 'Excel exported!',
            showConfirmButton: false,
            timer: 2000
        });
    } catch (e) {
        console.error('[ERROR] XLSX export:', e);
        Swal.fire({
            icon: 'error',
            title: 'Export Failed',
            text: e.message || 'Failed to generate Excel file',
            confirmButtonColor: '#0a8249'
        });
    }
}

// ========================================
// PDF EXPORT (Backend)
// ========================================
async function exportPDF() {
    closeExportMenu();
    
    const section = currentSection;
    const { from, to } = getDateRange();
    
    Swal.fire({
        title: 'Generating PDF...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    try {
        const params = new URLSearchParams({ from, to });
        if (section) params.append('section', section);
        
        const res = await fetch(`/api/export/pdf?${params}`, { credentials: 'include' });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.message || 'Export failed');
        }
        
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `attendance_report_${section || 'all'}_${from}_to_${to}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: 'PDF exported!',
            showConfirmButton: false,
            timer: 2000
        });
    } catch (e) {
        console.error('[ERROR] PDF export:', e);
        Swal.fire({
            icon: 'error',
            title: 'Export Failed',
            text: e.message || 'Failed to generate PDF file',
            confirmButtonColor: '#0a8249'
        });
    }
}

// ========================================
// STUDENT EXPORT (XLSX / PDF)
// Backend: GET /api/export/student/:nfcId/xlsx|pdf
// ========================================
async function exportStudentXLSX() {
    if (!currentStudentNfcId) return;

    Swal.fire({
        title: 'Generating Excel...',
        text: `Exporting ${currentStudentName || 'student'} records`,
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const res = await fetch(`/api/export/student/${encodeURIComponent(currentStudentNfcId)}/xlsx`, { credentials: 'include' });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Export failed');
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeName = (currentStudentName || 'student').replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
        a.download = `TAMTAP_${safeName}_Attendance.xlsx`;
        a.click();
        URL.revokeObjectURL(url);

        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Excel exported!', showConfirmButton: false, timer: 2000 });
    } catch (e) {
        console.error('[ERROR] Student XLSX export:', e);
        Swal.fire({ icon: 'error', title: 'Export Failed', text: e.message || 'Failed to generate Excel', confirmButtonColor: '#0a8249' });
    }
}

async function exportStudentPDF() {
    if (!currentStudentNfcId) return;

    Swal.fire({
        title: 'Generating PDF...',
        text: `Exporting ${currentStudentName || 'student'} report`,
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const res = await fetch(`/api/export/student/${encodeURIComponent(currentStudentNfcId)}/pdf`, { credentials: 'include' });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Export failed');
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeName = (currentStudentName || 'student').replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
        a.download = `TAMTAP_${safeName}_Attendance.pdf`;
        a.click();
        URL.revokeObjectURL(url);

        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'PDF exported!', showConfirmButton: false, timer: 2000 });
    } catch (e) {
        console.error('[ERROR] Student PDF export:', e);
        Swal.fire({ icon: 'error', title: 'Export Failed', text: e.message || 'Failed to generate PDF', confirmButtonColor: '#0a8249' });
    }
}

// ========================================
// UTILITIES
// ========================================
// escapeHtml() is loaded from ./js/utils.js

// ========================================
// EVENT DELEGATION (replaces inline onclick for notifications)
// ========================================
document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'mark-excused') {
        markExcused(btn.dataset.nfc, btn.dataset.name);
    } else if (action === 'mark-absent') {
        markAbsent(btn.dataset.nfc, btn.dataset.name);
    }
});

// Close modals on Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeHistoryModal();
        closePersonalModal();
        closePhotoModal();
        closeSettingsMenu();
    }
});

// Modal backdrop clicks (null-safe)
const historyModal = document.getElementById('history-modal');
if (historyModal) {
    historyModal.addEventListener('click', (e) => {
        if (e.target.id === 'history-modal') closeHistoryModal();
    });
}
const personalModal = document.getElementById('personal-modal');
if (personalModal) {
    personalModal.addEventListener('click', (e) => {
        if (e.target.id === 'personal-modal') closePersonalModal();
    });
}
const photoModal = document.getElementById('photo-modal');
if (photoModal) {
    photoModal.addEventListener('click', (e) => {
        if (e.target.id === 'photo-modal') closePhotoModal();
    });
}

// ========================================
// INIT
// ========================================
checkAuth();
