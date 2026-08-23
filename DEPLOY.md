# OnUsClub — Deploy Runbook

First-time deploy from a clean VPS to `api.sippzy.com` + `app.sippzy.com`. After that, day-to-day deploys are 3 commands at the bottom.

The VPS is already running Traefik (network `n8n_default`, cert resolver `mytlschallenge`), n8n, and Metabase. OnUsClub slots in alongside them.

---

## 0. Pre-flight checks on the VPS

SSH into the VPS as root, then:

```bash
# Docker present
docker --version && docker compose version

# Traefik running, network exists
docker ps | grep traefik
docker network ls | grep n8n_default

# DNS resolves to this VPS
dig +short api.sippzy.com
dig +short app.sippzy.com
# Both should return this VPS's public IP

# Service account JSON in place (used in Day 4 — should still be there)
ls -la /docker/stampdeck/secrets/wallet-sa.json
# Expected: -rw------- ... 2359 ... wallet-sa.json

# Plenty of resources
free -h
df -h /
```

If anything is missing, fix it before continuing.

---

## 1. Generate the prod secrets (on the VPS)

These never leave the VPS. Generate strong random values:

```bash
echo "MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)"
echo "MYSQL_PASSWORD=$(openssl rand -hex 24)"
echo "REPORTING_PASSWORD=$(openssl rand -hex 16)"
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "NEXTAUTH_SECRET=$(openssl rand -hex 32)"
```

Save the output **into a notes file or password manager** — you'll need `REPORTING_PASSWORD` later when you wire up Metabase and n8n. Don't paste these into chat.

---

## 2. Clone the repo + create the prod env file

```bash
mkdir -p /docker/stampdeck
cd /docker/stampdeck

git clone git@github.com:sippzytech/stampdeck.git . \
  || git clone https://github.com/sippzytech/stampdeck.git .

# Use the latest deployed branch (until we merge to main).
git checkout day-7-deploy-and-email-domain

cp .env.example .env
nano .env   # fill in every blank with the values you generated in step 1
            # plus your Resend API key (from your Resend dashboard)
```

The file should end up looking like:

```
NODE_ENV=production
DOMAIN_API=api.sippzy.com
DOMAIN_WEB=app.sippzy.com

MYSQL_ROOT_PASSWORD=<from openssl rand>
MYSQL_DATABASE=stampdeck
MYSQL_USER=stampdeck
MYSQL_PASSWORD=<from openssl rand>
REPORTING_PASSWORD=<from openssl rand>

JWT_SECRET=<from openssl rand>
NEXTAUTH_SECRET=<from openssl rand>

GOOGLE_WALLET_ISSUER_ID=3388000000023150410

RESEND_API_KEY=<paste your real Resend key here>
EMAIL_FROM=OnUsClub <onboarding@resend.dev>
```

Then lock it down so nobody else on the box can read it:

```bash
chmod 600 .env
```

---

## 3. Pre-flight: Metabase needs to be on `n8n_default` so it can reach OnUsClub's MySQL

One-time, takes a second:

```bash
docker network connect n8n_default metabase
```

Verify:

```bash
docker inspect metabase --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}'
# Should now list:  bridge n8n_default
```

This doesn't touch Metabase's existing functionality — it just adds a second network so it can reach OnUsClub's MySQL by container name later.

---

## 4. Bring the stack up

```bash
cd /docker/stampdeck
docker compose -f docker-compose.prod.yml up -d --build
```

This will:
1. Build the api image (Node + ts → js via the existing Dockerfile).
2. Build the web image (Next.js standalone).
3. Pull MySQL 8.
4. Start all three containers.
5. Init script creates the read-only `reporting` user in MySQL on first boot.
6. Traefik picks up the labels and starts routing.

First build can take 3-5 minutes. Subsequent rebuilds are fast.

Check it's healthy:

```bash
docker compose -f docker-compose.prod.yml ps
# Expect 3 containers, all "Up", mysql "(healthy)"

docker logs stampdeck-api 2>&1 | tail -20
# Expect: "MySQL connection OK", "api listening", "wallet client initialized",
#         "messaging crons registered"
```

---

## 5. Run the migrations

The api expects the schema to exist. Run the migration runner inside the container:

```bash
docker compose -f docker-compose.prod.yml exec api node dist/db/migrate.js
# Expect: applying migration 001_initial.sql, applying 002_messaging.sql, done
```

---

## 6. Real-world smoke test

From your laptop (not the VPS):

