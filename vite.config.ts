import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base + hash routing means the build works on GitHub Pages,
// Netlify, a USB stick, wherever.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
})
