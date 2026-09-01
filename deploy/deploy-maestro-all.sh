#!/usr/bin/env bash
# Maestro Ecosystem — unified deploy on VPS
# Usage: deploy-maestro-all.sh [all|crm|learning-platform]
set -euo pipefail

TARGET="${1:-all}"
CRM_DIR="/var/www/maestro_crm"
LP_DIR="/var/www/maestro_school"
CRM_DOMAIN="${CRM_DOMAIN:-app-maestro-school.duckdns.org}"
LP_DOMAIN="${LP_DOMAIN:-maestro-school.duckdns.org}"
CRM_REPOSITORY="https://github.com/mumitrol16666-creator/maestro_crm.git"
LP_REPOSITORY="https://github.com/mumitrol16666-creator/maestro_school.git"
CRM_RELEASE_SHA=""
CRM_RELEASE_BUILT_AT=""
LP_RELEASE_SHA=""
LP_RELEASE_BUILT_AT=""
BACKUP_ROOT="/var/backups/maestro"
POSTGRES_TOOLS_IMAGE="${POSTGRES_TOOLS_IMAGE:-postgres:16-alpine}"

log() {
  echo "[maestro-deploy] $*" >&2
}

docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

ensure_postgres_tools() {
  docker image inspect "$POSTGRES_TOOLS_IMAGE" >/dev/null 2>&1 \
    || docker pull "$POSTGRES_TOOLS_IMAGE" >/dev/null
}

postgres_tool() {
  local mount_dir="$1"
  shift
  docker run --rm --network host \
    --user "$(id -u):$(id -g)" \
    -v "$mount_dir:/backup" \
    "$POSTGRES_TOOLS_IMAGE" "$@"
}

