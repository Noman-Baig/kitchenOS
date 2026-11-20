#!/usr/bin/env bash
# One-time setup on a fresh server (Ubuntu/Debian). Run from the project root:  bash scripts/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1"; exit 1; }; }
need node; need npm; need mysql; need mysqldump
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$NODE_MAJOR" -ge 20 ] || { echo "Node.js 20+ required (found $(node -v))"; exit 1; }

[ -f backend/.env ] || { cp backend/.env.example backend/.env; echo ">> Created backend/.env — edit DB_*, APP_URL, FILE_SIGNING_SECRET then re-run."; exit 1; }
[ -f frontend/.env.production ] || cp frontend/.env.example frontend/.env.production

if ! grep -q '^FILE_SIGNING_SECRET=.\{32,\}' backend/.env; then
  echo ">> Generating FILE_SIGNING_SECRET"
  SECRET=$(openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-48)
  sed -i "s|^FILE_SIGNING_SECRET=.*|FILE_SIGNING_SECRET=${SECRET}|" backend/.env
fi

echo ">> Installing dependencies"
npm --prefix backend ci
npm --prefix frontend ci

echo ">> Building"
npm --prefix backend run build
rm -rf frontend/.next
npm --prefix frontend run build

echo ">> Preparing storage"
mkdir -p backend/storage
chmod 750 backend/storage

echo ">> Running migrations and base seed"
( cd backend && node dist/cli/migrate.js && node dist/cli/seed.js )

cat <<'EOF'

Setup complete. Next steps:
  1) Create the first Super Admin (password is prompted, hidden):
       cd backend && node dist/cli/createSuperAdmin.js --email you@yourdomain.com --name "Your Name"
  2) Start the processes:   pm2 start deployment/pm2/ecosystem.config.cjs   (or the systemd units)
  3) Configure nginx + HTTPS: deployment/nginx/umemaai.conf  (see docs/DEPLOYMENT.md)
  4) Optional: coturn for reliable voice calls (deployment/coturn/turnserver.conf)
  5) Health check:  bash scripts/healthcheck.sh https://app.example.com
EOF
