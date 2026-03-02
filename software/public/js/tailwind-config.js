/* ===========================================
   TAMTAP Shared Tailwind Configuration
   FEU Color Palette + Custom Breakpoints
   =========================================== */
tailwind.config = {
    theme: {
        screens: {
            'xs': '360px',
            'sm': '480px',
            'md': '768px',
            'lg': '1024px',
            'xl': '1280px',
            '2xl': '1536px',
            '3xl': '1920px'
        },
        extend: {
            colors: {
                'feu-green': '#0a8249',
                'feu-green-dark': '#034c16',
                'feu-green-light': '#0eb063',
                'feu-gold': '#FFD700',
                'feu-gold-dark': '#D4AF37'
            }
        }
    }
}
