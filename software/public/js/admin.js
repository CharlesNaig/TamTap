let currentUser = null;
let allSections = [];

// ========================================
// AUTH CHECK
// ========================================
async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (!res.ok) {
            window.location.replace('/login');
            return;
        }
        const data = await res.json();
        if (!data.success || data.user.role !== 'admin') {
            Swal.fire({
                icon: 'error',
                title: 'Access Denied',
                text: 'Admin access required',
                confirmButtonColor: '#0a8249'
            }).then(() => {
                window.location.replace('/dashboard');
            });
            return;
        }
        currentUser = data.user;
        
        // Auth verified - show page content
        document.body.classList.remove('auth-loading');
        
        // Update UI with user info
        document.getElementById('user-name').textContent = currentUser.name;
        document.getElementById('menu-user-name').textContent = currentUser.name;
        document.getElementById('menu-user-role').textContent = 'System Administrator';
        
        loadData();
    } catch (e) {
        window.location.replace('/login');
    }
}

async function logout() {
    showPreloader('Logging out...');
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    navigateTo('/login', 'Redirecting to login...');
}

// ========================================
// SETTINGS MENU
// ========================================
function toggleSettingsMenu() {
    const menu = document.getElementById('settings-menu');
    menu.classList.toggle('hidden');
}

// Close menu when clicking outside
document.addEventListener('click', (e) => {
    const menu = document.getElementById('settings-menu');
    const btn = e.target.closest('button[onclick="toggleSettingsMenu()"]');
    if (!btn && !menu.contains(e.target)) {
        menu.classList.add('hidden');
    }
});

function showPersonalInfo() {
    document.getElementById('settings-menu').classList.add('hidden');
    Swal.fire({
        title: 'Personal Information',
        html: `
            <div class="text-left space-y-3">
                <div class="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                    <div class="w-12 h-12 bg-feu-gold rounded-full flex items-center justify-center text-feu-green-dark">
                        <i class="fas fa-user-shield text-xl"></i>
                    </div>
                    <div>
                        <p class="font-bold text-gray-800">${escapeHtml(currentUser?.name || 'Admin')}</p>
                        <p class="text-sm text-gray-500">System Administrator</p>
                    </div>
                </div>
                <div class="space-y-2 text-sm">
                    <p><strong>Username:</strong> ${escapeHtml(currentUser?.username || 'admin')}</p>
                    <p><strong>Email:</strong> ${escapeHtml(currentUser?.email || 'N/A')}</p>
                    <p><strong>Role:</strong> Administrator</p>
                </div>
            </div>
        `,
        confirmButtonColor: '#0a8249',
        confirmButtonText: 'Close'
    });
}

// ========================================
// TAB NAVIGATION
// ========================================
function showTab(tabName) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-active'));
    
    document.getElementById(`panel-${tabName}`).classList.remove('hidden');
    document.getElementById(`tab-${tabName}`).classList.add('tab-active');
}

// ========================================
// DATA LOADING
// ========================================
async function loadData() {
    await loadSections();
    loadTeachers();
    loadStudents();
    loadSchedules();
}

async function loadSections() {
    try {
        const res = await fetch('/api/admin/sections', { credentials: 'include' });
        const data = await res.json();
        
        // Hide skeleton, show grid
        document.getElementById('sections-grid-skeleton').classList.add('hidden');
        document.getElementById('sections-grid').classList.remove('hidden');
        
        if (data.success) {
            allSections = data.data;
            
            // Update section filter dropdown
            const filter = document.getElementById('student-section-filter');
            filter.innerHTML = '<option value="">All Sections</option>' + 
                allSections.map(s => `<option value="${s.name}">${s.name} (${s.studentCount})</option>`).join('');
            
            // Update sections grid
            const grid = document.getElementById('sections-grid');
            if (allSections.length === 0) {
                grid.innerHTML = '<p class="text-gray-400">No sections found. Add students to create sections.</p>';
            } else {
                grid.innerHTML = allSections.map(s => `
                    <div class="bg-gradient-to-br from-feu-green/5 to-feu-green/10 rounded-lg p-4 border border-feu-green/20 hover:shadow-md transition-shadow">
                        <div class="flex items-center gap-2 mb-2">
                            <i class="fas fa-users text-feu-green"></i>
                            <h3 class="font-semibold text-base sm:text-lg text-gray-800">${s.name}</h3>
                        </div>
                        <p class="text-gray-500 text-sm">${s.studentCount} student${s.studentCount !== 1 ? 's' : ''}</p>
                    </div>
                `).join('');
            }
            
            // Update teacher section checkboxes
            updateSectionCheckboxes();
        }
    } catch (e) {
        console.error('Load sections error:', e);
    }
}

function updateSectionCheckboxes() {
    const html = allSections.map(s => `
        <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" name="sections" value="${s.name}">
            ${s.name}
        </label>
    `).join('');
    
    document.getElementById('teacher-sections-checkboxes').innerHTML = html || '<p class="text-gray-400 text-sm">No sections available</p>';
    document.getElementById('edit-teacher-sections-checkboxes').innerHTML = html || '<p class="text-gray-400 text-sm">No sections available</p>';
}

