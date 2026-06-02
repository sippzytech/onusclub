#!/bin/bash
# Stampdeck MySQL backup. Run via host cron on the VPS — see DEPLOY.md.
#
# - dumps the stampdeck DB from inside the container (no host MySQL client needed)
# - gzips to /docker/stampdeck/backups/stampdeck-YYYY-MM-DD_HHMMSS.sql.gz
# - prunes backups older than $RETENTION_DAYS days (default 30)
# - logs to /docker/stampdeck/backups/backup.log
#
# Exit status: 0 on success, non-zero on any failure (so cron can email you).
set -euo pipefail

STACK_DIR="${STAMPDECK_STACK_DIR:-/docker/stampdeck}"
BACKUP_DIR="${STAMPDECK_BACKUP_DIR:-${STACK_DIR}/backups}"
RETENTION_DAYS="${STAMPDECK_BACKUP_RETENTION_DAYS:-30}"
ENV_FILE="${STACK_DIR}/.env"
CONTAINER="${STAMPDECK_MYSQL_CONTAINER:-stampdeck-mysql}"
DB_NAME="${STAMPDECK_DB:-stampdeck}"
LOG_FILE="${BACKUP_DIR}/backup.log"

mkdir -p "${BACKUP_DIR}"

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "${LOG_FILE}"
}

if [ ! -f "${ENV_FILE}" ]; then
  log "FATAL: ${ENV_FILE} not found"
  exit 1
fi

# Pull MYSQL_ROOT_PASSWORD without sourcing the whole .env (avoids any shell
# interpretation of values with special chars).
ROOT_PW="$(grep -E '^MYSQL_ROOT_PASSWORD=' "${ENV_FILE}" | cut -d= -f2-)"
if [ -z "${ROOT_PW}" ]; then
  log "FATAL: MYSQL_ROOT_PASSWORD not set in ${ENV_FILE}"
  exit 1
fi

STAMP="$(date -u +%Y-%m-%d_%H%M%S)"
OUTFILE="${BACKUP_DIR}/stampdeck-${STAMP}.sql.gz"

log "starting backup → ${OUTFILE}"

# Stream the dump out of the container, gzip on the host. --single-transaction
# gives a consistent snapshot without locking writes. --routines + --triggers
# capture the full schema. --quick streams row-by-row instead of buffering the
# whole table in memory.
if ! docker exec -i "${CONTAINER}" \
    mysqldump \
      --single-transaction \
      --quick \
      --routines \
      --triggers \
      --default-character-set=utf8mb4 \
      -uroot -p"${ROOT_PW}" \
      "${DB_NAME}" 2> >(tee -a "${LOG_FILE}" >&2) \
    | gzip -9 > "${OUTFILE}"; then
  log "FATAL: dump pipeline failed"
  rm -f "${OUTFILE}"
  exit 1
fi

SIZE="$(du -h "${OUTFILE}" | awk '{print $1}')"
log "OK ${OUTFILE} (${SIZE})"

# Prune. find -mtime is days; +N means strictly older than N+1, which is the
# behaviour we want.
PRUNED="$(find "${BACKUP_DIR}" -name 'stampdeck-*.sql.gz' -type f -mtime +"${RETENTION_DAYS}" -print -delete | wc -l | tr -d ' ')"
if [ "${PRUNED}" -gt 0 ]; then
  log "pruned ${PRUNED} backup(s) older than ${RETENTION_DAYS} days"
fi

exit 0
