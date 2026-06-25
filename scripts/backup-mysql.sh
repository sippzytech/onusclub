#!/bin/bash
# OnUsClub MySQL backup. Run via host cron on the VPS — see DEPLOY.md §9.
#
# - dumps the DB from inside the mysql container (no host MySQL client needed)
# - gzips to /docker/stampdeck/backups/onusclub-YYYY-MM-DD_HHMMSS.sql.gz
# - prunes local backups older than $RETENTION_DAYS days (default 30)
# - optionally uploads the new gzip to a Backblaze B2 bucket for offsite
#   resilience (requires `b2` CLI in PATH and B2_KEY_ID / B2_APP_KEY /
#   B2_BUCKET in .env). If any of those are missing the upload is skipped
#   with a warning — local backup still completes.
# - logs to /docker/stampdeck/backups/backup.log
#
# Exit status: 0 on success, non-zero on local-backup failure (so cron can
# alert you). B2 upload failures are logged but NOT counted as failures —
# rationale: offsite is a belt over the local suspenders; if it has a bad
# day, we don't want to drop the only good copy or wake anyone up.
set -euo pipefail

STACK_DIR="${ONUSCLUB_STACK_DIR:-/docker/stampdeck}"
BACKUP_DIR="${ONUSCLUB_BACKUP_DIR:-${STACK_DIR}/backups}"
RETENTION_DAYS="${ONUSCLUB_BACKUP_RETENTION_DAYS:-30}"
ENV_FILE="${STACK_DIR}/.env"
CONTAINER="${ONUSCLUB_MYSQL_CONTAINER:-onusclub-mysql}"
DB_NAME="${ONUSCLUB_DB:-stampdeck}"  # DB name kept as 'stampdeck' — volume preservation
LOG_FILE="${BACKUP_DIR}/backup.log"

mkdir -p "${BACKUP_DIR}"

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "${LOG_FILE}"
}

if [ ! -f "${ENV_FILE}" ]; then
  log "FATAL: ${ENV_FILE} not found"
  exit 1
fi

env_value() {
  # Pull a single var from .env without sourcing the whole file. Strips
  # surrounding double quotes if present.
  grep -E "^${1}=" "${ENV_FILE}" | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//'
}

ROOT_PW="$(env_value MYSQL_ROOT_PASSWORD)"
if [ -z "${ROOT_PW}" ]; then
  log "FATAL: MYSQL_ROOT_PASSWORD not set in ${ENV_FILE}"
  exit 1
fi

STAMP="$(date -u +%Y-%m-%d_%H%M%S)"
OUTFILE="${BACKUP_DIR}/onusclub-${STAMP}.sql.gz"

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
log "OK local ${OUTFILE} (${SIZE})"

# --- Offsite upload to Backblaze B2 (best-effort) ---
B2_KEY_ID="$(env_value B2_KEY_ID)"
B2_APP_KEY="$(env_value B2_APP_KEY)"
B2_BUCKET="$(env_value B2_BUCKET)"

if [ -z "${B2_KEY_ID}" ] || [ -z "${B2_APP_KEY}" ] || [ -z "${B2_BUCKET}" ]; then
  log "WARN B2_* env vars not set — skipping offsite upload"
elif ! command -v b2 >/dev/null 2>&1; then
  log "WARN b2 CLI not installed — skipping offsite upload (install: curl -sL https://github.com/Backblaze/B2_Command_Line_Tool/releases/latest/download/b2-linux -o /usr/local/bin/b2 && chmod +x /usr/local/bin/b2)"
else
  # b2 CLI reads creds from these env vars.
  export B2_APPLICATION_KEY_ID="${B2_KEY_ID}"
  export B2_APPLICATION_KEY="${B2_APP_KEY}"
  REMOTE_NAME="onusclub-$(basename "${OUTFILE}")"
  if b2 file upload --quiet "${B2_BUCKET}" "${OUTFILE}" "${REMOTE_NAME}" >>"${LOG_FILE}" 2>&1; then
    log "OK offsite b2://${B2_BUCKET}/${REMOTE_NAME}"
  else
    # Upload failed. Log but don't exit non-zero — local backup is the
    # primary; offsite outage shouldn't page someone.
    log "WARN offsite upload failed (see preceding b2 output in ${LOG_FILE})"
  fi
fi

# --- Prune old local backups ---
# find -mtime is days; +N means strictly older than N+1, which is the
# behaviour we want. Match both legacy (stampdeck-) and current (onusclub-)
# naming so old files from before the rename still get pruned.
PRUNED="$(find "${BACKUP_DIR}" \( -name 'onusclub-*.sql.gz' -o -name 'stampdeck-*.sql.gz' \) -type f -mtime +"${RETENTION_DAYS}" -print -delete | wc -l | tr -d ' ')"
if [ "${PRUNED}" -gt 0 ]; then
  log "pruned ${PRUNED} backup(s) older than ${RETENTION_DAYS} days"
fi

exit 0
