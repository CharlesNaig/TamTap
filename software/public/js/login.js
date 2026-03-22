// ========================================
// MOBILE MENU
// ========================================
function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    const icon = document.getElementById('menu-icon');
    menu.classList.toggle('hidden');
    icon.classList.toggle('fa-bars');
    icon.classList.toggle('fa-times');
}

// ========================================
// LOGIN MODAL
// ========================================
function openModal() {
    const modal = document.getElementById('login-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('username').focus(), 100);
}

function closeModal() {
    const modal = document.getElementById('login-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.body.style.overflow = '';
    document.getElementById('login-form').reset();
    hideError();
}

document.getElementById('login-modal').addEventListener('click', (e) => {
    if (e.target.id === 'login-modal') closeModal();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
});



// ========================================
// ERROR HANDLING
// ========================================
function showError(msg) {
    document.getElementById('login-error-text').textContent = msg;
    document.getElementById('login-error').classList.remove('hidden');
}
function hideError() {
    document.getElementById('login-error').classList.add('hidden');
}

// ========================================
// AUTH CHECK + LOGIN SUBMIT
// ========================================
async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.user) {
                redirectByRole(data.user.role);
            }
        }
    } catch (e) {}
}

function redirectByRole(role) {
    if (role === 'admin') {
        navigateTo('/admin', 'Loading Admin Panel...');
    } else if (role === 'teacher') {
        navigateTo('/dashboard', 'Loading Dashboard...');
    } else {
        Swal.fire({
            icon: 'error',
            title: 'Access Denied',
            text: 'Only teachers and administrators can access.',
            confirmButtonColor: '#0a8249'
        });
    }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const btn = document.getElementById('login-btn');
    const btnText = document.getElementById('btn-text');
    const btnSpinner = document.getElementById('btn-spinner');

    if (!username || !password) {
        showError('Please enter username/email and password');
        return;
    }

    btn.disabled = true;
    btnText.textContent = 'Signing in...';
    btnSpinner.classList.remove('hidden');

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (data.success) {
            const meRes = await fetch('/api/auth/me', { credentials: 'include' });
            const meData = await meRes.json();

            if (meData.success && meData.user) {
                if (['teacher', 'admin'].includes(meData.user.role)) {
                    Swal.fire({
                        icon: 'success',
                        title: 'Welcome!',
                        text: `Logged in as ${meData.user.name}`,
                        timer: 1500,
                        showConfirmButton: false
                    }).then(() => redirectByRole(meData.user.role));
                } else {
                    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
                    showError('Access denied. Teachers and admins only.');
                }
            }
        } else {
            showError(data.error || 'Invalid username or password');
        }
    } catch (err) {
        showError('Unable to connect to server.');
    } finally {
        btn.disabled = false;
        btnText.textContent = 'Log In';
        btnSpinner.classList.add('hidden');
    }
});

checkAuth();

// ========================================
// HERO SLIDESHOW
// ========================================
const heroImages = [
    '/assets/backgrounds/Researchers.png',
    '/assets/backgrounds/Hero-page.png',
    '/assets/backgrounds/Hero-page-2.png',
    '/assets/backgrounds/Hero-page-3.png',
    '/assets/backgrounds/Hero-page-4.png',
    '/assets/backgrounds/Hero-page-5.png',
    '/assets/backgrounds/Hero-page-6.png',
    '/assets/backgrounds/Hero-page-7.png',
    '/assets/backgrounds/Hero-page-8.png'
];

let currentSlide = 0;
let slideInterval = null;
const SLIDE_DURATION = 8000;

function initSlideshow() {
    const container = document.getElementById('slides-container');
    const dotsContainer = document.getElementById('slideshow-dots');

    container.innerHTML = '<div class="slides-wrapper" id="slides-wrapper"></div>';
    const wrapper = document.getElementById('slides-wrapper');
    dotsContainer.innerHTML = '';

    heroImages.forEach((src, index) => {
        const slide = document.createElement('div');
        slide.className = 'hero-slide';
        slide.innerHTML = `<img src="${src}" alt="TAMTAP Hero ${index + 1}" loading="${index === 0 ? 'eager' : 'lazy'}">`;
        wrapper.appendChild(slide);

        const dot = document.createElement('button');
        dot.className = `slideshow-dot ${index === 0 ? 'active' : ''}`;
        dot.setAttribute('aria-label', `Go to slide ${index + 1}`);
        dot.onclick = () => goToSlide(index);
        dotsContainer.appendChild(dot);
    });

    if (heroImages.length <= 1) {
        document.querySelectorAll('.slideshow-arrow').forEach(el => el.style.display = 'none');
        dotsContainer.style.display = 'none';
    }

    startSlideshow();
}

function startSlideshow() {
    if (heroImages.length > 1) {
        slideInterval = setInterval(() => nextSlide(), SLIDE_DURATION);
    }
}

function stopSlideshow() {
    if (slideInterval) {
        clearInterval(slideInterval);
        slideInterval = null;
    }
}

function goToSlide(index) {
    const wrapper = document.getElementById('slides-wrapper');
    const dots = document.querySelectorAll('.slideshow-dot');

    dots[currentSlide]?.classList.remove('active');

    currentSlide = index;
    if (currentSlide >= heroImages.length) currentSlide = 0;
    if (currentSlide < 0) currentSlide = heroImages.length - 1;

    wrapper.style.transform = `translateX(-${currentSlide * 100}%)`;
    dots[currentSlide]?.classList.add('active');

    stopSlideshow();
    startSlideshow();
}

