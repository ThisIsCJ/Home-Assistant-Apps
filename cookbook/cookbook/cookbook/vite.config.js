import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' makes all built asset URLs relative, so they resolve correctly
// under the Home Assistant ingress path prefix without knowing it at build time.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // Proxy API calls to the local server during `npm run dev`.
    proxy: {
      '/api': 'http://localhost:4100',
    },
  },
});
