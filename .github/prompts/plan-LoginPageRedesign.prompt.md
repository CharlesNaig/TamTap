# 📋 Plan: Login Page → Homepage Redesign

**Status:** DRAFT — Awaiting approval  
**Author:** Copilot  
**Date:** 2026-02-08  
**Scope:** `software/public/login.html` (full rewrite)

---

## 🧠 Problem Statement

**Current state:** `login.html` is a fixed-height, non-scrollable page with a hero slideshow, a static green bottom bar, and a login modal. It feels empty — just a slideshow and a button. No context about TAMTAP for first-time visitors.

**Goal:** Transform it into a **scrollable homepage** inspired by [feuroosevelt.edu.ph](https://feuroosevelt.edu.ph/) — sections describing TAMTAP, the school, the research team — with the login modal remaining the primary action. The green "Log In" bar becomes a **smart sticky bar** that hides on scroll-down and reappears on scroll-up.

---

## 🏗️ Page Architecture (Top → Bottom)

### Section 1: Sticky Navbar (Header)
**Inspired by:** FEU Roosevelt top nav (white, clean, logo left, links right)

```
┌─────────────────────────────────────────────────────────────┐
│  [TamTap-3D.png] TAMTAP      Privacy | Terms | Research  ☰ │
└─────────────────────────────────────────────────────────────┘
```

**Changes from current:**
- ✅ Keep `TamTap-3D.png` icon on the left (already there)
- ✅ Keep "TAMTAP" wordmark (green + gold)
- 🔄 Make header **sticky** (`position: sticky; top: 0; z-index: 40`) so it stays visible while scrolling
- 🔄 Add subtle **shadow-on-scroll** effect (no shadow at top, shadow appears when scrolled)
- 🔄 Add a `Log In` button on the right side of navbar (desktop only, small, outlined) — so users can log in without scrolling back to bottom bar
- ✅ Keep mobile hamburger menu as-is

**Navbar structure (desktop):**
```
[Icon] TAMTAP          Privacy  Terms  Research  [Log In →]
```

**Navbar structure (mobile):**
```
[Icon] TAMTAP                                    [☰]
```
Mobile menu adds `Log In` as the last item.

### Section 2: Hero Slideshow (Keep Existing)
**No changes to slideshow logic.** Just layout adjustments:

- 🔄 Remove `overflow: hidden` on `html, body` — page is now scrollable
- 🔄 Hero section gets a **fixed height** instead of `flex: 1`:
  - Desktop: `h-[85vh]` (85% of viewport)
  - Tablet: `h-[70vh]`
  - Mobile: `h-[55vh]`
- ✅ Keep arrows, dots, auto-play, swipe animation
- 🔄 Add a **gradient overlay** at bottom of hero for smooth transition to next section
- 🔄 Optional: Add overlay text on hero — "NFC-Based Attendance System" tagline

**Hero overlay text (centered on slideshow):**
```
         TAMTAP
  NFC-Based Attendance System
  FEU Roosevelt Marikina
        [Log In]
```

### Section 3: "What is TAMTAP?" (Feature Intro)
**Inspired by:** FEU Roosevelt's "Future-Ready Learning" section

```
┌─────────────────────────────────────────────────┐
│                                                 │
│            What is TAMTAP?                      │
│                                                 │
│   A locally hosted, NFC-based attendance        │
│   system designed for FEU Roosevelt Marikina.   │
│   Powered by Raspberry Pi with camera           │
│   verification and real-time monitoring.        │
│                                                 │
│   Capstone By Group 5 of Grade 12 ICT B
 | S.Y. 2025-2026       │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Layout:**
- White background
- Centered text, max-w-3xl
- Heading: `text-3xl font-bold text-feu-green`
- Body: `text-gray-600 text-lg leading-relaxed`
- Small subtitle: `text-feu-gold font-medium`
- Padding: `py-16 sm:py-20 lg:py-24`

### Section 4: Feature Cards (3-Column Grid)
**Inspired by:** FEU Roosevelt's Basic Education / Higher Education cards

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   📡 NFC     │  │   📸 Camera  │  │   📊 Live    │
│   Tap-In     │  │   Verify     │  │   Dashboard  │
│              │  │              │  │              │
│  Tap your    │  │  Face detect │  │  Real-time   │
│  card to     │  │  confirms    │  │  attendance  │
│  check in    │  │  identity    │  │  monitoring  │
└──────────────┘  └──────────────┘  └──────────────┘
```

**Layout:**
- Light gray background (`bg-gray-50`)
- 3 cards: `grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8`
- Each card: white, rounded-xl, shadow, padding, icon + title + description
- Icons: FontAwesome (`fa-wifi` for NFC, `fa-camera` for camera, `fa-chart-line` for dashboard)
- Padding: `py-16 sm:py-20`

### Section 5: How It Works (Process Steps)
**Simple 4-step horizontal timeline**

```
  ①  Tap NFC Card  →  ②  Face Detection  →  ③  Attendance Logged  →  ④  Dashboard Updated
```

**Layout:**
- White background
- 4 steps in a row (desktop) or stacked (mobile)
- Each step: number circle + icon + short text
- Green connecting lines between steps (desktop)
- Padding: `py-16`

### Section 6: About the Research
**Inspired by:** FEU Roosevelt's campus section + "The Tamaraw Community" CTA

```
┌─────────────────────────────────────────────────┐
│  [Researchers.png image]  │  About This Research│
│                           │                     │
│                           │  Grade 12 ICT       │
│                           │  Capstone Project   │
│                           │  FEU Roosevelt      │
│                           │  Marikina           │
│                           │  S.Y. 2025-2026     │
│                           │                     │
│                           │  Charles Giann      │
│                           │  Marcelo et al.     │
└─────────────────────────────────────────────────┘
```

**Layout:**
- 2-column: image left, text right (`grid grid-cols-1 lg:grid-cols-2`)
- Use existing `Researchers.png` from `/assets/backgrounds/`
- Image with rounded corners, slight shadow
- Text side: title, description, team credit
- Background: `bg-gray-50`

### Section 7: Technology Stack (Optional — Small Section)
**Quick visual of the tech used**

```
  Raspberry Pi  •  Node.js  •  MongoDB  •  Socket.IO  •  OpenCV
```

**Layout:**
- Single row of tech names/icons
- Subtle gray text, small font
- White background
- `py-8` padding — keep it minimal

### Section 8: Footer
**Inspired by:** FEU Roosevelt footer (dark green, links, copyright)

```
┌─────────────────────────────────────────────────────────────┐
│  bg-feu-green-dark                                          │
│                                                             │
│  TAMTAP                    Quick Links     Contact           │
│  NFC-Based Attendance      Privacy Terms   FEU Roosevelt    │
│  FEU Roosevelt Marikina    Terms of Use    Marikina Campus  │
│                            Researches                       │
│                                                             │
│  ──────────────────────────────────────────────────────────  │
│  © 2025 Developed by Naig  •  github.com/CharlesNaig       │
│  Capstone By Group 5 of Grade 12 ICT B
 | FEU Roosevelt Marikina             │
└─────────────────────────────────────────────────────────────┘
```

**Layout:**
- Dark green background (`bg-feu-green-dark` or `bg-[#034c16]`)
- White/gold text
- 3 columns (desktop): Brand | Links | Contact
- Divider line
- Copyright row at bottom
- Padding: `py-12`

---

## 🎯 Smart Sticky "Log In" Bottom Bar

**Behavior:** Fixed green bar at the bottom of viewport. **Hides on scroll-down, reappears on scroll-up.** This is the primary CTA for mobile users who may not see the navbar login button.

**Implementation — Scroll Direction Detection:**

```javascript
let lastScrollY = 0;
const bottomBar = document.getElementById('login-bottom-bar');

window.addEventListener('scroll', () => {
    const currentScrollY = window.scrollY;
    
    if (currentScrollY > lastScrollY && currentScrollY > 100) {
        // Scrolling DOWN — hide bar
        bottomBar.classList.add('translate-y-full');
        bottomBar.classList.remove('translate-y-0');
    } else {
        // Scrolling UP — show bar
        bottomBar.classList.remove('translate-y-full');
        bottomBar.classList.add('translate-y-0');
    }
    
    lastScrollY = currentScrollY;
}, { passive: true });
```

**CSS:**
```css
#login-bottom-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 30;
    transition: transform 0.3s ease;
}
```

**HTML stays the same** — just add `id="login-bottom-bar"` and move it outside the page-container to fixed position.

---

## 📁 Available Assets (Already in Project)

| Asset | Path | Usage |
|-------|------|-------|
| TamTap-3D.png | `/assets/TamTap-3D.png` | Navbar icon (already used) |
| FeuXTamTap.png | `/assets/FeuXTamTap.png` | Hero overlay or about section |
| TamTap-wteachers.png | `/assets/logos/TamTap-wteachers.png` | Login modal header (keep) |
| TamTap-StudentCentral.png | `/assets/logos/TamTap-StudentCentral.png` | Feature section or about |
| TAMTAP-Hugging.png | `/assets/TAMTAP-Hugging.png` | Login modal mascot (keep) |
| Hero-page.png | `/assets/backgrounds/Hero-page.png` | Slideshow slide 1 |
| Hero-page-2.png | `/assets/backgrounds/Hero-page-2.png` | Slideshow slide 2 |
| Researchers.png | `/assets/backgrounds/Researchers.png` | About section image |

---

## 🔄 What Changes vs. What Stays

| Component | Status | Notes |
|-----------|--------|-------|
| Navbar | 🔄 Upgrade | Add sticky, scroll shadow, Login button on desktop |
| Hero slideshow | 🔄 Adjust | Fixed height instead of flex, add text overlay |
| Slideshow JS | ✅ Keep | Same auto-play, arrows, dots logic |
| Login modal | ✅ Keep | Same form, mascot, error handling, auth flow |
| Login form JS | ✅ Keep | Same fetch, redirect, error handling |
| Info modals (Privacy/Terms/Research) | ✅ Keep | Same SweetAlert2 modals |
| `preloader.css` / `preloader.js` | ✅ Keep | Page transition preloader |
| Bottom green bar | 🔄 Upgrade | Fixed → smart sticky (hide on scroll down, show on scroll up) |
| New: "What is TAMTAP" section | 🆕 Add | Description intro |
| New: Feature cards section | 🆕 Add | 3 cards (NFC, Camera, Dashboard) |
| New: How it works section | 🆕 Add | 4-step process |
| New: About research section | 🆕 Add | Image + text |
| New: Tech stack row | 🆕 Add | Minimal tech list |
| New: Footer | 🆕 Add | Dark green, links, copyright |

---

## ⚠️ Constraints (Per Copilot Contract)

- **Vanilla JS only** — no React/Vue/Angular
- **Tailwind CSS via CDN** — same as current
- **SweetAlert2** for modals — same as current
- **FontAwesome** for icons — same as current
- **Fetch API only** — no Axios
- **Multi-page HTML** — not SPA
- **No cloud services** — LAN only

---

## ✅ Implementation Checklist

- [ ] Remove `overflow: hidden` from `html, body` — make page scrollable
- [ ] Remove `.page-container` flex layout — use normal document flow
- [ ] Upgrade navbar: sticky, scroll shadow effect, desktop Login button
- [ ] Adjust hero slideshow to fixed height (`h-[85vh]` / `h-[70vh]` / `h-[55vh]`)
- [ ] Add gradient overlay + text overlay on hero slideshow
- [ ] Add Section 3: "What is TAMTAP?" intro text
- [ ] Add Section 4: Feature cards (3-column grid)
- [ ] Add Section 5: How It Works (4-step process)
- [ ] Add Section 6: About the Research (image + text)
- [ ] Add Section 7: Tech stack row (minimal)
- [ ] Add Section 8: Footer (dark green, links, copyright)
- [ ] Upgrade bottom bar: fixed position with scroll-direction hide/show
- [ ] Keep login modal unchanged
- [ ] Keep slideshow JS unchanged (just container structure adjusts)
- [ ] Keep info modal JS unchanged (SweetAlert2)
- [ ] Keep auth JS unchanged (checkAuth, login submit, redirectByRole)
- [ ] Test: Page scrolls smoothly through all sections
- [ ] Test: Bottom bar hides on scroll down, shows on scroll up
- [ ] Test: Login modal works from both navbar button and bottom bar
- [ ] Test: Mobile hamburger menu includes Login option
- [ ] Test: Responsive breakpoints (mobile, tablet, desktop)

---

**Ready for review. Say "implement" to proceed.**
