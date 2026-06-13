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
  git fetch "https://github.com/mumitrol16666-creator/maestro_crm.git" main
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

  cd "$LP_DIR"
  git fetch "https://github.com/mumitrol16666-creator/maestro_school.git" main
  git reset --hard FETCH_HEAD

  log "LP backend..."
  cd backend
  npm ci
  npm run db:generate
  npm run db:migrate
  npm run build

  log "LP frontend..."
  cd ../web_app
  npm ci
  npm run build

  log "LP PM2 restart..."
  cd "$LP_DIR"
  pm2 startOrReload deploy/ecosystem.config.cjs --update-env
  pm2 save

  curl -fsS http://127.0.0.1:4000/health
  curl -fsS -o /dev/null "http://127.0.0.1:3000/"
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
