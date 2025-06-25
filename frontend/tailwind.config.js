/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: 'class', // Enable class-based dark mode
    content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
    theme: {
      extend: {
        colors: {
          primary: '#0f172a',
          secondary: '#2563eb',
          accent: '#facc15',
          lightText: '#e0e7ff',
          error: '#f87171',
        },
        fontFamily: {
          sans: ['Poppins', 'ui-sans-serif', 'system-ui'],
        },
        boxShadow: {
          card: '0 4px 15px rgba(252, 204, 21, 0.4)',
        },
      },
    },
    plugins: [],
  };
  