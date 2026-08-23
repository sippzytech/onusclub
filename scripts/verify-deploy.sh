#!/usr/bin/env bash
#
# Post-deploy verification. Read-only — safe to run against production.
#
# This exists because of a real outage: Day 15 shipped a migration, the web
# build went out without it being applied, and the first thing that told
# anyone was a human hitting a broken login screen. Everything below is a
# check that would have caught that from a terminal instead.
#
# Deliberately NOT the smoke test. `pnpm smoke` creates merchants, customers
# and cards — running it against prod would litter the live database with
# fake records. Nothing here writes anything.
#
# Usage:
#   ./scripts/verify-deploy.sh                 # HTTP checks only
#   PROD_EMAIL=… PROD_PASSWORD=… ./scripts/verify-deploy.sh   # + logged-in checks
#
# Run it from /docker/stampdeck on the VPS and it additionally verifies that
# every migration file on disk has been applied to the live database.
#
# Exit code 0 = everything passed, 1 = at least one check failed.

set -uo pipefail

API_BASE="${API_BASE:-https://api.onusclub.com}"
WEB_BASE="${WEB_BASE:-https://app.onusclub.com}"

PASS=0
FAIL=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }
info() { printf '    \033[2m%s\033[0m\n' "$1"; }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# GET a URL and print only the status code. --max-time so a hung box fails
# the check instead of hanging the deploy.
status_of() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1" 2>/dev/null || echo "000"
}

expect_status() {
  local url="$1" want="$2" label="$3"
  local got
  got="$(status_of "$url")"
  if [ "$got" = "$want" ]; then
    ok "$label ($got)"
  else
    bad "$label — expected $want, got $got"
  fi
}

# ---------------------------------------------------------------------------
head_ "API"
# ---------------------------------------------------------------------------

health_body="$(curl -s --max-time 15 "$API_BASE/health" 2>/dev/null)"
if printf '%s' "$health_body" | grep -q '"ok":true'; then
  ok "health endpoint reports ok"
  info "$health_body"
else
  bad "health endpoint did not report ok"
  info "got: ${health_body:-<no response>}"
fi

# 401 not 404 is the point: 401 proves the route is registered and simply
# wants auth. A 404 here means the container is running an older build that
# predates the route — the exact "web deployed, api didn't" split that is
# otherwise invisible.
expect_status "$API_BASE/v1/analytics/overview" "401" "analytics route is deployed (Day 15)"
expect_status "$API_BASE/v1/cards" "401" "cards route requires auth"

# ---------------------------------------------------------------------------
head_ "Web"
# ---------------------------------------------------------------------------

expect_status "$WEB_BASE/login" "200" "login page renders"

dash_status="$(status_of "$WEB_BASE/dashboard")"
case "$dash_status" in
  2*|3*) ok "dashboard responds to anonymous request ($dash_status)" ;;
  5*)    bad "dashboard is throwing a server error ($dash_status)" ;;
  *)     bad "dashboard returned unexpected status ($dash_status)" ;;
esac

# ---------------------------------------------------------------------------
# Logged-in checks. Optional, because they need real credentials — but this
# is the section that actually catches the failure we hit: the dashboard only
# breaks once a session exists, so an anonymous check sails straight past it.
# ---------------------------------------------------------------------------
if [ -n "${PROD_EMAIL:-}" ] && [ -n "${PROD_PASSWORD:-}" ]; then
  head_ "Logged-in checks"

  jar="$(mktemp)"
  trap 'rm -f "$jar"' EXIT

  login_status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
    -c "$jar" -X POST "$WEB_BASE/api/login" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"${PROD_EMAIL}\",\"password\":\"${PROD_PASSWORD}\"}" 2>/dev/null)"

  if [ "$login_status" = "200" ]; then
    ok "login succeeds"

    dash_auth="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -b "$jar" "$WEB_BASE/dashboard")"
    if [ "$dash_auth" = "200" ]; then
      ok "dashboard renders for a logged-in user ($dash_auth)"
    else
      bad "dashboard fails for a logged-in user ($dash_auth)"
      info "this is the failure mode an anonymous check cannot see"
    fi

    # Pull the session JWT out of the cookie jar and hit the API directly, so
    # a failure here points at the api rather than at Next.js.
    jwt="$(awk '/sd_session/ {print $NF}' "$jar" | tail -1)"
    if [ -n "$jwt" ]; then
      ov="$(curl -s --max-time 20 "$API_BASE/v1/analytics/overview" -H "authorization: Bearer $jwt" 2>/dev/null)"
      if printf '%s' "$ov" | grep -q '"currencyCode"'; then
        ok "analytics returns real data"
        info "$(printf '%s' "$ov" | head -c 160)"
      else
        bad "analytics did not return data — migration 008 likely not applied"
        info "got: $(printf '%s' "$ov" | head -c 200)"
      fi
    fi
  else
    bad "login failed ($login_status) — check PROD_EMAIL / PROD_PASSWORD"
  fi
fi

# ---------------------------------------------------------------------------
# Migration check. Only runs on the VPS, where both the compose file and the
# mysql container are present.
# ---------------------------------------------------------------------------
if [ -f docker-compose.prod.yml ] && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'onusclub-mysql'; then
  head_ "Migrations"

  if [ -f .env ]; then
    # shellcheck disable=SC1091
    set -a; . ./.env; set +a
  fi

  # MYSQL_PWD rather than -p on the command line: keeps the password out of
  # the container's process list and silences mysql's insecure-password warning.
  applied="$(docker exec -e MYSQL_PWD="${MYSQL_PASSWORD:-}" onusclub-mysql \
    mysql -u"${MYSQL_USER:-stampdeck}" "${MYSQL_DATABASE:-stampdeck}" \
    -N -B -e 'SELECT name FROM _migrations' 2>/dev/null)"

  if [ -z "$applied" ]; then
    bad "could not read _migrations (check MYSQL_USER / MYSQL_PASSWORD in .env)"
  else
    pending=""
    for f in apps/api/src/db/migrations/*.sql; do
      name="$(basename "$f")"
      if printf '%s\n' "$applied" | grep -qx "$name"; then
        ok "$name applied"
      else
        bad "$name NOT applied"
        pending="$pending $name"
      fi
    done
    if [ -n "$pending" ]; then
      info "run: docker compose -f docker-compose.prod.yml exec api node dist/db/migrate.js"
    fi
  fi
fi

# ---------------------------------------------------------------------------
head_ "Result"
# ---------------------------------------------------------------------------
printf '  %s passed, %s failed\n\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
