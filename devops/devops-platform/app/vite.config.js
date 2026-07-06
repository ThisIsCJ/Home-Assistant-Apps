import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative asset paths so the bundle works under the Home Assistant
  // ingress sub-path (/api/hassio_ingress/<token>/) as well as at root.
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:4000'
    }
  }
})
