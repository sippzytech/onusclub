#!/bin/sh
# Mounted into the MySQL container at /docker-entrypoint-initdb.d/01-reporting-user.sh
# Runs ONCE on first boot (when the data dir is empty). Creates a read-only
# user that n8n and Metabase use to query Stampdeck for dashboards / triggers.
#
# REPORTING_PASSWORD must be set in the compose environment. If unset, this
# script is a no-op (we don't want to create a user with an empty password).
set -e

if [ -z "${REPORTING_PASSWORD}" ]; then
  echo "[init] REPORTING_PASSWORD not set — skipping reporting user creation"
  exit 0
fi

DB="${MYSQL_DATABASE:-stampdeck}"

echo "[init] creating read-only reporting user on database ${DB}"
mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<-EOSQL
  CREATE USER IF NOT EXISTS 'reporting'@'%' IDENTIFIED BY '${REPORTING_PASSWORD}';
  GRANT SELECT ON \`${DB}\`.* TO 'reporting'@'%';
  FLUSH PRIVILEGES;
EOSQL
echo "[init] reporting user ready (SELECT on ${DB}.*)"
