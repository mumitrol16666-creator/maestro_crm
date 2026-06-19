#!/usr/bin/env bash
#
# One-time CRM operational-data reset.
# Preserves all user accounts and website bookings.
# Removes test money, memberships, groups, schedules, classes and attendance.
#
# Run on the CRM server:
#   cd /var/www/maestro_crm/backend
#   bash scripts/reset-production-operational-data.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${BACKEND_DIR}/.env"
EXPECTED_DATABASE="${EXPECTED_DATABASE:-maestro_crm}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Ошибка: не найден ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Ошибка: DATABASE_URL не задан в ${ENV_FILE}" >&2
  exit 1
fi

# PostgreSQL CLI does not understand Prisma's ?schema= query parameter.
DB_URL="${DATABASE_URL%%\?*}"
ACTUAL_DATABASE="$(psql "$DB_URL" -Atc 'SELECT current_database();')"

if [ "$ACTUAL_DATABASE" != "$EXPECTED_DATABASE" ]; then
  echo "ОТМЕНА: подключена база '${ACTUAL_DATABASE}', ожидалась '${EXPECTED_DATABASE}'." >&2
  echo "Если имя намеренно отличается, задайте EXPECTED_DATABASE явно." >&2
  exit 1
fi

echo "Подключение подтверждено: ${ACTUAL_DATABASE}"
psql "$DB_URL" -P pager=off -c "
SELECT
  (SELECT count(*) FROM \"Student\") AS users,
  (SELECT count(*) FROM \"Student\" WHERE role='student' AND status='active') AS active_students,
  (SELECT count(*) FROM \"Group\") AS groups,
  (SELECT count(*) FROM \"Membership\") AS memberships,
  (SELECT count(*) FROM \"Payment\") AS payments,
  (SELECT count(*) FROM \"Class\") AS classes,
  (SELECT count(*) FROM \"Booking\") AS preserved_bookings;
"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/maestro-crm}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
BACKUP_FILE="${BACKUP_DIR}/maestro_crm_before_operational_reset_$(date +%Y%m%d_%H%M%S).dump"

echo "Создаю полный дамп: ${BACKUP_FILE}"
pg_dump "$DB_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"

if [ ! -s "$BACKUP_FILE" ]; then
  echo "ОТМЕНА: резервная копия пуста." >&2
  exit 1
fi

echo
echo "Будут сохранены аккаунты учеников/сотрудников и заявки."
echo "Будут удалены группы, абонементы, платежи, касса, зарплаты,"
echo "расписание, занятия, посещаемость и заморозки."
read -r -p "Для продолжения введите: RESET MAESTRO DATA > " confirmation

if [ "$confirmation" != "RESET MAESTRO DATA" ]; then
  echo "Операция отменена. Дамп сохранён: ${BACKUP_FILE}"
  exit 1
fi

psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

UPDATE "Student"
SET "activeMembershipId" = NULL,
    "assignedTeacherId" = NULL,
    "accountBalance" = 0,
    "accountBalanceInitializedAt" = NULL,
    "penaltyPoints" = 0
WHERE role = 'student';

UPDATE "Booking" SET "groupId" = NULL WHERE "groupId" IS NOT NULL;

DELETE FROM "CashTransaction";
DELETE FROM "Payment";
DELETE FROM "Salary";
DELETE FROM "MembershipTransaction";
DELETE FROM "Freeze";
DELETE FROM "Membership";
DELETE FROM "Class";
DELETE FROM "StudentSchedule";
DELETE FROM "GroupSchedule";
DELETE FROM "StudentGroup";
DELETE FROM "Group";

COMMIT;
SQL

echo
echo "Очистка завершена. Контрольное состояние:"
psql "$DB_URL" -P pager=off -c "
SELECT
  (SELECT count(*) FROM \"Student\") AS users,
  (SELECT count(*) FROM \"Student\" WHERE role='student' AND status='active') AS active_students,
  (SELECT count(*) FROM \"Group\") AS groups,
  (SELECT count(*) FROM \"Membership\") AS memberships,
  (SELECT count(*) FROM \"Payment\") AS payments,
  (SELECT count(*) FROM \"Class\") AS classes,
  (SELECT count(*) FROM \"StudentSchedule\") AS student_schedules,
  (SELECT count(*) FROM \"GroupSchedule\") AS group_schedules,
  (SELECT count(*) FROM \"Student\" WHERE \"accountBalance\" <> 0) AS nonzero_balances,
  (SELECT count(*) FROM \"Booking\") AS preserved_bookings;
"

echo "Резервная копия: ${BACKUP_FILE}"
