/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        surface: 'var(--surface)',
        text: 'var(--text)',
        primary: 'var(--primary)',
        border: 'var(--border)'
      },
      fontFamily: {
        sans: ['Inter', 'Geist Sans', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
