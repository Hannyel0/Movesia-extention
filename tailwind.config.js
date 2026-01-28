/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: ['./src/webviews/**/*.{js,jsx,ts,tsx,css}'],
  theme: {
    extend: {
      colors: {
        border: 'var(--vscode-panel-border)',
        input: 'var(--vscode-input-background)',
        ring: 'var(--vscode-focusBorder)',
        background: 'var(--vscode-editor-background)',
        foreground: 'var(--vscode-editor-foreground)',
        primary: {
          DEFAULT: 'var(--vscode-button-background)',
          foreground: 'var(--vscode-button-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--vscode-button-secondaryBackground)',
          foreground: 'var(--vscode-button-secondaryForeground)',
        },
        destructive: {
          DEFAULT: 'var(--vscode-errorForeground)',
          foreground: 'var(--vscode-editor-foreground)',
        },
        muted: {
          DEFAULT: 'var(--vscode-input-background)',
          foreground: 'var(--vscode-descriptionForeground)',
        },
        accent: {
          DEFAULT: 'var(--vscode-list-activeSelectionBackground)',
          foreground: 'var(--vscode-list-activeSelectionForeground)',
        },
        popover: {
          DEFAULT: 'var(--vscode-editorWidget-background)',
          foreground: 'var(--vscode-editorWidget-foreground)',
        },
        card: {
          DEFAULT: 'var(--vscode-editorWidget-background)',
          foreground: 'var(--vscode-editorWidget-foreground)',
        },
      },
      borderRadius: {
        lg: '6px',
        md: '4px',
        sm: '2px',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('@githubocto/tailwind-vscode'), require('tailwindcss-animate')],
}
