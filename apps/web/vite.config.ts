/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  // Use patched react-plaid-link from node_modules (postinstall); avoid stale prebundle.
  optimizeDeps: {
    exclude: ["react-plaid-link"],
  },
  server: {
    // So https://*.lhr.life (localhost.run) and other tunnel hosts are not rejected by Vite
    host: true,
    allowedHosts: true,
    proxy: {
      // In dev, /api/* goes to backend so GET/POST/PUT/PATCH/DELETE all work without CORS
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
