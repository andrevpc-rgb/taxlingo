/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Baloo 2"', '"Nunito"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