async function loadTeachers() {
    try {
        const res = await fetch('/api/admin/teachers', { credentials: 'include' });
        const data = await res.json();
        
        // Hide skeleton, show table
        document.getElementById('teachers-table-skeleton').classList.add('hidden');
        document.getElementById('teachers-table').classList.remove('hidden');
        document.getElementById('teachers-cards-skeleton').classList.add('hidden');
        document.getElementById('teachers-cards').classList.remove('hidden');
        
        const tbody = document.getElementById('teachers-table');
        
        if (!data.success || data.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-400">No teachers found</td></tr>';
            document.getElementById('teachers-cards').innerHTML = '<p class="text-center text-gray-400 py-4">No teachers found</p>';
            return;
        }
        
        // Desktop table
        tbody.innerHTML = data.data.map(t => `
            <tr class="hover:bg-gray-50">
                <td class="px-3 lg:px-4 py-3 text-sm font-medium text-gray-900">${escapeHtml(t.username)}</td>
                <td class="px-3 lg:px-4 py-3 text-sm text-gray-700">${escapeHtml(t.name)}</td>
                <td class="px-3 lg:px-4 py-3 text-sm text-gray-500 hidden md:table-cell">${escapeHtml(t.email || '-')}</td>
                <td class="px-3 lg:px-4 py-3 text-sm">
                    ${t.sections_handled.length > 0 
                        ? t.sections_handled.map(s => `<span class="inline-block bg-feu-green/10 text-feu-green px-2 py-0.5 rounded text-xs mr-1 mb-1">${escapeHtml(s)}</span>`).join('')
                        : '<span class="text-gray-400">None</span>'
                    }
                </td>
                <td class="px-3 lg:px-4 py-3 text-sm">
                    <button data-action="edit-teacher" data-id="${t.id}" class="text-feu-green hover:text-feu-green-dark mr-2"><i class="fas fa-edit"></i></button>
                    <button data-action="delete-teacher" data-id="${t.id}" data-name="${escapeHtml(t.name)}" class="text-red-600 hover:text-red-800"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('');
        
        // Mobile cards
        document.getElementById('teachers-cards').innerHTML = data.data.map(t => `
            <div class="bg-gray-50 rounded-lg p-3 border">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <p class="font-semibold text-gray-900">${escapeHtml(t.name)}</p>
                        <p class="text-xs text-gray-500">@${escapeHtml(t.username)}</p>
                    </div>
                    <div class="flex gap-2">
                        <button data-action="edit-teacher" data-id="${t.id}" class="text-feu-green hover:text-feu-green-dark p-1"><i class="fas fa-edit"></i></button>
                        <button data-action="delete-teacher" data-id="${t.id}" data-name="${escapeHtml(t.name)}" class="text-red-600 hover:text-red-800 p-1"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
                ${t.email ? `<p class="text-xs text-gray-500 mb-2"><i class="fas fa-envelope mr-1"></i>${escapeHtml(t.email)}</p>` : ''}
                <div class="flex flex-wrap gap-1">
                    ${t.sections_handled.length > 0 
                        ? t.sections_handled.map(s => `<span class="bg-feu-green/10 text-feu-green px-2 py-0.5 rounded text-xs">${escapeHtml(s)}</span>`).join('')
                        : '<span class="text-gray-400 text-xs">No sections</span>'
                    }
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Load teachers error:', e);
    }
}

async function loadStudents() {
    try {
        const section = document.getElementById('student-section-filter').value;
        const url = section ? `/api/admin/students?section=${encodeURIComponent(section)}` : '/api/admin/students';
        
        const res = await fetch(url, { credentials: 'include' });
        const data = await res.json();
        
        // Hide skeleton, show table
        document.getElementById('students-table-skeleton').classList.add('hidden');
        document.getElementById('students-table').classList.remove('hidden');
        document.getElementById('students-cards-skeleton').classList.add('hidden');
        document.getElementById('students-cards').classList.remove('hidden');
        
        // Reset selection state
        clearStudentSelection();
        
        const tbody = document.getElementById('students-table');
        
        if (!data.success || data.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">No students found</td></tr>';
            document.getElementById('students-cards').innerHTML = '<p class="text-center text-gray-400 py-4">No students found</p>';
            return;
        }
        
        // Desktop table with checkboxes
        tbody.innerHTML = data.data.map(s => `
            <tr class="hover:bg-gray-50">
                <td class="px-2 py-3 text-center"><input type="checkbox" class="student-checkbox rounded border-gray-300 text-feu-green focus:ring-feu-green cursor-pointer" value="${escapeHtml(s.nfc_id)}" onchange="updateStudentSelection()"></td>
                <td class="px-3 lg:px-4 py-3 text-sm font-medium text-gray-900">${escapeHtml(s.tamtap_id)}</td>
                <td class="px-3 lg:px-4 py-3 text-sm text-gray-500 font-mono hidden lg:table-cell">${escapeHtml(s.nfc_id)}</td>
                <td class="px-3 lg:px-4 py-3 text-sm text-gray-700">${escapeHtml(s.name)}</td>
                <td class="px-3 lg:px-4 py-3 text-sm text-gray-500 hidden md:table-cell">${escapeHtml(s.grade || '-')}</td>
                <td class="px-3 lg:px-4 py-3 text-sm">
                    <span class="bg-feu-green/10 text-feu-green px-2 py-0.5 rounded text-xs">${escapeHtml(s.section)}</span>
                </td>
                <td class="px-3 lg:px-4 py-3 text-sm">
                    <button data-action="archive-student" data-nfc="${escapeHtml(s.nfc_id)}" data-name="${escapeHtml(s.name)}" class="text-amber-500 hover:text-amber-700" title="Archive"><i class="fas fa-archive"></i></button>
                </td>
            </tr>
        `).join('');
        
        // Mobile cards with checkboxes
        document.getElementById('students-cards').innerHTML = data.data.map(s => `
            <div class="bg-gray-50 rounded-lg p-3 border">
                <div class="flex justify-between items-start">
                    <div class="flex items-start gap-2 flex-1">
                        <input type="checkbox" class="student-checkbox-mobile rounded border-gray-300 text-feu-green focus:ring-feu-green cursor-pointer mt-1" value="${escapeHtml(s.nfc_id)}" onchange="updateStudentSelection()">
                        <div>
                            <p class="font-semibold text-gray-900">${escapeHtml(s.name)}</p>
                            <p class="text-xs text-gray-500">ID: ${escapeHtml(s.tamtap_id)}</p>
                            <p class="text-xs text-gray-400 font-mono mt-1">NFC: ${escapeHtml(s.nfc_id)}</p>
                        </div>
                    </div>
                    <div class="flex items-start gap-2">
                        <span class="bg-feu-green/10 text-feu-green px-2 py-0.5 rounded text-xs">${escapeHtml(s.section)}</span>
                        <button data-action="archive-student" data-nfc="${escapeHtml(s.nfc_id)}" data-name="${escapeHtml(s.name)}" class="text-amber-500 hover:text-amber-700 p-1" title="Archive"><i class="fas fa-archive"></i></button>
                    </div>
                </div>
            </div>
        `).join('');
        
        // Also load archived count for badge
        loadArchivedCount();
    } catch (e) {
        console.error('Load students error:', e);
    }
}

// ========================================
// SCHEDULES
// ========================================
let allSchedules = [];
let allTeachers = [];

async function loadSchedules() {
    try {
        // Load schedules
        const res = await fetch('/api/schedules', { credentials: 'include' });
        const data = await res.json();
        
        // Load teachers for adviser dropdown
        const teachersRes = await fetch('/api/admin/teachers', { credentials: 'include' });
        const teachersData = await teachersRes.json();
        if (teachersData.success) {
            allTeachers = teachersData.data;
        }
        
        // Hide skeleton, show table
        document.getElementById('schedules-table-skeleton').classList.add('hidden');
        document.getElementById('schedules-table').classList.remove('hidden');
        document.getElementById('schedules-mobile-skeleton').classList.add('hidden');
        document.getElementById('schedules-mobile').classList.remove('hidden');
        
        if (data.success) {
            allSchedules = data.data;
            renderSchedules();
        }
    } catch (e) {
        console.error('Load schedules error:', e);
    }
}

function renderSchedules() {
    const tbody = document.getElementById('schedules-table');
    const mobile = document.getElementById('schedules-mobile');
    
    if (allSchedules.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-400">No schedules configured. Click "Add" to create one.</td></tr>';
        mobile.innerHTML = '<div class="text-center text-gray-400 py-6">No schedules configured</div>';
        return;
    }
    
    // Helper to format weekly schedule summary
    function getScheduleSummary(ws) {
        if (!ws) return { weekday: '07:00-17:00', sat: 'None' };
        const mon = ws.monday || { start: '07:00', end: '17:00' };
        const sat = ws.saturday || {};
        return {
            weekday: `${mon.start || '07:00'}-${mon.end || '17:00'}`,
            sat: sat.start ? `${sat.start}-${sat.end}` : 'None'
        };
    }
    
    // Desktop table
    tbody.innerHTML = allSchedules.map(s => {
        const sAdvId = s.adviser_id ? String(s.adviser_id) : null;
        const adviser = sAdvId ? allTeachers.find(t => String(t.id) === sAdvId) : null;
        const summary = getScheduleSummary(s.weekly_schedule);
        return `
            <tr class="hover:bg-gray-50">
                <td class="px-3 lg:px-4 py-3">
                    <span class="inline-flex items-center gap-1.5">
                        <i class="fas fa-users text-feu-green text-xs"></i>
                        <span class="font-medium">${escapeHtml(s.section)}</span>
                    </span>
                </td>
                <td class="px-3 lg:px-4 py-3 text-gray-600">${adviser ? escapeHtml(adviser.name) : '<span class="text-gray-400">—</span>'}</td>
                <td class="px-3 lg:px-4 py-3 font-mono text-sm">${summary.weekday}</td>
                <td class="px-3 lg:px-4 py-3 font-mono text-sm ${summary.sat === 'None' ? 'text-gray-400' : 'text-yellow-600'}">${summary.sat}</td>
                <td class="px-3 lg:px-4 py-3">${s.grace_period_minutes || 20} min</td>
                <td class="px-3 lg:px-4 py-3">
                    <div class="flex items-center gap-1">
                        <button data-action="edit-schedule" data-section="${escapeHtml(s.section)}" class="text-blue-600 hover:text-blue-800 p-1.5" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button data-action="delete-schedule" data-section="${escapeHtml(s.section)}" class="text-red-600 hover:text-red-800 p-1.5" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    // Mobile cards
    mobile.innerHTML = allSchedules.map(s => {
        const sAdvId = s.adviser_id ? String(s.adviser_id) : null;
        const adviser = sAdvId ? allTeachers.find(t => String(t.id) === sAdvId) : null;
        const summary = getScheduleSummary(s.weekly_schedule);
        return `
            <div class="border rounded-lg p-3">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <h4 class="font-semibold text-gray-800">${escapeHtml(s.section)}</h4>
                        <p class="text-xs text-gray-500">${adviser ? escapeHtml(adviser.name) : 'No adviser'}</p>
                    </div>
                    <div class="flex gap-1">
                        <button data-action="edit-schedule" data-section="${escapeHtml(s.section)}" class="text-blue-600 p-1"><i class="fas fa-edit"></i></button>
                        <button data-action="delete-schedule" data-section="${escapeHtml(s.section)}" class="text-red-600 p-1"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
                <div class="grid grid-cols-3 gap-2 text-xs text-gray-600">
                    <div><span class="text-gray-400">M-F:</span> ${summary.weekday}</div>
                    <div><span class="text-gray-400">Sat:</span> ${summary.sat}</div>
                    <div><span class="text-gray-400">Grace:</span> ${s.grace_period_minutes || 20}m</div>
                </div>
            </div>
        `;
    }).join('');
}

function showAddScheduleModal() {
    document.getElementById('add-schedule-form').reset();
    
    // Populate section dropdown (exclude already configured)
    const configuredSections = allSchedules.map(s => s.section);
    const availableSections = allSections.filter(s => !configuredSections.includes(s.name));
    const sectionSelect = document.getElementById('add-schedule-section');
    sectionSelect.innerHTML = '<option value="">Select Section</option>' + 
        availableSections.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
    
    // Populate adviser dropdown
    populateAdviserDropdown('add-schedule-adviser');
    
    showModal('add-schedule-modal');
}

function populateAdviserDropdown(elementId, selectedId = '') {
    const select = document.getElementById(elementId);
    const selId = selectedId ? String(selectedId) : '';
    select.innerHTML = '<option value="">No Adviser</option>' + 
        allTeachers.map(t => `<option value="${t.id}" ${String(t.id) === selId ? 'selected' : ''}>${t.name}</option>`).join('');
}

function editSchedule(section) {
    const schedule = allSchedules.find(s => s.section === section);
    if (!schedule) return;
    
    const form = document.getElementById('edit-schedule-form');
    form.querySelector('input[name="section"]').value = schedule.section;
    document.getElementById('edit-schedule-section-display').value = schedule.section;
    form.querySelector('input[name="grace_period"]').value = schedule.grace_period_minutes || 20;
    form.querySelector('input[name="absent_threshold"]').value = schedule.absent_threshold_minutes || 60;
    
    // Populate weekly schedule
    const ws = schedule.weekly_schedule || {};
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    days.forEach((d, i) => {
        const dayData = ws[dayNames[i]] || {};
        form.querySelector(`input[name="${d}_start"]`).value = dayData.start || (d === 'sat' ? '' : '07:00');
        form.querySelector(`input[name="${d}_end"]`).value = dayData.end || (d === 'sat' ? '' : '17:00');
    });
    
    populateAdviserDropdown('edit-schedule-adviser', schedule.adviser_id || '');
    
    showModal('edit-schedule-modal');
}

async function deleteSchedule(section) {
    const result = await Swal.fire({
        title: 'Delete Schedule?',
        text: `This will remove the schedule for ${section}`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Delete',
        confirmButtonColor: '#dc2626'
    });
    
    if (!result.isConfirmed) return;
    
    try {
        const res = await fetch(`/api/schedules/${encodeURIComponent(section)}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const data = await res.json();
        
        if (data.success) {
            Swal.fire({ icon: 'success', title: 'Deleted', text: 'Schedule removed', timer: 1500, showConfirmButton: false });
            loadSchedules();
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error', text: e.message, confirmButtonColor: '#0a8249' });
    }
}

function downloadScheduleTemplate() {
    // CSV headers matching the import format
    const headers = ['Section', 'Grade', 'Adviser Name', 'Mon Start', 'Mon End', 'Tue Start', 'Tue End', 'Wed Start', 'Wed End', 'Thu Start', 'Thu End', 'Fri Start', 'Fri End', 'Sat Start', 'Sat End'];
    
    // Example rows
    const rows = [
        ['ICT-A', '12', 'Juan Dela Cruz', '07:00', '17:00', '07:00', '17:00', '07:00', '17:00', '07:00', '17:00', '07:00', '16:00', '', ''],
        ['ICT-B', '12', 'Maria Santos', '08:00', '17:00', '08:00', '17:00', '08:00', '17:00', '08:00', '17:00', '08:00', '16:00', '08:00', '12:00'],
        ['STEM-A', '11', '', '07:30', '16:00', '07:30', '16:00', '07:30', '16:00', '07:30', '16:00', '07:30', '15:00', '', '']
    ];
    
    // Build CSV content
    let csv = headers.join(',') + '\n';
    rows.forEach(row => {
        csv += row.join(',') + '\n';
    });
    
    // Create download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'schedule-import-template.csv';
    link.click();
    URL.revokeObjectURL(link.href);
    
    Swal.fire({
        icon: 'info',
        title: 'Template Downloaded',
        html: '<p class="text-sm text-gray-600">Open in Excel, edit your sections, then save as <strong>.xlsx</strong> before importing.</p><p class="text-xs text-gray-500 mt-2">Leave Sat Start/End blank for no Saturday classes.</p>',
        confirmButtonColor: '#0a8249'
    });
}

async function importScheduleXLSX() {
    const input = document.getElementById('schedule-xlsx-input');
    if (!input.files.length) return;
    
    const formData = new FormData();
    formData.append('file', input.files[0]);
    
    try {
        Swal.fire({ title: 'Importing...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        
        const res = await fetch('/api/schedules/import', {
            method: 'POST',
            credentials: 'include',
            body: formData
        });
        const data = await res.json();
        
        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: 'Import Complete',
                text: `${data.imported} schedules imported, ${data.skipped} skipped`,
                confirmButtonColor: '#0a8249'
            });
            loadSchedules();
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Import Failed', text: e.message, confirmButtonColor: '#0a8249' });
    }
    
    input.value = '';
}

// Add Schedule Form
document.getElementById('add-schedule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    
    // Build weekly_schedule object
    const weekly_schedule = {
        monday:    { start: form.mon_start.value || '07:00', end: form.mon_end.value || '17:00' },
        tuesday:   { start: form.tue_start.value || '07:00', end: form.tue_end.value || '17:00' },
        wednesday: { start: form.wed_start.value || '07:00', end: form.wed_end.value || '17:00' },
        thursday:  { start: form.thu_start.value || '07:00', end: form.thu_end.value || '17:00' },
        friday:    { start: form.fri_start.value || '07:00', end: form.fri_end.value || '17:00' },
        saturday:  { start: form.sat_start.value || null, end: form.sat_end.value || null }
    };
    
    const payload = {
        section: form.section.value,
        adviser_id: form.adviser_id.value || null,
        weekly_schedule,
        grace_period_minutes: parseInt(form.grace_period.value),
        absent_threshold_minutes: parseInt(form.absent_threshold.value)
    };
    
    try {
        const res = await fetch('/api/schedules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        if (data.success) {
            Swal.fire({ icon: 'success', title: 'Added', text: 'Schedule created', timer: 1500, showConfirmButton: false });
            closeModal('add-schedule-modal');
            loadSchedules();
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error', text: e.message, confirmButtonColor: '#0a8249' });
    }
});

// Edit Schedule Form
document.getElementById('edit-schedule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const section = form.section.value;
    
    // Build weekly_schedule object
    const weekly_schedule = {
        monday:    { start: form.mon_start.value || '07:00', end: form.mon_end.value || '17:00' },
        tuesday:   { start: form.tue_start.value || '07:00', end: form.tue_end.value || '17:00' },
        wednesday: { start: form.wed_start.value || '07:00', end: form.wed_end.value || '17:00' },
        thursday:  { start: form.thu_start.value || '07:00', end: form.thu_end.value || '17:00' },
        friday:    { start: form.fri_start.value || '07:00', end: form.fri_end.value || '17:00' },
        saturday:  { start: form.sat_start.value || null, end: form.sat_end.value || null }
    };
    
    const payload = {
        adviser_id: form.adviser_id.value || null,
        weekly_schedule,
        grace_period_minutes: parseInt(form.grace_period.value),
        absent_threshold_minutes: parseInt(form.absent_threshold.value)
    };
    
    try {
        const res = await fetch(`/api/schedules/${encodeURIComponent(section)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        if (data.success) {
            Swal.fire({ icon: 'success', title: 'Updated', text: 'Schedule updated', timer: 1500, showConfirmButton: false });
            closeModal('edit-schedule-modal');
            loadSchedules();
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error', text: e.message, confirmButtonColor: '#0a8249' });
    }
});

// ========================================
// MODALS
// ========================================
function showModal(id) {
    document.getElementById(id).classList.remove('hidden');
    document.getElementById(id).classList.add('flex');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
    document.getElementById(id).classList.remove('flex');
}

function showAddTeacherModal() {
    document.getElementById('add-teacher-form').reset();
    showModal('add-teacher-modal');
}

function showAddStudentModal() {
    document.getElementById('add-student-form').reset();
    showModal('add-student-modal');
}

// ========================================
// TEACHER CRUD
// ========================================
document.getElementById('add-teacher-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const sections = Array.from(form.querySelectorAll('input[name="sections"]:checked')).map(cb => cb.value);
    
    try {
        const res = await fetch('/api/admin/teachers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                username: form.username.value,
                name: form.name.value,
                email: form.email.value,
                password: form.password.value,
                sections_handled: sections
            })
        });
        
        const data = await res.json();
        
        if (data.success) {
            Swal.fire({ icon: 'success', title: 'Teacher Added', timer: 1500, showConfirmButton: false });
            closeModal('add-teacher-modal');
            loadTeachers();
        } else {
            Swal.fire({ icon: 'error', title: 'Error', text: data.error, confirmButtonColor: '#0a8249' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to add teacher', confirmButtonColor: '#0a8249' });
    }
});

async function editTeacher(id) {
    try {
        const res = await fetch(`/api/admin/teachers/${encodeURIComponent(id)}`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success || !data.data) return;
        const teacher = data.data;
        
        const form = document.getElementById('edit-teacher-form');
        form.id.value = id;
        form.name.value = teacher.name;
        form.email.value = teacher.email || '';
        form.password.value = '';
        
        // Check assigned sections
        form.querySelectorAll('input[name="sections"]').forEach(cb => {
            cb.checked = teacher.sections_handled.includes(cb.value);
        });
        
        showModal('edit-teacher-modal');
    } catch (e) {
        console.error('Edit teacher error:', e);
    }
}

document.getElementById('edit-teacher-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const id = form.id.value;
    const sections = Array.from(form.querySelectorAll('input[name="sections"]:checked')).map(cb => cb.value);
    
    const updateData = {
        name: form.name.value,
        email: form.email.value,
        sections_handled: sections
    };
    
    if (form.password.value) {
        updateData.password = form.password.value;
    }
    
    try {
        const res = await fetch(`/api/admin/teachers/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(updateData)
        });
        
        const data = await res.json();
        
        if (data.success) {
            Swal.fire({ icon: 'success', title: 'Teacher Updated', timer: 1500, showConfirmButton: false });
            closeModal('edit-teacher-modal');
            loadTeachers();
        } else {
            Swal.fire({ icon: 'error', title: 'Error', text: data.error, confirmButtonColor: '#0a8249' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to update teacher', confirmButtonColor: '#0a8249' });
    }
});

async function deleteTeacher(id, name) {
    const result = await Swal.fire({
        title: 'Delete Teacher?',
        text: `Remove ${name}'s account?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'Delete'
    });
    
    if (result.isConfirmed) {
        try {
            const res = await fetch(`/api/admin/teachers/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            
            if (res.ok) {
                Swal.fire({ icon: 'success', title: 'Deleted', timer: 1500, showConfirmButton: false });
                loadTeachers();
            }
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to delete', confirmButtonColor: '#0a8249' });
        }
    }
}

// ========================================
// STUDENT CRUD
// ========================================
document.getElementById('add-student-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    
    try {
        const res = await fetch('/api/admin/students', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                nfc_id: form.nfc_id.value,
                first_name: form.first_name.value,
                last_name: form.last_name.value,
                grade: form.grade.value,
                section: form.section.value
            })
        });
        
        const data = await res.json();
        
        if (data.success) {
            Swal.fire({ icon: 'success', title: 'Student Added', text: `ID: ${data.data.tamtap_id}`, timer: 2000, showConfirmButton: false });
            closeModal('add-student-modal');
            loadStudents();
            loadSections();
        } else {
            Swal.fire({ icon: 'error', title: 'Error', text: data.error, confirmButtonColor: '#0a8249' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to add student', confirmButtonColor: '#0a8249' });
    }
});

// ========================================
// STUDENT ARCHIVE / RESTORE SYSTEM
// ========================================

async function deleteStudent(nfcId, name) {
    const result = await Swal.fire({
        title: 'Archive Student?',
        text: `Move ${name} to archive? You can restore later.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d97706',
        cancelButtonColor: '#6b7280',
        confirmButtonText: '<i class="fas fa-archive"></i> Archive'
    });
    
    if (result.isConfirmed) {
        try {
            const res = await fetch(`/api/admin/students/${nfcId}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            
            if (res.ok) {
                Swal.fire({ icon: 'success', title: 'Archived', text: 'Student moved to archive', timer: 1500, showConfirmButton: false });
                loadStudents();
                loadSections();
            }
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to archive', confirmButtonColor: '#0a8249' });
        }
    }
}

// Track current sub-tab
let currentStudentSubTab = 'active';

// Sub-tab switching (Active / Archived)
function showStudentSubTab(tab) {
    currentStudentSubTab = tab;
    document.querySelectorAll('.student-subtab').forEach(b => {
        b.classList.remove('text-feu-green', 'border-feu-green');
        b.classList.add('text-gray-500', 'border-transparent');
    });
    document.getElementById(`subtab-${tab}`).classList.remove('text-gray-500', 'border-transparent');
    document.getElementById(`subtab-${tab}`).classList.add('text-feu-green', 'border-feu-green');

    const filter = document.getElementById('student-section-filter');

    if (tab === 'active') {
        document.getElementById('active-students-panel').classList.remove('hidden');
        document.getElementById('archived-students-panel').classList.add('hidden');
        document.getElementById('batch-actions-bar').classList.add('hidden');
        // Restore active sections in dropdown
        filter.innerHTML = '<option value="">All Sections</option>' +
            allSections.map(s => `<option value="${s.name}">${s.name} (${s.studentCount})</option>`).join('');
        filter.onchange = () => loadStudents();
        loadStudents();
    } else {
        document.getElementById('active-students-panel').classList.add('hidden');
        document.getElementById('archived-students-panel').classList.remove('hidden');
        document.getElementById('batch-actions-bar').classList.add('hidden');
        // Switch dropdown to archived sections
        filter.onchange = () => loadArchivedStudents();
        loadArchivedStudents();
    }
}

// Selection helpers — Active students
function toggleSelectAllStudents(el) {
    document.querySelectorAll('.student-checkbox').forEach(cb => cb.checked = el.checked);
    document.querySelectorAll('.student-checkbox-mobile').forEach(cb => cb.checked = el.checked);
    updateStudentSelection();
}

function updateStudentSelection() {
    const checked = document.querySelectorAll('.student-checkbox:checked');
    const count = checked.length;
    const bar = document.getElementById('batch-actions-bar');
    document.getElementById('selected-count').textContent = count;

    if (count > 0) {
        bar.classList.remove('hidden');
    } else {
        bar.classList.add('hidden');
    }
}

function clearStudentSelection() {
    document.querySelectorAll('.student-checkbox, .student-checkbox-mobile').forEach(cb => cb.checked = false);
    const selectAll = document.getElementById('select-all-students');
    if (selectAll) selectAll.checked = false;
    document.getElementById('batch-actions-bar').classList.add('hidden');
}

function getSelectedStudentNfcIds() {
    return Array.from(document.querySelectorAll('.student-checkbox:checked')).map(cb => cb.value);
}

// Batch archive
async function batchArchiveSelected() {
    const nfcIds = getSelectedStudentNfcIds();
    if (nfcIds.length === 0) return;

    const result = await Swal.fire({
        title: `Archive ${nfcIds.length} student${nfcIds.length > 1 ? 's' : ''}?`,
        text: 'They will be moved to archive and can be restored later.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d97706',
        cancelButtonColor: '#6b7280',
        confirmButtonText: '<i class="fas fa-archive"></i> Archive All'
    });

    if (!result.isConfirmed) return;

    try {
        const res = await fetch('/api/admin/students/archive-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ nfc_ids: nfcIds })
        });
        const data = await res.json();

        if (data.success) {
            Swal.fire({ icon: 'success', title: 'Archived', text: data.message, timer: 2000, showConfirmButton: false });
            loadStudents();
            loadSections();
        } else {
            Swal.fire({ icon: 'error', title: 'Error', text: data.error, confirmButtonColor: '#0a8249' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to batch archive', confirmButtonColor: '#0a8249' });
    }
}

// Archived student count badge
async function loadArchivedCount() {
    try {
        const res = await fetch('/api/admin/students/archived', { credentials: 'include' });
        const data = await res.json();
        const badge = document.getElementById('archived-count-badge');
        if (data.success && data.count > 0) {
            badge.textContent = data.count;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    } catch (e) {
        // Silent fail
    }
}

// Load archived students list
async function loadArchivedStudents() {
    try {
        const res = await fetch('/api/admin/students/archived', { credentials: 'include' });
        const data = await res.json();

        const tbody = document.getElementById('archived-table');
        const cards = document.getElementById('archived-cards');
        const filter = document.getElementById('student-section-filter');
        const selectedSection = filter.value;

        if (!data.success || data.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400"><i class="fas fa-archive mr-2"></i>No archived students</td></tr>';
            cards.innerHTML = '<p class="text-center text-gray-400 py-4"><i class="fas fa-archive mr-2"></i>No archived students</p>';
            // Clear dropdown for archived
            filter.innerHTML = '<option value="">All Sections</option>';
            return;
        }

        // Build archived sections for dropdown
        const archivedSections = [...new Set(data.data.map(s => s.section).filter(Boolean))].sort();
        const currentVal = selectedSection;
        filter.innerHTML = '<option value="">All Sections</option>' +
            archivedSections.map(s => {
                const count = data.data.filter(st => st.section === s).length;
                return `<option value="${s}" ${s === currentVal ? 'selected' : ''}>${s} (${count})</option>`;
            }).join('');

        // Filter data by selected section
        const filtered = selectedSection
            ? data.data.filter(s => s.section === selectedSection)
            : data.data;

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400"><i class="fas fa-filter mr-2"></i>No archived students in this section</td></tr>';
            cards.innerHTML = '<p class="text-center text-gray-400 py-4"><i class="fas fa-filter mr-2"></i>No archived students in this section</p>';
            return;
        }

        // Reset selection state
        clearArchivedSelection();

        // Desktop table
        tbody.innerHTML = filtered.map(s => `
            <tr class="hover:bg-gray-50 bg-amber-50/30">
                <td class="px-2 py-3 text-center"><input type="checkbox" class="archived-checkbox rounded border-gray-300 text-feu-green focus:ring-feu-green cursor-pointer" value="${escapeHtml(s.nfc_id)}" onchange="updateArchivedSelection()"></td>
                <td class="px-3 lg:px-4 py-3 text-sm font-medium text-gray-900">${escapeHtml(s.tamtap_id || '-')}</td>
                <td class="px-3 lg:px-4 py-3 text-sm text-gray-500 font-mono hidden lg:table-cell">${escapeHtml(s.nfc_id)}</td>
                <td class="px-3 lg:px-4 py-3 text-sm text-gray-700">${escapeHtml(s.name)}</td>
                <td class="px-3 lg:px-4 py-3 text-sm">
                    <span class="bg-gray-100 text-gray-500 px-2 py-0.5 rounded text-xs">${escapeHtml(s.section)}</span>
                </td>
                <td class="px-3 lg:px-4 py-3 text-sm text-gray-400 hidden md:table-cell">${new Date(s.archived_at).toLocaleDateString()}</td>
                <td class="px-3 lg:px-4 py-3 text-sm flex gap-2">
                    <button data-action="restore-student" data-nfc="${escapeHtml(s.nfc_id)}" data-name="${escapeHtml(s.name)}" class="text-feu-green hover:text-feu-green-dark" title="Restore"><i class="fas fa-undo"></i></button>
                    <button data-action="delete-student-permanent" data-nfc="${escapeHtml(s.nfc_id)}" data-name="${escapeHtml(s.name)}" class="text-red-600 hover:text-red-800" title="Delete permanently"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('');

        // Mobile cards
        cards.innerHTML = filtered.map(s => `
            <div class="bg-amber-50/50 rounded-lg p-3 border border-amber-200">
                <div class="flex justify-between items-start">
                    <div class="flex items-start gap-2 flex-1">
                        <input type="checkbox" class="archived-checkbox-mobile rounded border-gray-300 text-feu-green focus:ring-feu-green cursor-pointer mt-1" value="${escapeHtml(s.nfc_id)}" onchange="updateArchivedSelection()">
                        <div>
                            <p class="font-semibold text-gray-900">${escapeHtml(s.name)}</p>
                            <p class="text-xs text-gray-500">${escapeHtml(s.section)} · Archived ${new Date(s.archived_at).toLocaleDateString()}</p>
                        </div>
                    </div>
                    <div class="flex items-start gap-2">
                        <button data-action="restore-student" data-nfc="${escapeHtml(s.nfc_id)}" data-name="${escapeHtml(s.name)}" class="text-feu-green hover:text-feu-green-dark p-1" title="Restore"><i class="fas fa-undo"></i></button>
                        <button data-action="delete-student-permanent" data-nfc="${escapeHtml(s.nfc_id)}" data-name="${escapeHtml(s.name)}" class="text-red-600 hover:text-red-800 p-1" title="Delete permanently"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Load archived students error:', e);
    }
}

// Selection helpers — Archived students
function toggleSelectAllArchived(el) {
    document.querySelectorAll('.archived-checkbox').forEach(cb => cb.checked = el.checked);
    document.querySelectorAll('.archived-checkbox-mobile').forEach(cb => cb.checked = el.checked);
    updateArchivedSelection();
}

function updateArchivedSelection() {
    const checked = document.querySelectorAll('.archived-checkbox:checked');
    const count = checked.length;
    const bar = document.getElementById('archived-batch-bar');
    document.getElementById('archived-selected-count').textContent = count;
    bar.classList.toggle('hidden', count === 0);
}

function clearArchivedSelection() {
    document.querySelectorAll('.archived-checkbox, .archived-checkbox-mobile').forEach(cb => cb.checked = false);
    const selectAll = document.getElementById('select-all-archived');
    if (selectAll) selectAll.checked = false;
    document.getElementById('archived-batch-bar').classList.add('hidden');
}

// Restore single
async function restoreSingleStudent(nfcId, name) {
    const result = await Swal.fire({
        title: 'Restore Student?',
        text: `Restore ${name} back to active students?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#0a8249',
        cancelButtonColor: '#6b7280',
        confirmButtonText: '<i class="fas fa-undo"></i> Restore'
    });

    if (!result.isConfirmed) return;

    try {
        const res = await fetch('/api/admin/students/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ nfc_ids: [nfcId] })
        });
        const data = await res.json();

        if (data.success && data.results.restored > 0) {
            Swal.fire({ icon: 'success', title: 'Restored', text: `${name} is now active again`, timer: 1500, showConfirmButton: false });
            loadArchivedStudents();
            loadArchivedCount();
        } else {
            Swal.fire({ icon: 'error', title: 'Error', text: data.results?.errors?.[0] || 'Failed to restore', confirmButtonColor: '#0a8249' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to restore student', confirmButtonColor: '#0a8249' });
    }
}

// Batch restore
async function batchRestoreSelected() {
    const nfcIds = Array.from(document.querySelectorAll('.archived-checkbox:checked')).map(cb => cb.value);
    if (nfcIds.length === 0) return;

    const result = await Swal.fire({
        title: `Restore ${nfcIds.length} student${nfcIds.length > 1 ? 's' : ''}?`,
        text: 'They will be moved back to active students.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#0a8249',
        cancelButtonColor: '#6b7280',
        confirmButtonText: '<i class="fas fa-undo"></i> Restore All'
    });

    if (!result.isConfirmed) return;

    try {
        const res = await fetch('/api/admin/students/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ nfc_ids: nfcIds })
        });
        const data = await res.json();

        if (data.success) {
            Swal.fire({ icon: 'success', title: 'Restored', text: data.message, timer: 2000, showConfirmButton: false });
            loadArchivedStudents();
            loadArchivedCount();
            loadStudents();
            loadSections();
        } else {
            Swal.fire({ icon: 'error', title: 'Error', text: data.error, confirmButtonColor: '#0a8249' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to batch restore', confirmButtonColor: '#0a8249' });
    }
}

// Batch permanent delete
async function batchDeleteSelected() {
    const nfcIds = Array.from(document.querySelectorAll('.archived-checkbox:checked')).map(cb => cb.value);
    if (nfcIds.length === 0) return;

    const result = await Swal.fire({
        title: `Permanently delete ${nfcIds.length} student${nfcIds.length > 1 ? 's' : ''}?`,
        html: `<p>This will <strong>permanently remove</strong> ${nfcIds.length} archived student${nfcIds.length > 1 ? 's' : ''}.</p><p class="text-red-600 text-sm mt-2">This action cannot be undone.</p>`,
        icon: 'error',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#6b7280',
        confirmButtonText: '<i class="fas fa-trash"></i> Delete All Forever'
    });

    if (!result.isConfirmed) return;

    try {
        const res = await fetch('/api/admin/students/delete-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ nfc_ids: nfcIds })
        });
        const data = await res.json();

        if (data.success) {
            Swal.fire({ icon: 'success', title: 'Deleted', text: data.message, timer: 2000, showConfirmButton: false });
            loadArchivedStudents();
            loadArchivedCount();
        } else {
            Swal.fire({ icon: 'error', title: 'Error', text: data.error, confirmButtonColor: '#0a8249' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to batch delete', confirmButtonColor: '#0a8249' });
    }
}

// Permanent delete (from archive)
async function permanentDeleteStudent(nfcId, name) {
    const result = await Swal.fire({
        title: 'Permanently Delete?',
        html: `<p>This will <strong>permanently remove</strong> ${escapeHtml(name)}.</p><p class="text-red-600 text-sm mt-2">This action cannot be undone.</p>`,
        icon: 'error',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#6b7280',
        confirmButtonText: '<i class="fas fa-trash"></i> Delete Forever'
    });

    if (!result.isConfirmed) return;

    try {
        const res = await fetch(`/api/admin/students/archived/${nfcId}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (res.ok) {
            Swal.fire({ icon: 'success', title: 'Deleted', text: 'Student permanently removed', timer: 1500, showConfirmButton: false });
            loadArchivedStudents();
            loadArchivedCount();
        } else {
            Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to delete', confirmButtonColor: '#0a8249' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to delete', confirmButtonColor: '#0a8249' });
    }
}

function showBulkImportModal() {
    Swal.fire({
        title: 'Bulk Import Students',
        html: `
            <p class="text-sm text-gray-600 mb-4">Paste CSV data (nfc_id, first_name, last_name, grade, section)</p>
            <textarea id="csv-data" class="w-full border rounded p-2 h-32 text-sm font-mono" placeholder="04A1B2C3,Juan,Dela Cruz,11,11-A
04D5E6F7,Maria,Santos,11,11-A"></textarea>
        `,
        showCancelButton: true,
        confirmButtonText: 'Import',
        confirmButtonColor: '#0a8249',
        cancelButtonColor: '#6b7280',
        preConfirm: () => {
            const csv = document.getElementById('csv-data').value;
            return parseCSV(csv);
        }
    }).then(async (result) => {
        if (result.isConfirmed && result.value.length > 0) {
            try {
                const res = await fetch('/api/admin/students/bulk', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ students: result.value })
                });
                
                const data = await res.json();
                
                Swal.fire({
                    icon: data.results.failed > 0 ? 'warning' : 'success',
                    title: 'Import Complete',
                    html: `<p>Success: ${data.results.success}</p><p>Failed: ${data.results.failed}</p>`,
                    confirmButtonColor: '#0a8249'
                });
                
                loadStudents();
                loadSections();
            } catch (e) {
                Swal.fire({ icon: 'error', title: 'Import Failed', confirmButtonColor: '#0a8249' });
            }
        }
    });
}

function parseCSV(csv) {
    return csv.trim().split('\n').map(line => {
        const [nfc_id, first_name, last_name, grade, section] = line.split(',').map(s => s.trim());
        return { nfc_id, first_name, last_name, grade, section };
    }).filter(s => s.nfc_id && s.section);
}

// ========================================
// SYSTEM LOGS CONSOLE
// ========================================
let logSocket = null;
let isStreamingLogs = false;
const MAX_LOG_LINES = 200;

const LOG_COLORS = {
    'info': 'text-green-400',
    'notice': 'text-green-300',
    'warn': 'text-yellow-400',
    'warning': 'text-yellow-400',
    'error': 'text-red-400',
    'crit': 'text-red-500',
    'alert': 'text-red-600',
    'emerg': 'text-red-700',
    'debug': 'text-cyan-400'
};

const SERVICE_CONSOLES = {
    'buttons': 'console-buttons',
    'hardware': 'console-hardware',
    'server': 'console-server'
};

function getLogColor(level) {
    return LOG_COLORS[level] || 'text-gray-300';
}

function formatLogEntry(entry) {
    const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false });
    const colorClass = getLogColor(entry.level);
    const levelBadge = entry.level ? `<span class="text-gray-500">[${entry.level.toUpperCase().padEnd(5)}]</span>` : '';
    return `<div class="${colorClass}"><span class="text-gray-600">${time}</span> ${levelBadge} ${escapeHtml(entry.message)}</div>`;
}

// escapeHtml() is loaded from ./js/utils.js

// ========================================
// EVENT DELEGATION (replaces inline onclick)
// ========================================
document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    switch (action) {
        case 'edit-teacher':
            editTeacher(btn.dataset.id);
            break;
        case 'delete-teacher':
            deleteTeacher(btn.dataset.id, btn.dataset.name);
            break;
        case 'archive-student':
            deleteStudent(btn.dataset.nfc, btn.dataset.name);
            break;
        case 'edit-schedule':
            editSchedule(btn.dataset.section);
            break;
        case 'delete-schedule':
            deleteSchedule(btn.dataset.section);
            break;
        case 'restore-student':
            restoreSingleStudent(btn.dataset.nfc, btn.dataset.name);
            break;
        case 'delete-student-permanent':
            permanentDeleteStudent(btn.dataset.nfc, btn.dataset.name);
            break;
    }
});

function appendLog(service, entry) {
    const consoleEl = document.getElementById(SERVICE_CONSOLES[service]);
    if (!consoleEl) return;
    
    // Create log line
    const logLine = document.createElement('div');
    logLine.className = getLogColor(entry.level);
    const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false });
    logLine.innerHTML = `<span class="text-gray-600">${time}</span> ${escapeHtml(entry.message)}`;
    
    consoleEl.appendChild(logLine);
    
    // Trim old logs
    while (consoleEl.children.length > MAX_LOG_LINES) {
        consoleEl.removeChild(consoleEl.firstChild);
    }
    
    // Auto-scroll to bottom
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

