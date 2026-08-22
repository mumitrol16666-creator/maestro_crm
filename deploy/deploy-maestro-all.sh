#!/usr/bin/env bash
# Maestro Ecosystem — unified deploy on VPS
# Usage: deploy-maestro-all.sh [all|crm|learning-platform]
set -euo pipefail

TARGET="${1:-all}"
CRM_DIR="/var/www/maestro_crm"
LP_DIR="/var/www/maestro_school"
CRM_DOMAIN="${CRM_DOMAIN:-app-maestro-school.duckdns.org}"
LP_DOMAIN="${LP_DOMAIN:-maestro-school.duckdns.org}"
LP_REPOSITORY="https://github.com/mumitrol16666-creator/maestro_school.git"
LP_RELEASE_SHA=""
LP_RELEASE_BUILT_AT=""

log() {
  echo "[maestro-deploy] $*" >&2
}

read_api_release() {
  node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => { process.stdout.write(JSON.parse(input).releaseSha || ""); });
  '
}

read_web_release() {
  node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const match = input.match(/<meta[^>]+name=["\x27]maestro-release["\x27][^>]+content=["\x27]([^"\x27]+)["\x27]/i)
        || input.match(/<meta[^>]+content=["\x27]([^"\x27]+)["\x27][^>]+name=["\x27]maestro-release["\x27]/i);
      process.stdout.write(match?.[1] || "");
    });
  '
}

verify_lp_release() {
  local label="$1" api_url="$2" web_url="$3" api_release web_release
  api_release="$(curl -fsS "$api_url" | read_api_release)"
  web_release="$(curl -fsS "$web_url" | read_web_release)"

  if [ "$api_release" != "$LP_RELEASE_SHA" ] || [ "$web_release" != "$LP_RELEASE_SHA" ]; then
    echo "LP ${label} release mismatch: expected=${LP_RELEASE_SHA} api=${api_release:-missing} web=${web_release:-missing}" >&2
    exit 1
  fi
  log "Learning Platform ${label} release verified: ${LP_RELEASE_SHA}"
}

sync_lp_from_github() {
  local tmpdir archive extracted
  tmpdir="$(mktemp -d)"
  archive="${tmpdir}/main.tar.gz"
  extracted="${tmpdir}/source"

  LP_RELEASE_SHA="$(git ls-remote "$LP_REPOSITORY" refs/heads/main | awk 'NR == 1 { print $1 }')"
  if [[ ! "$LP_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Unable to resolve maestro_school/main release SHA" >&2
    rm -rf "$tmpdir"
    exit 1
  fi
  LP_RELEASE_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  log "Release fingerprint: sha=${LP_RELEASE_SHA} builtAt=${LP_RELEASE_BUILT_AT}"

  log "Downloading Learning Platform release ${LP_RELEASE_SHA}..."
  curl -fsSL -o "$archive" \
    "https://codeload.github.com/mumitrol16666-creator/maestro_school/tar.gz/${LP_RELEASE_SHA}"
  mkdir -p "$extracted"
  tar -xzf "$archive" -C "$extracted" --strip-components=1

  if [ ! -f "$extracted/backend/package.json" ] || [ ! -f "$extracted/web_app/package.json" ]; then
    echo "LP archive is missing backend or frontend package metadata" >&2
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
  export RELEASE_SHA="$LP_RELEASE_SHA"
  export RELEASE_BUILT_AT="$LP_RELEASE_BUILT_AT"

  log "LP backend..."
  cd "$LP_DIR/backend"
  rm -rf node_modules
  npm ci
  npm run db:generate
  npm run db:migrate
  npm run build

  log "LP frontend..."
  cd "$LP_DIR/web_app"
  cat > .env.local <<EOF
NEXT_PUBLIC_API_URL=https://${LP_DOMAIN}/api/v1
NEXT_PUBLIC_RELEASE_SHA=${LP_RELEASE_SHA}
NEXT_PUBLIC_RELEASE_BUILT_AT=${LP_RELEASE_BUILT_AT}
EOF
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
    if curl -fsS -o /dev/null http://127.0.0.1:3001/; then
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

  verify_lp_release "local" "http://127.0.0.1:4000/health" "http://127.0.0.1:3001/login"
  verify_lp_release "public" "https://${LP_DOMAIN}/health" "https://${LP_DOMAIN}/login"
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
