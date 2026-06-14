#!/usr/bin/env bash
# Maestro CRM — production deploy (runs on VPS after git pull)
set -euo pipefail

APP_DIR="/var/www/maestro_crm"
PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-app-maestro-school.duckdns.org}"

log() {
  echo "[crm-deploy] $*" >&2
}

if [ ! -d "$APP_DIR/backend" ]; then
  echo "CRM not found at ${APP_DIR}. Run first-time setup first." >&2
  exit 1
fi

if [ ! -f "$APP_DIR/backend/.env" ]; then
  echo "backend/.env missing. Create it on the server before CI deploy." >&2
  exit 1
fi

cd "$APP_DIR/backend"

log "Fixing frontend file permissions (rsync from macOS can leave mode 600)..."
find "$APP_DIR/frontend" -type f \( -name '*.css' -o -name '*.js' -o -name '*.html' -o -name '*.svg' \) ! -perm -004 -exec chmod a+r {} \; 2>/dev/null || true

log "Installing backend dependencies..."
rm -rf node_modules
npm ci --omit=dev

log "Prisma generate + schema sync..."
npx prisma generate
npx prisma db push --accept-data-loss

log "Syncing membership plan catalog..."
node -e "require('./src/services/membershipPlanSync').syncAllMembershipPlans().then(r => console.log('Membership plans synced:', r)).catch(e => { console.error(e); process.exit(1); })"

log "Restarting PM2..."
if pm2 describe maestro-crm-backend >/dev/null 2>&1; then
  pm2 restart maestro-crm-backend
else
  pm2 start ecosystem.config.js
fi
pm2 save

log "Health check..."
sleep 3
curl -fsS http://127.0.0.1:5000/api/health
curl -fsS -o /dev/null "https://${PUBLIC_DOMAIN}/login.html"

log "Deploy complete."
log "CRM: https://${PUBLIC_DOMAIN}/login.html"
