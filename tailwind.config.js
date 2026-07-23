/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Azul institucional de la app. `brand-600` es el primario de acciones
        // (#1B4FD8) y se reutiliza como theme_color/background del manifest
        // (ver vite.config.ts e index.html — mantenerlos en sincronía).
        //
        // El resto de la paleta del diseño coincide con Tailwind stock, así que
        // NO se duplica aquí: success=green-600, warning=amber-600,
        // error=red-600, bg=slate-50, texto=slate-900, apagado=slate-500,
        // borde=slate-200.
        brand: {
          50: '#eef2ff',
          100: '#dbe4ff',
          200: '#bfcdfe',
          300: '#93aafc',
          400: '#6182f7',
          500: '#2e5ae8',
          600: '#1b4fd8',
          700: '#1740ae',
          800: '#163688',
          900: '#172f6b',
        },
      },
    },
  },
  plugins: [],
}
