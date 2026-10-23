/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        marca: {
          naranja: '#F4661B',
          'naranja-hover': '#DE5510',
          'naranja-suave': '#FFF0E6',
          'naranja-borde': 'rgba(244, 102, 27, 0.35)',
          azul: '#123C6B',
          'azul-hover': '#0E2E52',
          'azul-suave': '#EBF2FA',
          'azul-suave2': 'rgba(18, 60, 107, 0.08)',
          'azul-borde': 'rgba(18, 60, 107, 0.18)',
          crema: '#FFF6EC',
          carbon: '#1B1B1F',
          blanco: '#FFFFFF',
        },
      },
    },
  },
  plugins: [],
}
