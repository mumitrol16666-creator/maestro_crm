#!/usr/bin/env bash
# Encrypted daily backups for both Maestro PostgreSQL databases.
set -euo pipefail

CRM_ENV_FILE="${CRM_ENV_FILE:-/var/www/maestro_crm/backend/.env}"
LEARNING_ENV_FILE="${LEARNING_ENV_FILE:-/var/www/maestro_school/backend/.env}"
BACKUP_CONFIG_FILE="${BACKUP_CONFIG_FILE:-/etc/maestro/backup-notify.env}"
AGE_RECIPIENT_FILE="${AGE_RECIPIENT_FILE:-/etc/maestro/backup-age-recipient}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/maestro/daily}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TELEGRAM_MAX_DOCUMENT_BYTES="${TELEGRAM_MAX_DOCUMENT_BYTES:-45000000}"
TELEGRAM_API_BASE="${TELEGRAM_API_BASE:-https://api.telegram.org}"
POSTGRES_TOOLS_IMAGE="${POSTGRES_TOOLS_IMAGE:-postgres:16-alpine}"

log() {
  echo "[maestro-backup] $*" >&2
}

fail() {
  log "ERROR: $*"
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command is missing: $1"
}

postgres_tool() {
  docker run --rm --network host \
    --user "$(id -u):$(id -g)" \
    -v "$BACKUP_ROOT:/backup" \
    "$POSTGRES_TOOLS_IMAGE" "$@"
}

read_database_url() (
  local env_file="$1"
  [ -f "$env_file" ] || exit 1
  set -a
  # shellcheck source=/dev/null
  source "$env_file"
  set +a
  [ -n "${DATABASE_URL:-}" ] || exit 1
  printf '%s' "${DATABASE_URL%%\?*}"
)

telegram_send_document() {
  local path="$1" caption="$2" response
  response="$(curl -fsS -X POST \
    "${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendDocument" \
    -F "chat_id=${TELEGRAM_CHAT_ID}" \
    -F "caption=${caption}" \
    -F "document=@${path}")"
  printf '%s' "$response" | node -e '
    let body = "";
    process.stdin.on("data", chunk => { body += chunk; });
    process.stdin.on("end", () => {
      const payload = JSON.parse(body);
      if (payload.ok !== true) process.exit(1);
    });
  '
}

backup_database() {
  local label="$1" env_file="$2" timestamp="$3"
  local database_url dump_path encrypted_path checksum_path size

  database_url="$(read_database_url "$env_file")" \
    || fail "DATABASE_URL is unavailable in ${env_file}"
  dump_path="${BACKUP_ROOT}/${label}-${timestamp}.dump"
  encrypted_path="${dump_path}.age"
  checksum_path="${encrypted_path}.sha256"

  log "Creating ${label} backup..."
  postgres_tool pg_dump "$database_url" \
    --format=custom --file="/backup/$(basename "$dump_path")"
  postgres_tool pg_restore --list "/backup/$(basename "$dump_path")" >/dev/null
  age -r "$AGE_RECIPIENT" -o "$encrypted_path" "$dump_path"
  rm -f "$dump_path"
  sha256sum "$encrypted_path" > "$checksum_path"
  chmod 600 "$encrypted_path" "$checksum_path"

  size="$(stat -c %s "$encrypted_path")"
  if [ "$size" -gt "$TELEGRAM_MAX_DOCUMENT_BYTES" ]; then
    fail "${label} backup is ${size} bytes and exceeds TELEGRAM_MAX_DOCUMENT_BYTES=${TELEGRAM_MAX_DOCUMENT_BYTES}; encrypted file kept at ${encrypted_path}"
  fi

  telegram_send_document "$encrypted_path" \
    "Maestro ${label} backup · ${timestamp} · encrypted · ${size} bytes"
  telegram_send_document "$checksum_path" \
    "Maestro ${label} SHA-256 · ${timestamp}"
  log "${label} backup verified and delivered: ${encrypted_path}"
}

for command_name in age curl docker node sha256sum stat; do
  require_command "$command_name"
done
[ -f "$BACKUP_CONFIG_FILE" ] || fail "Backup notification config is missing: ${BACKUP_CONFIG_FILE}"
[ -f "$AGE_RECIPIENT_FILE" ] || fail "age recipient is missing: ${AGE_RECIPIENT_FILE}"

set -a
# shellcheck source=/dev/null
source "$BACKUP_CONFIG_FILE"
set +a
[ -n "${TELEGRAM_BOT_TOKEN:-}" ] || fail "TELEGRAM_BOT_TOKEN is missing"
[ -n "${TELEGRAM_CHAT_ID:-}" ] || fail "TELEGRAM_CHAT_ID is missing"

AGE_RECIPIENT="$(tr -d '[:space:]' < "$AGE_RECIPIENT_FILE")"
[[ "$AGE_RECIPIENT" =~ ^age1[0-9a-z]+$ ]] || fail "Invalid age recipient"

install -d -m 0700 "$BACKUP_ROOT"
docker image inspect "$POSTGRES_TOOLS_IMAGE" >/dev/null 2>&1 \
  || docker pull "$POSTGRES_TOOLS_IMAGE" >/dev/null
cleanup_raw_dumps() {
  find "$BACKUP_ROOT" -maxdepth 1 -type f -name '*.dump' -delete
}
trap cleanup_raw_dumps EXIT
timestamp="$(date +%Y%m%d-%H%M%S)"
backup_database "crm" "$CRM_ENV_FILE" "$timestamp"
backup_database "learning" "$LEARNING_ENV_FILE" "$timestamp"

find "$BACKUP_ROOT" -type f \( -name '*.dump.age' -o -name '*.dump.age.sha256' \) \
  -mtime "+${RETENTION_DAYS}" -delete
log "Daily backup completed."