```bash
# Healthcheck via real HTTPS
curl https://api.sippzy.com/health
# Expect: {"ok":true,"service":"api","version":"0.0.1"}

# Web home page
curl -sI https://app.sippzy.com/ | head -1
# Expect: HTTP/2 200
```

If both return as expected, **OnUsClub is live**.

Open <https://app.sippzy.com/signup> in your browser and walk through the full flow:

1. Sign up as a fresh merchant
2. Click the dev magic link (api logs it — `docker logs stampdeck-api | grep "magic link"`)
3. Create a stamp program
4. Add a customer with `sippzy.official@gmail.com` (the only address Resend currently delivers to)
5. Enrol a card → **real email should land in `sippzy.official@gmail.com`** within seconds
6. Click "Add to Google Wallet" from the email on your phone → pass lands
7. Add stamps from the dashboard → phone notifies

---

## 7. Resend domain verification for `sippzy.com`

Once the deploy works on `onboarding@resend.dev`, switch to your own domain so emails deliver to anyone.

### a) Add the domain in Resend

1. Open <https://resend.com/domains>
2. Click **Add Domain** → enter `sippzy.com`
3. Resend shows you 3 DNS records (one SPF TXT, one DKIM TXT, one return-path TXT). Keep this tab open.

### b) Add the DNS records

Wherever you manage DNS for `sippzy.com`:

- Add the **SPF** TXT record: usually `@` → `v=spf1 include:_spf.resend.com ~all`
  (If you already have an SPF record with other providers, merge them — only one SPF TXT per domain allowed.)
- Add the **DKIM** TXT record: `resend._domainkey` → long string from Resend
- Add the **return-path** TXT record exactly as Resend shows

Save. Propagation is usually 5-30 minutes.

### c) Verify in Resend

Click **Verify** on each row. They flip to ✓ Verified as DNS propagates.

### d) Switch the sender on the VPS

```bash
cd /docker/stampdeck
nano .env
# Change EMAIL_FROM to: OnUsClub <noreply@sippzy.com>
# Save.

docker compose -f docker-compose.prod.yml up -d  # picks up the new env var
```

Test by enrolling a card with any email — should now deliver to any address, not just the Resend account owner.

---

## 8. Wire Metabase to OnUsClub's MySQL (optional)

When you want dashboards on OnUsClub data:

1. Open Metabase (your existing instance).
2. **Admin → Databases → Add database**.
3. Database type: **MySQL**.
4. Settings:
   - Host: `stampdeck-mysql` (Docker DNS — Metabase is on `n8n_default` now)
   - Port: `3306`
   - Database: `stampdeck`
   - Username: `reporting`
   - Password: the `REPORTING_PASSWORD` you saved in step 1
   - SSL: off
5. Save → Metabase scans the schema → ready for charts.

Same pattern for n8n (its MySQL credentials node) when you want to wire automations.

---

## Day-to-day deploys (after first deploy)

Three commands. ~30 seconds.

```bash
cd /docker/stampdeck
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

If a migration was added on the new commit:

```bash
docker compose -f docker-compose.prod.yml exec api node dist/db/migrate.js
```

Then **verify the deploy** — always, not just when a migration was involved:

```bash
./scripts/verify-deploy.sh
```

Exit code 0 means everything passed. It is read-only and safe against prod.

Run from `/docker/stampdeck` on the VPS it also checks that every migration
file on disk has actually been applied to the live database — the check that
would have caught the Day 15 outage, where the web build shipped without its
migration and the first symptom was a broken login screen.

To include the logged-in checks (strongly recommended — the dashboard can be
fine anonymously and still broken once a session exists):

```bash
PROD_EMAIL='you@example.com' PROD_PASSWORD='…' ./scripts/verify-deploy.sh
```

Do **not** run `pnpm smoke` against production. It creates merchants,
customers and cards, and would litter the live database with fake records.
`verify-deploy.sh` is the prod-safe counterpart.

That's it.

---

## Rolling back

If a deploy breaks something:

```bash
cd /docker/stampdeck
git log --oneline -5                  # find the last good commit
git checkout <good-commit-sha>
docker compose -f docker-compose.prod.yml up -d --build
```

Database migrations are **not** auto-rolled-back. If a migration corrupted data, restore from a MySQL dump (set up regular `mysqldump` in cron — separate task).

---

## Container ops cheat sheet

```bash
# Status
docker compose -f docker-compose.prod.yml ps

# Logs (live) — containers were renamed in the Day 13 rename
docker logs -f onusclub-api
docker logs -f onusclub-web
docker logs -f onusclub-mysql

