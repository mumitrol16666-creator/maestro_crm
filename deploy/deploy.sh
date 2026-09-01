#!/usr/bin/env bash
# Maestro CRM production deploy. Runs on the VPS for one immutable release SHA.
set -euo pipefail

APP_DIR="/var/www/maestro_crm"
PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-app-maestro-school.duckdns.org}"
BASELINE_MIGRATION="20260831010000_baseline_remote_main"
BASELINE_SCHEMA="prisma/baselines/20260831_remote_main/schema.prisma"
BACKUP_DIR="$APP_DIR/backups"
STATE_DIR="$APP_DIR/deploy-state"
POSTGRES_TOOLS_IMAGE="${POSTGRES_TOOLS_IMAGE:-postgres:16-alpine}"

log() {
  echo "[crm-deploy] $*" >&2
}

fail() {
  echo "[crm-deploy] ERROR: $*" >&2
  exit 1
}

if [ ! -d "$APP_DIR/backend" ]; then
  fail "CRM not found at ${APP_DIR}. Run first-time setup first."
fi
if [ ! -f "$APP_DIR/backend/.env" ]; then
  fail "backend/.env is missing"
fi

cd "$APP_DIR/backend"

requested_release_sha="${RELEASE_SHA:-$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || true)}"
requested_release_built_at="${RELEASE_BUILT_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
previous_release_sha="$(curl -fsS http://127.0.0.1:5000/api/health 2>/dev/null | node -e '
  let body = "";
  process.stdin.on("data", chunk => { body += chunk; });
  process.stdin.on("end", () => {
    try { process.stdout.write(JSON.parse(body).releaseSha || ""); } catch {}
  });
' 2>/dev/null || true)"

set -a
# shellcheck disable=SC1091
source .env
set +a
export NODE_ENV=production
export RELEASE_SHA="$requested_release_sha"
export RELEASE_BUILT_AT="$requested_release_built_at"

if [[ ! "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  fail "RELEASE_SHA must be a full Git SHA"
fi

docker image inspect "$POSTGRES_TOOLS_IMAGE" >/dev/null 2>&1 \
  || docker pull "$POSTGRES_TOOLS_IMAGE" >/dev/null

log "Removing legacy client-side Telegram credential files..."
rm -f \
  "$APP_DIR/config/telegram-config.js" \
  "$APP_DIR/frontend/js/telegram-config.js" \
  "$APP_DIR/frontend/js/telegram-config.min.js"

log "Fixing frontend file permissions..."
find "$APP_DIR/frontend" -type f \( -name '*.css' -o -name '*.js' -o -name '*.html' -o -name '*.svg' \) ! -perm -004 -exec chmod a+r {} \; 2>/dev/null || true

log "Installing exact backend dependencies..."
npm ci
npm run release:preflight

mkdir -p "$BACKUP_DIR" "$STATE_DIR"
chmod 700 "$BACKUP_DIR" "$STATE_DIR"
database_url="${DATABASE_URL%%\?*}"
backup_path="$BACKUP_DIR/crm-before-${RELEASE_SHA}-$(date +%Y%m%d-%H%M%S).dump"

log "Creating and validating PostgreSQL backup..."
docker run --rm --network host \
  --user "$(id -u):$(id -g)" \
  -v "$BACKUP_DIR:/backup" \
  "$POSTGRES_TOOLS_IMAGE" pg_dump "$database_url" \
  --format=custom --file="/backup/$(basename "$backup_path")"
docker run --rm --network host \
  --user "$(id -u):$(id -g)" \
  -v "$BACKUP_DIR:/backup" \
  "$POSTGRES_TOOLS_IMAGE" pg_restore \
  --list "/backup/$(basename "$backup_path")" >/dev/null
sha256sum "$backup_path" > "${backup_path}.sha256"
chmod 600 "$backup_path" "${backup_path}.sha256"
find "$BACKUP_DIR" -name 'crm-before-*.dump' -type f -mtime +30 -delete 2>/dev/null || true
find "$BACKUP_DIR" -name 'crm-before-*.dump.sha256' -type f -mtime +30 -delete 2>/dev/null || true

log "Generating Prisma client..."
npx prisma generate --config=prisma.config.ts

migration_table="$(psql "$database_url" -Atqc "SELECT to_regclass('public._prisma_migrations')::text" || true)"
if [ "$migration_table" != "_prisma_migrations" ]; then
  log "Adopting migration history after an exact baseline drift check..."
  drift_report="$STATE_DIR/crm-baseline-drift-${RELEASE_SHA}.txt"
  set +e
  npx prisma migrate diff \
    --config=prisma.config.ts \
    --from-config-datasource \
    --to-schema="$BASELINE_SCHEMA" \
    --exit-code > "$drift_report" 2>&1
  drift_status=$?
  set -e
  if [ "$drift_status" -ne 0 ]; then
    fail "Database does not exactly match the audited baseline. See ${drift_report}; no migration was applied."
  fi
  npx prisma migrate resolve --config=prisma.config.ts --applied "$BASELINE_MIGRATION"
fi

log "Applying versioned Prisma migrations..."
npm run db:migrate:deploy
npx prisma migrate status --config=prisma.config.ts

log "Pruning development dependencies..."
npm prune --omit=dev

log "Restarting PM2..."
if pm2 describe maestro-crm-backend >/dev/null 2>&1; then
  pm2 restart maestro-crm-backend --update-env
else
  pm2 start ecosystem.config.js --update-env
fi
pm2 save

log "Waiting for database-backed readiness..."
health_json=""
for attempt in $(seq 1 15); do
  if health_json="$(curl -fsS http://127.0.0.1:5000/api/health 2>/dev/null)"; then
    break
  fi
  sleep 2
done
if [ -z "$health_json" ]; then
  fail "CRM readiness check failed after restart; backup=${backup_path}"
fi

actual_release="$(printf '%s' "$health_json" | node -e '
  let body = "";
  process.stdin.on("data", chunk => { body += chunk; });
  process.stdin.on("end", () => process.stdout.write(JSON.parse(body).releaseSha || ""));
')"
if [ "$actual_release" != "$RELEASE_SHA" ]; then
  fail "CRM release mismatch: expected=${RELEASE_SHA} actual=${actual_release:-missing}"
fi

curl -fsS -o /dev/null "https://${PUBLIC_DOMAIN}/login.html"

cat > "$STATE_DIR/crm-${RELEASE_SHA}.env" <<EOF
RELEASE_SHA=${RELEASE_SHA}
RELEASE_BUILT_AT=${RELEASE_BUILT_AT}
PREVIOUS_RELEASE_SHA=${previous_release_sha}
BACKUP_PATH=${backup_path}
EOF
chmod 600 "$STATE_DIR/crm-${RELEASE_SHA}.env"

log "Deploy complete: release=${RELEASE_SHA} backup=${backup_path}"
log "CRM: https://${PUBLIC_DOMAIN}/login.html"
