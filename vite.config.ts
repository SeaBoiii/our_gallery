import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // HEIC support is intentionally isolated in an on-demand chunk; it never
    // enters the initial gallery bundle.
    chunkSizeWarningLimit: 1400,
  },
})
