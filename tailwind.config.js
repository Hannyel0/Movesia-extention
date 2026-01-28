/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/webviews/**/*.{js,jsx,ts,tsx,css}'],
  darkMode: 'class',
  theme: {
    extend: {},
  },
  plugins: [require('@githubocto/tailwind-vscode')],
}
