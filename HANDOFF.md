# OnUsClub — Handoff Notes

Written 2026-06-26 to make tomorrow's session on the office laptop frictionless. Delete this file once you don't need it.

---

## Where we stand right now

- **Latest branch**: `day-14-points-programs` (HEAD = commit `749d288`)
- **Working tree**: clean
- **Pushed to GitHub**: yes — `github.com/sippzytech/onusclub`
- **CI status**: smoke + typecheck both green on `phase-b-rename`. Day 14 push will rebuild on first PR.
- **Production VPS**: still on the `phase-b-rename` branch (last deployed). Day 14 is NOT live on `api.onusclub.com` yet — code is on a feature branch.

## Days shipped (newest first)

| Day | What | Branch | Live on prod? |
|---|---|---|---|
| 14 | Points programs (+ per-batch expiry, FIFO redemption, points-expiry cron) | `day-14-points-programs` | ❌ Not deployed yet |
| 13 | Phase B rename + DNS cutover to onusclub.com + smoke in CI + B2 backup code | `phase-b-rename` | ✅ Deployed |
| 12 | Apple Wallet live updates via APNs push | `day-11-apple-wallet` | ✅ Deployed |
| 11 | Apple Wallet end-to-end + OnUsClub branding (Phase A) | `day-11-apple-wallet` | ✅ Deployed |

Full history in [ROADMAP.md](./ROADMAP.md).

## What I planned to test tomorrow

**Highest priority — points programs end-to-end:**

1. Log into the dashboard locally at `http://localhost:3001`
2. Create a points-type program (Brunch Points, 10 pts/€, reward at 500)
3. Enrol a customer, open the card
4. Add a transaction (€25) → confirm balance shows `250 / 500`
5. Add another (€30) → balance `550 / 500`, redeem button enables
6. Redeem → balance drops to `50 / 500` (FIFO from oldest batch)
7. Confirm the cards list shows the indigo "Points" pill and the right unit
8. Open the customer-facing `/c/[qrToken]` page → renders points correctly

**If everything works on local**, deploy Day 14 to the VPS (the migration must run there too — see below).

## Setting up on the office laptop

### Prereqs (install if not present)

- Node 20+
- pnpm 9 (`corepack enable && corepack prepare pnpm@9.1.0 --activate`)
- Docker Desktop
- Git (any recent)

### Clone the repo

```bash
git clone https://github.com/sippzytech/onusclub.git
cd onusclub

# Day 14 is on a branch, not merged to main yet:
git checkout day-14-points-programs
```

If GitHub asks for credentials over HTTPS, use a **Personal Access Token** (Settings → Developer settings → Tokens → `repo` scope). Username = your GitHub username.

### Create the api .env file

```bash
cp apps/api/.env.example apps/api/.env
nano apps/api/.env
```

Fill in just enough to get the dev stack running. **You don't need Apple Wallet or Google Wallet creds to test points programs** — those endpoints will just 503 gracefully.

Minimum required:

```
PORT=4000
DATABASE_URL=mysql://stampdeck:stampdeck_dev_pass@mysql:3306/stampdeck
GOOGLE_WALLET_ISSUER_ID=0
GOOGLE_WALLET_SA_KEY_PATH=/secrets/nonexistent.json
JWT_SECRET=any-string-at-least-8-chars
BASE_URL_WEB=http://localhost:3001
BASE_URL_API=http://localhost:4000
RESEND_API_KEY=
EMAIL_FROM=OnUsClub <onboarding@resend.dev>
```

Leave APPLE_* vars empty — they default to empty already and the api degrades gracefully.

### Start dev stack

```bash
docker compose -f docker-compose.dev.yml up -d
# wait ~20s for first-time install

# Verify api responding:
curl http://localhost:4000/health
# {"ok":true,"service":"api","version":"0.0.1"}
```

Migrations auto-apply on api start (the migration runner is part of the api boot). If you want to force them manually:

```bash
docker compose -f docker-compose.dev.yml exec api pnpm --filter @onusclub/api run db:migrate
```

### Smoke test

```bash
docker compose -f docker-compose.dev.yml exec api pnpm --filter @onusclub/api run smoke
# Should print 95+ "→" lines and finish with "✓ smoke test passed"
```

If smoke is green, the local dev environment is fully working.

### Open the dashboard

```
http://localhost:3001
```

Sign up a fresh owner account (since the office laptop's DB is empty), create a points program, follow the test recipe above.

### What you canNOT test on the office laptop without extra setup

- **Apple Wallet pass download** — needs the `.p12` certs in `secrets/apple/` + the `APPLE_*` env vars filled in. Those live on your personal Mac + in your password manager. Skip on the office laptop unless you bring them over.
- **Google Wallet save link** — needs the service-account JSON + the issuer ID. Same deal.
- **APNs live updates** — needs Apple Wallet first.
- **Resend email delivery** — needs the API key.

None of these block points testing. They're orthogonal.

## Deploying Day 14 to the VPS (when ready)

On the VPS:

```bash
ssh root@api.onusclub.com
cd /docker/stampdeck

git fetch origin
git checkout day-14-points-programs
git pull origin day-14-points-programs

# Rebuild api + web (mysql untouched)
docker compose -f docker-compose.prod.yml up -d --build api web

# Apply migration 007
docker compose -f docker-compose.prod.yml exec api node dist/db/migrate.js
# expect: "applying migration 007_points_batches.sql"

# Verify
curl -sf https://api.onusclub.com/health
```

After this is live, you can create points programs in the prod dashboard at `https://app.onusclub.com` and they'll work for real customers (once Google Wallet production approval lands).

## Items left in the TODO list

Three things naturally follow:

1. **Stripe billing** — user flagged as "last part" of feature work. ~1-2 days.
2. **Google Wallet production approval** — paperwork: marketing site + privacy/ToS + 660×660 logo + business contact email. Friend is shipping the marketing site polish. ~10 min user-side once friend is done, then 1-3 days Google review.
3. **Backblaze B2 offsite backup** — code is ready (commit `5769902` on `phase-b-rename`). User just needs to sign up for B2, get a key + bucket, paste 3 lines into VPS `.env`, install `b2` CLI. See `DEPLOY.md §9` for the runbook.

Smaller items (no rush):

- Day 14 scan-flow update for points (needs amount-capture UX)
- Drop sippzy.com legacy Traefik routes (after 1-2 weeks of onusclub.com stability)
- Day 13 ROADMAP entry housekeeping (already done in this commit)

See [ROADMAP.md](./ROADMAP.md) for the full prioritized list.
