/**
 * TAMTAP Page Preloader
 * Shows walking mascot animation during page transitions
 * Include this script in all pages for consistent loading experience
 */

(function() {
    'use strict';

    // Minimum preloader display time: random between 3-5 seconds
    const MIN_PRELOADER_TIME = 3000 + Math.random() * 2000;
    let preloaderStartTime = Date.now();

    // Immediately cover the screen via CSS (no body needed)
    document.documentElement.classList.add('preloading');

    // Create preloader HTML
    function createPreloader() {
        if (document.getElementById('tamtap-preloader')) return;
        const preloader = document.createElement('div');
        preloader.id = 'tamtap-preloader';
        preloader.className = 'tamtap-preloader';
        preloader.innerHTML = `
            <div class="tamtap-preloader-content">
                <img src="/assets/animations/tamtap-walk.gif" alt="Loading..." class="tamtap-preloader-gif">
                <p class="tamtap-preloader-text">Loading <span>TAMTAP</span>...</p>
                <p class="tamtap-preloader-subtext">Please wait</p>
            </div>
        `;
        document.body.appendChild(preloader);
        return preloader;
    }

    // Inject preloader ASAP — don't wait for DOMContentLoaded
    function injectEarly() {
        if (document.body) {
            createPreloader();
        } else {
            // Body not ready yet — poll at next frame
            requestAnimationFrame(injectEarly);
        }
    }
    injectEarly();

    // Show preloader
    window.showPreloader = function(message) {
        let preloader = document.getElementById('tamtap-preloader');
        if (!preloader) {
            preloader = createPreloader();
        }
        
        if (message) {
            const textEl = preloader.querySelector('.tamtap-preloader-subtext');
            if (textEl) textEl.textContent = message;
        }
        
        preloader.classList.remove('hidden', 'fade-out');
    };

    // Hide preloader — slide up then hide
    window.hidePreloader = function() {
        const preloader = document.getElementById('tamtap-preloader');
        if (preloader) {
            // Remove the CSS instant-cover
            document.documentElement.classList.remove('preloading');
            // Slide the preloader up
            preloader.classList.add('slide-up');
            // After transition ends, fully hide
            setTimeout(() => {
                preloader.classList.add('hidden');
            }, 600);
        }
    };

    // Navigate with preloader
    window.navigateTo = function(url, message) {
        showPreloader(message || 'Redirecting...');
        setTimeout(() => {
            window.location.href = url;
        }, 200);
    };

    // Intercept navigation links
    function interceptLinks() {
        document.addEventListener('click', function(e) {
            const link = e.target.closest('a[href]');
            if (!link) return;
            
            const href = link.getAttribute('href');
            
            // Skip external links, anchors, and special links
            if (!href || 
                href.startsWith('#') || 
                href.startsWith('javascript:') ||
                href.startsWith('mailto:') ||
                href.startsWith('tel:') ||
                link.target === '_blank' ||
                link.hasAttribute('data-no-preloader')) {
                return;
            }
            
            // Skip if it's the current page
            if (href === window.location.pathname || 
                href === window.location.href) {
                return;
            }
            
            // Show preloader and navigate
            e.preventDefault();
            navigateTo(href);
        });
    }

    // Show preloader on form submissions that navigate
    function interceptForms() {
        document.addEventListener('submit', function(e) {
            const form = e.target;
            if (form.hasAttribute('data-no-preloader')) return;
            
            // Only for forms that navigate (not AJAX)
            if (!form.hasAttribute('data-ajax')) {
                // Don't show for login forms (they handle their own loading)
                if (form.id === 'login-form') return;
                
                showPreloader('Processing...');
            }
        });
    }

    // Show preloader before page unload
    function handlePageUnload() {
        window.addEventListener('beforeunload', function() {
            showPreloader('Loading...');
        });
    }

    // Hide preloader when page is fully loaded (respects minimum display time)
    function hideOnLoad() {
        function doHide() {
            const elapsed = Date.now() - preloaderStartTime;
            const remaining = MIN_PRELOADER_TIME - elapsed;
            
            if (remaining > 0) {
                setTimeout(hidePreloader, remaining);
            } else {
                hidePreloader();
            }
        }

        if (document.readyState === 'complete') {
            doHide();
        } else {
            window.addEventListener('load', doHide);
        }
    }

    // Initialize when DOM is ready (preloader already injected early)
    function initHandlers() {
        createPreloader(); // no-op if already injected
        interceptLinks();
        interceptForms();
        handlePageUnload();
        hideOnLoad();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initHandlers);
    } else {
        initHandlers();
    }
})();
