import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/**', 'env-config.js'],
      manifest: {
        name: 'Health Tracker',
        short_name: 'Health',
        description: 'Personal health and fitness tracker',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icons/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icons/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Cache all built assets
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff,woff2}'],

        // For navigation, serve index.html — but NOT for API or auth routes
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],

        runtimeCaching: [
          {
            // Never cache API responses — always go to network
            urlPattern: /^.*\/api\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            // env-config.js is injected at runtime by nginx — always fresh
            urlPattern: /\/env-config\.js$/i,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