# Restart a single service
docker compose -f docker-compose.prod.yml restart api

# Quick MySQL shell
docker exec -it stampdeck-mysql mysql -u root -p"$MYSQL_ROOT_PASSWORD" stampdeck

# SSH-tunnel from your laptop to the prod DB (for debug only)
ssh -L 33061:127.0.0.1:33061 root@<vps-ip>
# Then from another local terminal:
mysql -h 127.0.0.1 -P 33061 -u reporting -p stampdeck
```

---

## Future security improvements (track separately)

- Bind host MySQL to `127.0.0.1` (currently exposed on `0.0.0.0:3306` — flagged Day 6)
- Move Metabase behind Traefik on `metabase.sippzy.com` (currently exposed on `0.0.0.0:3000`)
- Submit Google Wallet issuer for production approval (currently demo-only — passes save only for allowlisted Google accounts)
- Schedule `mysqldump` cron for backups

---

## 9. MySQL backups (daily, retained 30 days)

The repo ships `scripts/backup-mysql.sh` — a small script that streams `mysqldump` out of the `onusclub-mysql` container, gzips it, prunes old backups, and (if configured) uploads to Backblaze B2 for offsite resilience. Wire it to host cron on the VPS once:

```bash
# On the VPS, as root:
mkdir -p /docker/stampdeck/backups
chmod 700 /docker/stampdeck/backups

# Quick sanity check the script runs end-to-end now
/docker/stampdeck/scripts/backup-mysql.sh
ls -lh /docker/stampdeck/backups/  # should show one new .sql.gz

# Install the daily cron (02:30 UTC)
( crontab -l 2>/dev/null | grep -v 'backup-mysql.sh'; \
  echo "30 2 * * * /docker/stampdeck/scripts/backup-mysql.sh >> /docker/stampdeck/backups/cron.log 2>&1" \
) | crontab -

# Verify the schedule
crontab -l | grep backup-mysql.sh
```

That schedules a daily backup at 02:30 UTC (~03:30 / 04:30 Amsterdam depending on DST), well before the 03:00 Amsterdam expiry sweep so backups happen on a quiet DB.

### Tune retention

`ONUSCLUB_BACKUP_RETENTION_DAYS=60 /docker/stampdeck/scripts/backup-mysql.sh` — overrides the 30-day default.

### Restore from a backup

```bash
# Pick a backup
ls -lh /docker/stampdeck/backups/
BACKUP=/docker/stampdeck/backups/onusclub-2026-06-25_023000.sql.gz

# Load it into the running container (this OVERWRITES current data — be sure)
gunzip -c "$BACKUP" | docker exec -i onusclub-mysql mysql \
  -uroot -p"$(grep '^MYSQL_ROOT_PASSWORD' /docker/stampdeck/.env | cut -d= -f2-)" \
  stampdeck
```

### Offsite upload to Backblaze B2

Local backups survive a disk full but not a disk failure / VPS loss. Backblaze B2 gives 10 GB free + S3-compatible storage; pennies per GB after.

**One-time setup** (Day 13 polish):

1. Create a B2 account at <https://www.backblaze.com/cloud-storage/b2-cloud-storage>
2. Create a bucket: `onusclub-backups` (Private, SSE-B2 encryption)
3. Create an Application Key scoped to that bucket (Read+Write). Copy the `keyID` + `applicationKey` (shown ONCE).
4. On the VPS, install the `b2` CLI:
   ```bash
   curl -sL https://github.com/Backblaze/B2_Command_Line_Tool/releases/latest/download/b2-linux \
     -o /usr/local/bin/b2 && chmod +x /usr/local/bin/b2
   b2 version  # sanity check
   ```
5. Append three lines to `/docker/stampdeck/.env`:
   ```
   B2_KEY_ID=<keyID from step 3>
   B2_APP_KEY=<applicationKey from step 3>
   B2_BUCKET=onusclub-backups
   ```
6. Run a manual backup to verify the upload works:
   ```bash
   /docker/stampdeck/scripts/backup-mysql.sh
   tail -n 5 /docker/stampdeck/backups/backup.log
   # should show: OK offsite b2://onusclub-backups/onusclub-...sql.gz
   ```

The daily cron picks up the new behaviour automatically — no further action.

**If B2 isn't configured**: the script just logs a warning and skips the upload. Local backups still complete. This keeps offsite truly optional and prevents a B2 outage from breaking your local backup safety net.