function clearAllLogs() {
    Object.values(SERVICE_CONSOLES).forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.innerHTML = '<div class="text-gray-500">// Console cleared</div>';
        }
    });
}

async function refreshLogs() {
    try {
        const res = await fetch('/api/logs?lines=50', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to fetch logs');
        
        const data = await res.json();
        
        if (data.success && data.logs) {
            // Clear and populate each console
            Object.entries(data.logs).forEach(([service, logs]) => {
                const consoleEl = document.getElementById(SERVICE_CONSOLES[service]);
                if (consoleEl) {
                    consoleEl.innerHTML = logs.map(entry => formatLogEntry(entry)).join('');
                    consoleEl.scrollTop = consoleEl.scrollHeight;
                }
            });
        }
    } catch (e) {
        console.error('Failed to refresh logs:', e);
        Swal.fire({
            icon: 'warning',
            title: 'Logs Unavailable',
            text: 'journalctl not available. Deploy to Raspberry Pi for live logs.',
            confirmButtonColor: '#0a8249'
        });
    }
}

function toggleLogStream() {
    if (isStreamingLogs) {
        stopLogStream();
    } else {
        startLogStream();
    }
}

function startLogStream() {
    if (isStreamingLogs) return;
    
    // Connect to Socket.IO for live logs
    if (typeof io === 'undefined') {
        // Load Socket.IO if not already loaded
        const script = document.createElement('script');
        script.src = '/socket.io/socket.io.js';
        script.onload = () => initLogSocket();
        document.head.appendChild(script);
    } else {
        initLogSocket();
    }
}

function initLogSocket() {
    logSocket = io();
    
    logSocket.on('connect', () => {
        isStreamingLogs = true;
        updateStreamUI(true);
        
        // Subscribe to all service logs
        logSocket.emit('logs:subscribe', ['buttons', 'hardware', 'server']);
        
        // Update status indicators
        updateServiceStatus('buttons', 'streaming');
        updateServiceStatus('hardware', 'streaming');
        updateServiceStatus('server', 'streaming');
    });
    
    logSocket.on('connect_error', (err) => {
        // Show connection errors in all console panes
        ['buttons', 'hardware', 'server'].forEach(svc => {
            appendLog(svc, {
                timestamp: new Date().toISOString(),
                message: `Socket connection failed: ${err.message}`,
                level: 'error'
            });
        });
        isStreamingLogs = false;
        updateStreamUI(false);
    });
    
    logSocket.on('logs:entry', (entry) => {
        appendLog(entry.service, entry);
    });
    
    logSocket.on('logs:error', (data) => {
        appendLog(data.service, {
            timestamp: new Date().toISOString(),
            message: `ERROR: ${data.error}`,
            level: 'error'
        });
    });
    
    logSocket.on('disconnect', () => {
        isStreamingLogs = false;
        updateStreamUI(false);
        updateServiceStatus('buttons', 'disconnected');
        updateServiceStatus('hardware', 'disconnected');
        updateServiceStatus('server', 'disconnected');
    });
}

function stopLogStream() {
    if (logSocket) {
        logSocket.emit('logs:unsubscribe');
        logSocket.disconnect();
        logSocket = null;
    }
    isStreamingLogs = false;
    updateStreamUI(false);
    updateServiceStatus('buttons', 'idle');
    updateServiceStatus('hardware', 'idle');
    updateServiceStatus('server', 'idle');
}

function updateStreamUI(isActive) {
    const btn = document.getElementById('btn-stream-toggle');
    const status = document.getElementById('logs-status');
    
    if (isActive) {
        btn.innerHTML = '<i class="fas fa-stop mr-1"></i><span>Stop Live</span>';
        btn.classList.remove('bg-feu-green', 'hover:bg-feu-green-dark');
        btn.classList.add('bg-red-500', 'hover:bg-red-600');
        status.innerHTML = '<i class="fas fa-circle text-green-500 mr-1 animate-pulse"></i>Live';
        status.classList.remove('bg-gray-100', 'text-gray-500');
        status.classList.add('bg-green-100', 'text-green-700');
    } else {
        btn.innerHTML = '<i class="fas fa-play mr-1"></i><span>Start Live</span>';
        btn.classList.remove('bg-red-500', 'hover:bg-red-600');
        btn.classList.add('bg-feu-green', 'hover:bg-feu-green-dark');
        status.innerHTML = '<i class="fas fa-circle text-gray-500 mr-1"></i>Disconnected';
        status.classList.remove('bg-green-100', 'text-green-700');
        status.classList.add('bg-gray-100', 'text-gray-500');
    }
}

function updateServiceStatus(service, state) {
    const statusEl = document.getElementById(`status-${service}`);
    if (!statusEl) return;
    
    const states = {
        'idle': '<i class="fas fa-circle text-gray-500 mr-1"></i>idle',
        'streaming': '<i class="fas fa-circle text-green-400 mr-1 animate-pulse"></i>live',
        'disconnected': '<i class="fas fa-circle text-red-400 mr-1"></i>offline'
    };
    
    statusEl.innerHTML = states[state] || states['idle'];
}

// ========================================
// INIT
// ========================================
checkAuth();

// ========================================
// ARCHIVE TAB
// ========================================
let archiveStudentList  = [];
let archiveSectionList  = [];
let archiveAttendanceCache = [];

async function initArchiveTab() {
    await Promise.all([
        loadArchiveStats(),
        loadArchiveDropdowns(),
        loadArchivesList()
    ]);
}

// --- Stats ---
async function loadArchiveStats() {
    try {
        const res  = await fetch('/api/archive/stats', { credentials: 'include' });
        const data = await res.json();
        if (!data.success) return;
        const s = data.stats;
        document.getElementById('astat-total').textContent    = s.total;
        document.getElementById('astat-today').textContent    = s.today;
        document.getElementById('astat-dates').textContent    = s.uniqueDates;
        document.getElementById('astat-sections').textContent = s.uniqueSections;
        document.getElementById('astat-students').textContent = s.uniqueStudents;
        document.getElementById('astat-archives').textContent = s.archives;
    } catch (e) {
        console.error('[Archive] stats error:', e);
    }
}

// --- Populate dropdowns for archive + clear forms ---
async function loadArchiveDropdowns() {
    try {
        const [studRes, secRes] = await Promise.all([
            fetch('/api/archive/students', { credentials: 'include' }),
            fetch('/api/archive/sections',  { credentials: 'include' })
        ]);
        const studData = await studRes.json();
        const secData  = await secRes.json();

        archiveStudentList = studData.success ? studData.students : [];
        archiveSectionList = secData.success  ? secData.sections  : [];

        // Populate student selects
        const studentOpts = archiveStudentList.length
            ? archiveStudentList.map(s => `<option value="${s.nfc_id}">${s.name} (${s.section})</option>`).join('')
            : '<option value="">No students in attendance</option>';

        ['archive-student', 'clear-student'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<option value="">Select student...</option>' + studentOpts;
        });

        // Populate bulk multi-select
        const bulkEl = document.getElementById('archive-bulk-students');
        if (bulkEl) bulkEl.innerHTML = studentOpts || '<option value="">No students in attendance</option>';

        // Populate section selects
        const sectionOpts = archiveSectionList.length
            ? archiveSectionList.map(s => `<option value="${s.section}">${s.section} (${s.count} records)</option>`).join('')
            : '<option value="">No sections in attendance</option>';

        ['archive-section', 'clear-section', 'view-filter-section'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            if (id === 'view-filter-section') {
                el.innerHTML = '<option value="">All Sections</option>' + sectionOpts;
            } else {
                el.innerHTML = '<option value="">Select section...</option>' + sectionOpts;
            }
        });

    } catch (e) {
        console.error('[Archive] dropdown error:', e);
    }
}

