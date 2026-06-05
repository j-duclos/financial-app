/// <reference types="vitest/config" />
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Print Plaid redirect URI on dev server start (port may differ if 5173 is taken). */
function plaidDevHints(): Plugin {
  return {
    name: 'plaid-dev-hints',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const addr = server.httpServer?.address()
        const port =
          typeof addr === 'object' && addr && 'port' in addr
            ? addr.port
            : (server.config.server.port ?? 5173)
        const redirect = `http://localhost:${port}/plaid/oauth-return`
        console.log('')
        console.log('  Plaid (sandbox only) — allowlist in Dashboard → Developers → API:')
        console.log(`    ${redirect}`)
        console.log('')
        console.log('  Real banks (PLAID_ENV=production): http://localhost is NOT valid.')
        console.log('    • Easiest: use your Render app URL …/plaid/oauth-return')
        console.log(`    • Local HTTPS: new terminal → cd apps/web && npm run tunnel -- ${port}`)
        console.log('      The https://….lhr.life URL is printed in THAT terminal (not here).')
        console.log('      Open the app at that https URL; allowlist …/plaid/oauth-return in Plaid.')
        console.log('')
        if (port !== 5173) {
          console.log(`  ⚠ Port ${port}: another Vite is on 5173 — stop the duplicate or tunnel this port.`)
          console.log('')
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), plaidDevHints()],
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
