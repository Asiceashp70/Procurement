#!/usr/bin/env bash
# macOS / Linux: same as start-test.bat
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node.js 22 LTS first"; exit 1; }
docker compose up -d --wait
node scripts/setup-env.mjs
[ -d backend/node_modules ] || (cd backend && npm ci)
[ -d frontend/node_modules ] || (cd frontend && npm ci)
(cd backend && npm run build && node scripts/wait-db.cjs && npm run seed:demo)
(cd backend && npm start) &
API=$!
(cd frontend && npm run dev -- --host) &
WEB=$!
trap 'kill $API $WEB 2>/dev/null' EXIT
echo "Open http://localhost:5173 (Ctrl+C to stop)"
wait
