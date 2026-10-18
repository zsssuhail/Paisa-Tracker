/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: v('canvas'),
        sheet: v('sheet'),
        shelf: v('shelf'),
        ink: v('ink'),
        'ink-2': v('ink-2'),
        'ink-3': v('ink-3'),
        line: v('line'),
        accent: v('accent'),
        'on-accent': v('on-accent'),
        mist: v('mist'),
        warn: v('warn'),
        over: v('over'),
      },
      fontFamily: {
        sans: ['"Geist Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono Variable"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { card: '24px', sheet: '28px' },
      boxShadow: {
        card: '0 1px 2px rgb(24 24 27 / .04), 0 8px 24px -12px rgb(24 24 27 / .08)',
        lift: '0 2px 4px rgb(24 24 27 / .06), 0 16px 32px -12px rgb(24 24 27 / .18)',
      },
    },
  },
  plugins: [],
};