backup_database() {
  local label="$1" env_file="$2" release_sha="$3" backup_dir backup_path database_url
  backup_dir="${BACKUP_ROOT}/${label}"
  install -d -m 0700 "$backup_dir"

  set -a
  # shellcheck source=/dev/null
  source "$env_file"
  set +a
  database_url="${DATABASE_URL%%\?*}"
  if [ -z "$database_url" ]; then
    echo "DATABASE_URL is missing in ${env_file}" >&2
    exit 1
  fi

  backup_path="${backup_dir}/${label}-before-${release_sha}-$(date +%Y%m%d-%H%M%S).dump"
  postgres_tool "$backup_dir" pg_dump "$database_url" \
    --format=custom --file="/backup/$(basename "$backup_path")"
  postgres_tool "$backup_dir" pg_restore \
    --list "/backup/$(basename "$backup_path")" >/dev/null
  sha256sum "$backup_path" > "${backup_path}.sha256"
  chmod 600 "$backup_path" "${backup_path}.sha256"
  find "$backup_dir" -name "${label}-before-*.dump" -type f -mtime +30 -delete 2>/dev/null || true
  find "$backup_dir" -name "${label}-before-*.dump.sha256" -type f -mtime +30 -delete 2>/dev/null || true
  printf '%s' "$backup_path"
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

  LP_RELEASE_SHA="${LP_RELEASE_SHA_OVERRIDE:-$(git ls-remote "$LP_REPOSITORY" refs/heads/main | awk 'NR == 1 { print $1 }')}"
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

sync_crm_from_github() {
  CRM_RELEASE_SHA="${CRM_RELEASE_SHA_OVERRIDE:-$(git ls-remote "$CRM_REPOSITORY" refs/heads/main | awk 'NR == 1 { print $1 }')}"
  if [[ ! "$CRM_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Unable to resolve maestro_crm release SHA" >&2
    exit 1
  fi
  CRM_RELEASE_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  log "CRM release fingerprint: sha=${CRM_RELEASE_SHA} builtAt=${CRM_RELEASE_BUILT_AT}"

  cd "$CRM_DIR"
  GIT_TERMINAL_PROMPT=0 git -c credential.helper= fetch "$CRM_REPOSITORY" main
  if [ "$(git rev-parse FETCH_HEAD)" != "$CRM_RELEASE_SHA" ]; then
    echo "CRM main moved while resolving the release. Retry the deploy." >&2
    exit 1
  fi
  git reset --hard "$CRM_RELEASE_SHA"
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

  sync_crm_from_github
  export RELEASE_SHA="$CRM_RELEASE_SHA"
  export RELEASE_BUILT_AT="$CRM_RELEASE_BUILT_AT"
  bash deploy/deploy.sh
}

deploy_learning_platform() {
  local previous_release_sha lp_backup state_dir
  log "=== Learning Platform (${LP_DOMAIN}) ==="

  if [ ! -d "$LP_DIR/backend" ]; then
    echo "Learning Platform not found at ${LP_DIR}" >&2
    exit 1
  fi
  if [ ! -f "$LP_DIR/backend/.env" ]; then
    echo "Learning Platform backend/.env missing" >&2
    exit 1
  fi

  previous_release_sha="$(curl -fsS http://127.0.0.1:4000/health 2>/dev/null | read_api_release || true)"
  sync_lp_from_github
  export RELEASE_SHA="$LP_RELEASE_SHA"
  export RELEASE_BUILT_AT="$LP_RELEASE_BUILT_AT"

  log "Starting private file security service..."
  cd "$LP_DIR"
  set -a
  # Compose resolves the private-storage credentials from the backend env.
  # shellcheck source=/dev/null
  source backend/.env
  set +a
  docker_compose -f deploy/docker-compose.security.yml up -d

  ensure_postgres_tools
  lp_backup="$(backup_database "learning" "$LP_DIR/backend/.env" "$LP_RELEASE_SHA")"
  log "Learning Platform backup verified: ${lp_backup}"

  log "LP backend..."
  cd "$LP_DIR/backend"
  set -a
  # shellcheck source=/dev/null
  source .env
  set +a
  export NODE_ENV=production
  export RELEASE_SHA="$LP_RELEASE_SHA"
  export RELEASE_BUILT_AT="$LP_RELEASE_BUILT_AT"
  rm -rf node_modules
  # Production mode must not suppress the build and release toolchain.
  # Runtime-only dependencies are restored by the prune step after verification.
  npm ci --include=dev
  npm run release:preflight
  dependency_ready=0
  for attempt in $(seq 1 60); do
    if npm run release:dependencies; then
      dependency_ready=1
      break
    fi
    log "Waiting for private storage and malware scanner... attempt ${attempt}/60"
    sleep 5
  done
  if [ "$dependency_ready" -ne 1 ]; then
    echo "Learning Platform storage or malware scanner is unavailable" >&2
    docker logs maestro-clamav --tail 100 2>/dev/null || true
    exit 1
  fi
  npm run db:generate
  npm run db:migrate
  npx prisma migrate status
  npm run build
  npm audit --omit=dev --audit-level=critical

  log "LP frontend..."
  cd "$LP_DIR/web_app"
  cat > .env.local <<EOF
NEXT_PUBLIC_API_URL=https://${LP_DOMAIN}/api/v1
NEXT_PUBLIC_RELEASE_SHA=${LP_RELEASE_SHA}
NEXT_PUBLIC_RELEASE_BUILT_AT=${LP_RELEASE_BUILT_AT}
EOF
  rm -rf .next node_modules
  npm ci --include=dev
  npm run build
  npm prune --omit=dev

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
  cd "$LP_DIR/backend"
  npm run smoke:production
  npm prune --omit=dev

  state_dir="$LP_DIR/deploy-state"
  install -d -m 0700 "$state_dir"
  cat > "$state_dir/learning-${LP_RELEASE_SHA}.env" <<EOF
RELEASE_SHA=${LP_RELEASE_SHA}
RELEASE_BUILT_AT=${LP_RELEASE_BUILT_AT}
PREVIOUS_RELEASE_SHA=${previous_release_sha}
BACKUP_PATH=${lp_backup}
EOF
  chmod 600 "$state_dir/learning-${LP_RELEASE_SHA}.env"
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