// --- View Attendance Table ---
async function loadArchiveAttendance() {
    const date    = document.getElementById('view-filter-date').value;
    const section = document.getElementById('view-filter-section').value;

    const tbody = document.getElementById('archive-attendance-tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-gray-400 text-sm"><i class="fas fa-spinner fa-spin mr-2"></i>Loading...</td></tr>';

    try {
        let url = '/api/archive/attendance?limit=200';
        if (date)    url += `&date=${date}`;
        if (section) url += `&section=${encodeURIComponent(section)}`;

        const res  = await fetch(url, { credentials: 'include' });
        const data = await res.json();

        if (!data.success) {
            tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-6 text-center text-red-400 text-sm">${data.error}</td></tr>`;
            return;
        }

        archiveAttendanceCache = data.records;
        renderArchiveTable(data.records);
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-red-400 text-sm">Failed to load attendance</td></tr>';
    }
}

function renderArchiveTable(records) {
    const tbody = document.getElementById('archive-attendance-tbody');
    const count = document.getElementById('archive-attendance-count');

    if (!records.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-400 text-sm">No records found</td></tr>';
        count.textContent = '';
        return;
    }

    tbody.innerHTML = records.map((r, i) => {
        const statusColor = {
            present: 'bg-green-100 text-green-700',
            late:    'bg-yellow-100 text-yellow-700',
            absent:  'bg-red-100 text-red-700',
            excused: 'bg-blue-100 text-blue-700'
        }[r.status || 'present'] || 'bg-gray-100 text-gray-700';

        const datePart = (r.date || '').split(' ')[0];
        const timePart = (r.date || r.time || '').split(' ')[1] || r.time || '';

        return `<tr class="hover:bg-gray-50">
            <td class="px-3 sm:px-4 py-2 text-gray-500 text-xs">${i + 1}</td>
            <td class="px-3 sm:px-4 py-2 font-medium text-gray-800">${r.name || '-'}</td>
            <td class="px-3 sm:px-4 py-2 text-gray-600">${r.section || '-'}</td>
            <td class="px-3 sm:px-4 py-2 text-gray-600">${datePart}</td>
            <td class="px-3 sm:px-4 py-2 text-gray-600">${timePart}</td>
            <td class="px-3 sm:px-4 py-2"><span class="px-2 py-0.5 rounded-full text-xs font-medium ${statusColor}">${r.status || 'present'}</span></td>
        </tr>`;
    }).join('');

    count.textContent = `Showing ${records.length} record${records.length !== 1 ? 's' : ''}`;
}

function filterArchiveTable() {
    const name = document.getElementById('view-filter-name').value.toLowerCase();
    const filtered = name
        ? archiveAttendanceCache.filter(r => (r.name || '').toLowerCase().includes(name))
        : archiveAttendanceCache;
    renderArchiveTable(filtered);
}

// --- Archives List ---
async function loadArchivesList() {
    const tbody = document.getElementById('archives-list-tbody');
    const count = document.getElementById('archives-list-count');
    tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-6 text-center text-gray-400 text-sm"><i class="fas fa-spinner fa-spin mr-2"></i>Loading...</td></tr>';

    try {
        const res  = await fetch('/api/archive/list', { credentials: 'include' });
        const data = await res.json();

        if (!data.success || !data.archives.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-400 text-sm">No archives yet</td></tr>';
            count.textContent = '';
            return;
        }

        tbody.innerHTML = data.archives.map((a, i) => {
            const at = a.archivedAt ? new Date(a.archivedAt).toLocaleString() : '-';
            return `<tr class="hover:bg-gray-50">
                <td class="px-3 sm:px-4 py-2 text-gray-500 text-xs">${i + 1}</td>
                <td class="px-3 sm:px-4 py-2 font-mono text-xs text-gray-700 break-all">${a.name}</td>
                <td class="px-3 sm:px-4 py-2 text-center"><span class="px-2 py-0.5 bg-feu-light text-feu-green rounded-full text-xs font-medium">${a.count}</span></td>
                <td class="px-3 sm:px-4 py-2 text-gray-600 text-xs">${at}</td>
                <td class="px-3 sm:px-4 py-2 text-gray-600 text-xs">${a.archivedBy || '-'}</td>
            </tr>`;
        }).join('');

        count.textContent = `${data.archives.length} archive batch${data.archives.length !== 1 ? 'es' : ''}`;
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-6 text-center text-red-400 text-sm">Failed to load archives</td></tr>';
    }
}

// --- Archive Run ---
async function archiveRun(scope) {
    const body = { scope };

    if (scope === 'date') {
        body.date = document.getElementById('archive-date').value;
        if (!body.date) {
            Swal.fire({ icon: 'warning', title: 'Date required', text: 'Please select a date.', confirmButtonColor: '#0a8249' });
            return;
        }
    }
    if (scope === 'student') {
        body.nfc_id = document.getElementById('archive-student').value;
        body.date   = document.getElementById('archive-student-date').value || undefined;
        if (!body.nfc_id) {
            Swal.fire({ icon: 'warning', title: 'Student required', text: 'Please select a student.', confirmButtonColor: '#0a8249' });
            return;
        }
    }
    if (scope === 'section') {
        body.section = document.getElementById('archive-section').value;
        body.date    = document.getElementById('archive-section-date').value || undefined;
        if (!body.section) {
            Swal.fire({ icon: 'warning', title: 'Section required', text: 'Please select a section.', confirmButtonColor: '#0a8249' });
            return;
        }
    }
    if (scope === 'bulk') {
        const sel = document.getElementById('archive-bulk-students');
        body.nfc_ids = Array.from(sel.selectedOptions).map(o => o.value).filter(Boolean);
        body.date    = document.getElementById('archive-bulk-date').value || undefined;
        if (!body.nfc_ids.length) {
            Swal.fire({ icon: 'warning', title: 'Students required', text: 'Select at least one student.', confirmButtonColor: '#0a8249' });
            return;
        }
    }

    const scopeLabel = { today: "today's", all: 'all', date: `date ${body.date}`, student: 'selected student', section: `section ${body.section}`, bulk: `${(body.nfc_ids||[]).length} students` }[scope];

    const confirm = await Swal.fire({
        icon: 'question',
        title: 'Archive Records',
        text: `Archive attendance for ${scopeLabel}? Records will be copied to archive storage.`,
        showCancelButton: true,
        confirmButtonColor: '#0a8249',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'Yes, Archive'
    });
    if (!confirm.isConfirmed) return;

    try {
        const res  = await fetch('/api/archive/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body)
        });
        const data = await res.json();

        if (!data.success) {
            Swal.fire({ icon: 'error', title: 'Archive Failed', text: data.error, confirmButtonColor: '#0a8249' });
            return;
        }

        Swal.fire({
            icon: 'success',
            title: 'Archived!',
            html: `<b>${data.count}</b> records archived.<br><span class="text-xs text-gray-500">${data.archiveName}</span>`,
            confirmButtonColor: '#0a8249'
        });
        await loadArchiveStats();
        await loadArchivesList();
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Archive request failed.', confirmButtonColor: '#0a8249' });
    }
}

