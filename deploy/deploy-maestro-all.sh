#!/usr/bin/env bash
# Maestro Ecosystem — unified deploy on VPS
# Usage: deploy-maestro-all.sh [all|crm|learning-platform]
set -euo pipefail

TARGET="${1:-all}"
CRM_DIR="/var/www/maestro_crm"
LP_DIR="/var/www/maestro_school"
CRM_DOMAIN="${CRM_DOMAIN:-app-maestro-school.duckdns.org}"
LP_DOMAIN="${LP_DOMAIN:-maestro-school.duckdns.org}"

log() {
  echo "[maestro-deploy] $*" >&2
}

sync_lp_from_github() {
  local tmpdir archive extracted
  tmpdir="$(mktemp -d)"
  archive="${tmpdir}/main.tar.gz"
  extracted="${tmpdir}/maestro_school-main"

  log "Downloading Learning Platform from GitHub..."
  curl -fsSL -o "$archive" \
    "https://codeload.github.com/mumitrol16666-creator/maestro_school/tar.gz/refs/heads/main"
  tar -xzf "$archive" -C "$tmpdir"

  if [ ! -d "$extracted" ]; then
    echo "LP archive missing maestro_school-main directory" >&2
    rm -rf "$tmpdir"
    exit 1
  fi

  log "Syncing LP source (preserving .env and build artifacts)..."
  rsync -a --delete \
    --exclude 'backend/.env' \
    --exclude 'backend/node_modules' \
    --exclude 'web_app/node_modules' \
    --exclude 'web_app/.next' \
    --exclude '.git' \
    "${extracted}/" "${LP_DIR}/"

  rm -rf "$tmpdir"
}

deploy_crm() {
  log "=== CRM (${CRM_DOMAIN}) ==="

  if [ ! -d "$CRM_DIR/backend" ]; then
    echo "CRM not found at ${CRM_DIR}" >&2
    exit 1
  fi
  if [ ! -f "$CRM_DIR/backend/.env" ]; then
    echo "CRM backend/.env missing" >&2
    exit 1
  fi

  cd "$CRM_DIR"
  GIT_TERMINAL_PROMPT=0 git -c credential.helper= fetch "https://github.com/mumitrol16666-creator/maestro_crm.git" main
  git reset --hard FETCH_HEAD
  bash deploy/deploy.sh
}

deploy_learning_platform() {
  log "=== Learning Platform (${LP_DOMAIN}) ==="

  if [ ! -d "$LP_DIR/backend" ]; then
    echo "Learning Platform not found at ${LP_DIR}" >&2
    exit 1
  fi
  if [ ! -f "$LP_DIR/backend/.env" ]; then
    echo "Learning Platform backend/.env missing" >&2
    exit 1
  fi

  sync_lp_from_github

  log "LP backend..."
  cd "$LP_DIR/backend"
  rm -rf node_modules
  npm ci
  npm run db:generate
  npm run db:migrate
  npm run build

  log "LP frontend..."
  cd "$LP_DIR/web_app"
  rm -rf .next node_modules
  npm ci
  npm run build

  log "LP PM2 restart..."
  cd "$LP_DIR"
  pm2 startOrReload deploy/ecosystem.config.cjs --update-env
  pm2 save

  for i in {1..10}; do
    if curl -fsS http://127.0.0.1:4000/health; then
      echo "LP API health-check passed"
      break
    fi
    echo "Waiting for LP API... attempt $i/10"
    sleep 3
    if [ "$i" -eq 10 ]; then
      echo "LP API health-check failed"
      pm2 logs maestro-api --lines 50
      exit 1
    fi
  done

  for i in {1..10}; do
    if curl -fsS -o /dev/null http://127.0.0.1:3000/; then
      echo "LP web health-check passed"
      break
    fi
    echo "Waiting for LP web... attempt $i/10"
    sleep 3
    if [ "$i" -eq 10 ]; then
      echo "LP web health-check failed"
      pm2 logs maestro-web --lines 50
      exit 1
    fi
  done

  curl -fsS -o /dev/null "https://${LP_DOMAIN}/"
  log "Learning Platform OK: https://${LP_DOMAIN}/"
}

case "$TARGET" in
  crm)
    deploy_crm
    ;;
  learning-platform|lp|school)
    deploy_learning_platform
    ;;
  all)
    deploy_crm
    deploy_learning_platform
    ;;
  *)
    echo "Unknown target: ${TARGET}. Use: all | crm | learning-platform" >&2
    exit 1
    ;;
esac

log "Done (${TARGET})."
