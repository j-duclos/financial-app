#!/usr/bin/env bash
# Public HTTPS → local Vite (default 5173). No install; uses SSH + https://localhost.run
#
# 1. Start Vite: npm run dev
# 2. Run: npm run tunnel
# 3. Copy ONE line that looks like: https://xxxxxxxx.lhr.life  (ignore the giant QR junk below it)
# 4. apps/web/.env.local → VITE_API_URL=<that https origin>
#    backend/.env → PLAID_REDIRECT_URI=<that origin>/plaid/oauth-return
#    Plaid Dashboard → Developers → API → same URI as PLAID_REDIRECT_URI
# 5. Restart Vite + Django. Leave this terminal open while you test.
set -euo pipefail
PORT="${1:-5173}"
echo ""
echo "=== localhost.run → http://127.0.0.1:${PORT} (Vite must already be running) ==="
echo ""
echo "  Right after you connect, localhost.run prints ONE useful line, e.g.:"
echo "    https://abcd1234ef56.lhr.life"
echo ""
echo "  Copy ONLY that URL. Everything after it (huge QR / blank squares) is noise — ignore it."
echo ""
exec ssh -o StrictHostKeyChecking=accept-new -R "80:127.0.0.1:${PORT}" nokey@localhost.run