// --- Archive Clear ---
async function archiveClear(scope) {
    const clearMode = document.querySelector('input[name="clear-mode"]:checked').value;
    const body = { scope, clearMode };

    if (scope === 'date') {
        body.date = document.getElementById('clear-date').value;
        if (!body.date) {
            Swal.fire({ icon: 'warning', title: 'Date required', text: 'Please select a date.', confirmButtonColor: '#0a8249' });
            return;
        }
    }
    if (scope === 'student') {
        body.nfc_id = document.getElementById('clear-student').value;
        body.date   = document.getElementById('clear-student-date').value || undefined;
        if (!body.nfc_id) {
            Swal.fire({ icon: 'warning', title: 'Student required', text: 'Please select a student.', confirmButtonColor: '#0a8249' });
            return;
        }
    }
    if (scope === 'section') {
        body.section = document.getElementById('clear-section').value;
        body.date    = document.getElementById('clear-section-date').value || undefined;
        if (!body.section) {
            Swal.fire({ icon: 'warning', title: 'Section required', text: 'Please select a section.', confirmButtonColor: '#0a8249' });
            return;
        }
    }

    const scopeLabel = { today: "today's", all: 'ALL (everything)', date: `date ${body.date}`, student: 'selected student', section: `section ${body.section}` }[scope];
    const modeLabel  = clearMode === 'archive_and_clear' ? 'Archive then delete' : 'DELETE with NO backup';
    const iconType   = scope === 'all' ? 'warning' : 'question';

    const confirm = await Swal.fire({
        icon: iconType,
        title: scope === 'all' ? 'Nuclear Clear!' : 'Clear Records',
        html: `<b>Records for ${scopeLabel}</b> will be permanently removed.<br><span class="text-sm text-gray-600">${modeLabel}</span>`,
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#6b7280',
        confirmButtonText: scope === 'all' ? 'Yes, Delete Everything' : 'Yes, Clear'
    });
    if (!confirm.isConfirmed) return;

    try {
        const res  = await fetch('/api/archive/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body)
        });
        const data = await res.json();

        if (!data.success) {
            Swal.fire({ icon: 'error', title: 'Clear Failed', text: data.error, confirmButtonColor: '#0a8249' });
            return;
        }

        const archivedNote = data.archived ? ` (${data.archived} backed up)` : '';
        Swal.fire({
            icon: 'success',
            title: 'Cleared!',
            text: `${data.deleted} records deleted${archivedNote}.`,
            confirmButtonColor: '#0a8249'
        });
        await loadArchiveStats();
        await loadArchiveDropdowns();
        archiveAttendanceCache = [];
        renderArchiveTable([]);
        await loadArchivesList();
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Clear request failed.', confirmButtonColor: '#0a8249' });
    }
}

// Hook archive tab into showTab
const _origShowTab = showTab;
showTab = function(tabName) {
    _origShowTab(tabName);
    if (tabName === 'archive') initArchiveTab();
};
