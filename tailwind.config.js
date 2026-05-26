/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // ── Atlantis Cyberpunk palette ───────────────────────────────────────────
      colors: {
        // Backgrounds – deep ocean abyss
        base:    '#030810',   // near-black ocean floor
        surface: '#060f1e',   // deep water surface
        panel:   '#091628',   // bioluminescent cave wall
        border:  '#0d2a40',   // teal-tinted border

        // Primary accent – bioluminescent cyan
        accent:       '#00e5ff',
        'accent-dim': '#00b8d4',
        'accent-glow':'rgba(0,229,255,0.18)',

        // Secondary – ancient amber (rune glow)
        amber:       '#ffb300',
        'amber-dim': '#e67e00',

        // Mystic purple
        mystic:      '#a855f7',
        'mystic-dim':'#7c3aed',

        // Neutral
        muted:        '#4a6880',
        'text-primary':'#e8f4f8',   // cool white like sea foam

        // Status
        success: '#00e5a0',   // bioluminescent green
        warning: '#ffb300',
        error:   '#ff3d6b',
        info:    '#00b8ff',
      },

      fontFamily: {
        sans:    ['Space Grotesk', 'system-ui', 'sans-serif'],
        mono:    ['JetBrains Mono', 'ui-monospace', 'Consolas', 'monospace'],
        display: ['Orbitron', 'Space Grotesk', 'sans-serif'],   // for bKG logo / headings
      },

      animation: {
        'blink':        'blink 1s step-end infinite',
        'slide-in':     'slideIn 0.35s cubic-bezier(0.16,1,0.3,1)',
        'fade-in':      'fadeIn 0.3s ease-out',
        'glow-pulse':   'glowPulse 3s ease-in-out infinite',
        'scan':         'scan 8s linear infinite',
        'drift':        'drift 20s ease-in-out infinite',
        'ripple':       'ripple 0.6s ease-out',
        'rune-spin':    'runeSpin 12s linear infinite',
        'data-stream':  'dataStream 2s linear infinite',
        'float':        'float 6s ease-in-out infinite',
      },

      keyframes: {
        blink:       { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0' } },
        slideIn:     { from: { opacity: '0', transform: 'translateY(10px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        fadeIn:      { from: { opacity: '0' }, to: { opacity: '1' } },
        glowPulse:   {
          '0%, 100%': { boxShadow: '0 0 15px rgba(0,229,255,0.15), 0 0 40px rgba(0,229,255,0.05)' },
          '50%':      { boxShadow: '0 0 25px rgba(0,229,255,0.35), 0 0 60px rgba(0,229,255,0.12)' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        drift: {
          '0%, 100%': { transform: 'translate(0,0) rotate(0deg)' },
          '33%':      { transform: 'translate(2px,-3px) rotate(0.5deg)' },
          '66%':      { transform: 'translate(-2px,2px) rotate(-0.3deg)' },
        },
        ripple: {
          '0%':   { transform: 'scale(1)', opacity: '0.6' },
          '100%': { transform: 'scale(1.8)', opacity: '0' },
        },
        runeSpin: {
          from: { transform: 'rotate(0deg)' },
          to:   { transform: 'rotate(360deg)' },
        },
        dataStream: {
          '0%':   { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '0 60px' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-6px)' },
        },
      },

      backgroundImage: {
        'ocean-gradient':    'radial-gradient(ellipse at 50% 0%, rgba(0,229,255,0.08) 0%, transparent 60%)',
        'abyss-gradient':    'radial-gradient(ellipse at 20% 80%, rgba(168,85,247,0.06) 0%, transparent 50%)',
        'grid-atlantis':     "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Cpath d='M60 0 L0 0 0 60' stroke='rgba(0,229,255,0.04)' fill='none'/%3E%3C/svg%3E\")",
        'hex-pattern':       "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='92'%3E%3Cpolygon points='40,2 78,22 78,70 40,90 2,70 2,22' fill='none' stroke='rgba(0,229,255,0.03)' stroke-width='1'/%3E%3C/svg%3E\")",
      },

      boxShadow: {
        'glow-sm':  '0 0 8px rgba(0,229,255,0.25), 0 0 20px rgba(0,229,255,0.08)',
        'glow':     '0 0 15px rgba(0,229,255,0.3),  0 0 40px rgba(0,229,255,0.1)',
        'glow-lg':  '0 0 25px rgba(0,229,255,0.4),  0 0 60px rgba(0,229,255,0.15)',
        'glow-mystic': '0 0 15px rgba(168,85,247,0.3), 0 0 40px rgba(168,85,247,0.1)',
        'glow-amber':  '0 0 15px rgba(255,179,0,0.3),  0 0 40px rgba(255,179,0,0.1)',
        'deep':     '0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.3)',
        'card':     '0 4px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(0,229,255,0.05)',
      },

      borderRadius: {
        'xl':  '12px',
        '2xl': '16px',
        '3xl': '24px',
      },

      screens: {
        'xs': '400px',
      },
    },
  },
  plugins: [],
};