function nextSlide() { goToSlide(currentSlide + 1); }
function prevSlide() { goToSlide(currentSlide - 1); }

initSlideshow();

// ========================================
// STICKY NAVBAR — SCROLL SHADOW
// ========================================
const mainHeader = document.getElementById('main-header');

window.addEventListener('scroll', () => {
    if (window.scrollY > 10) {
        mainHeader.classList.add('scrolled');
    } else {
        mainHeader.classList.remove('scrolled');
    }
}, { passive: true });



// ========================================
// SECTION FADE-IN ON SCROLL (IntersectionObserver)
// ========================================
const fadeSections = document.querySelectorAll('.fade-section');
const fadeObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            fadeObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.15 });

fadeSections.forEach(section => fadeObserver.observe(section));

// ========================================
// INFO MODALS (Privacy, Terms, Researches)
// ========================================
function showInfoModal(type) {
    let title, content;

    switch(type) {
        case 'privacy':
            title = 'Privacy Terms';
            content = `
                <div class="text-left space-y-4">
                    <h3 class="font-bold text-feu-green">Data Privacy Act Compliance</h3>
                    <p class="text-gray-600 text-sm">
                        TAMTAP is committed to protecting your personal information in accordance with
                        the <strong>Data Privacy Act of 2012 (Republic Act No. 10173)</strong>.
                    </p>
                    <h4 class="font-semibold text-gray-800">Information We Collect:</h4>
                    <ul class="text-gray-600 text-sm list-disc pl-5 space-y-1">
                        <li>Student name and identification</li>
                        <li>NFC card data (encrypted)</li>
                        <li>Attendance timestamps</li>
                        <li>Face detection photos (stored locally)</li>
                    </ul>
                    <h4 class="font-semibold text-gray-800">Data Usage:</h4>
                    <p class="text-gray-600 text-sm">
                        All data collected is used solely for attendance tracking purposes
                        and is stored securely on local school servers. No data is transmitted
                        to external services.
                    </p>
                    <p class="text-gray-500 text-xs mt-4">
                        <i class="fas fa-shield-halved mr-1"></i>
                        Your data is protected under Philippine law.
                    </p>
                </div>
            `;
            break;

        case 'terms':
            title = 'Terms of Use';
            content = `
                <div class="text-left space-y-4">
                    <h3 class="font-bold text-feu-green">TAMTAP System Terms</h3>
                    <h4 class="font-semibold text-gray-800">Website Usage:</h4>
                    <ul class="text-gray-600 text-sm list-disc pl-5 space-y-1">
                        <li>This system is for authorized FEU Roosevelt personnel only</li>
                        <li>Teachers and administrators are provided login credentials</li>
                        <li>Unauthorized access attempts will be logged</li>
                    </ul>
                    <h4 class="font-semibold text-gray-800">Product Usage:</h4>
                    <ul class="text-gray-600 text-sm list-disc pl-5 space-y-1">
                        <li>NFC cards are assigned to registered students only</li>
                        <li>Cards must not be shared or transferred</li>
                        <li>Lost cards must be reported immediately</li>
                        <li>Face verification is required for security</li>
                    </ul>
                    <h4 class="font-semibold text-gray-800">System Guidelines:</h4>
                    <p class="text-gray-600 text-sm">
                        TAMTAP operates on a local network within school premises.
                        The system is designed for attendance monitoring and does not
                        perform facial recognition or store biometric data.
                    </p>
                </div>
            `;
            break;

        case 'researches':
            title = 'About This Research';
            content = `
                <div class="text-left space-y-4">
                    <h3 class="font-bold text-feu-green">TAMTAP Research Project</h3>
                    <p class="text-gray-600 text-sm">
                        <strong>Grade 12 ICT B Group 5 Capstone</strong><br>
                        FEU Roosevelt Marikina | S.Y. 2025–2026
                    </p>
                    <h4 class="font-semibold text-gray-800">Project Description:</h4>
                    <p class="text-gray-600 text-sm">
                        TAMTAP is an TamTap NFC-Based Attendance System designed to streamline
                        student check-ins using contactless technology, face detection
                        verification, and real-time monitoring through a LAN dashboard.
                    </p>
                    <h4 class="font-semibold text-gray-800">Research Team:</h4>
                    <p class="text-gray-600 text-sm">
                        Bjorn, Angeles et al.
                    </p>
                    <h4 class="font-semibold text-gray-800">Technologies Used:</h4>
                    <ul class="text-gray-600 text-sm list-disc pl-5 space-y-1">
                        <li>Raspberry Pi 4B with Pi Camera v2</li>
                        <li>RC522 NFC Reader</li>
                        <li>Node.js + Express.js Backend</li>
                        <li>MongoDB Database</li>
                        <li>Socket.IO for Real-time Updates</li>
                    </ul>
                </div>
            `;
            break;
    }

    Swal.fire({
        title: title,
        html: content,
        width: '500px',
        confirmButtonText: 'Close',
        confirmButtonColor: '#0a8249',
        customClass: {
            popup: 'rounded-xl'
        }
    });
}
