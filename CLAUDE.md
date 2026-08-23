# OnUsClub — Project Context

This file is the canonical context for Claude Code sessions on this repo. Keep it tight and accurate.

## What we're building

Multi-tenant SaaS for **digital loyalty cards** for cafés, salons, and similar SMBs.

- **Shipped**: stamp cards + points cards, on both Google Wallet and Apple Wallet.
- **Later**: memberships (pairs with Stripe billing). Multipass / discount / cashback / gift / coupon are deliberately **not** planned as separate types — the stamp + points engines already cover those use cases; see PERKSTAR_ANALYSIS.md.
- The DB schema is polymorphic (`loyalty_programs.program_type` + `config_json`, `loyalty_cards.card_state` JSON) so adding card types does not require a schema rewrite. Day 14 proved this: adding points needed zero DDL on existing tables.

## Positioning

Competitors: **Perkstar** (UK) and **Tap2** (NL).
We win on: **Netherlands-first**, SMB-friendly UX, transparent pricing, Google reviews integration loop.

## Stack (decided — do not drift)

- **Monorepo**: pnpm workspaces.
- **apps/api**: Node 20 + Express + TypeScript (`"type": "module"`, strict TS). mysql2/promise, jsonwebtoken, google-auth-library, zod, pino.
- **apps/web**: Next.js 14 App Router + TypeScript + Tailwind + NextAuth (email magic link).
- **packages/shared**: shared TypeScript types (program configs, card state shapes, event types).
- **DB**: MySQL 8.
- **Containers**: Docker + docker-compose, both for local dev and VPS deployment.
- **Routing in prod**: Traefik (already running on the VPS — we do not add Caddy/Nginx).

## Ports

| Service | Local | Prod |
|---|---|---|
| api | 4000 | internal (Traefik) |
| web | 3001 | internal (Traefik) |
| mysql | 3306 | internal only |

`apps/web` is on **3001 locally** because the VPS already binds host port 3000 to Metabase. Never publish port 3000 from this project.

## Deployment target (Hostinger VPS)

Already running on the box:

- **Traefik** in Docker, on ports 80/443, network `n8n_default`. Cert resolver name is `mytlschallenge` (Let's Encrypt, TLS-ALPN).
- **n8n** at `n8n.sippzy.com`.
- **Metabase** on host port 3000.

Subdomains pointed at the VPS:

- `api.onusclub.com` → Node API (primary)
- `app.onusclub.com` → Next.js dashboard + customer landing pages (primary)
- `api.sippzy.com` / `app.sippzy.com` → same containers, legacy routers. Keep until old saved wallet passes have aged out; `DOMAIN_API_LEGACY` / `DOMAIN_WEB_LEGACY` in `docker-compose.prod.yml` control them.
- `onusclub.com` + `www` → Netlify marketing site (separate repo, not in this monorepo)

In `docker-compose.prod.yml`:

- All OnUsClub services join the external `n8n_default` network so Traefik can reach them.
- We do **not** publish api/web ports to the host (Traefik handles ingress).
- MySQL has no published port and is reachable only on the project-internal Docker network.
- Traefik labels use `certresolver=mytlschallenge`.

### How to deploy

**[DEPLOY.md](./DEPLOY.md) is the canonical runbook.** Day-to-day it is:

```bash
ssh root@api.onusclub.com
cd /docker/stampdeck
git pull
docker compose -f docker-compose.prod.yml up -d --build
# only if the new commit added a migration:
docker compose -f docker-compose.prod.yml exec api node dist/db/migrate.js
```

Traefik picks up the labels and routes automatically. Note the migration runs the
**compiled** `dist/db/migrate.js` — `pnpm db:migrate` is dev-image only and will fail
in prod.

The Google Wallet service-account key already lives at `/docker/stampdeck/secrets/wallet-sa.json` on the VPS (chmod 600) and is mounted into the api container at `/secrets/wallet-sa.json`. **Never** put the key in the repo.

## Google Wallet

- **Issuer ID**: `3388000000023150410`
- **Service account email**: `wallet-issuer@sippzy-wallet.iam.gserviceaccount.com`
- **Key path (VPS)**: `/docker/stampdeck/secrets/wallet-sa.json` (mounted into api container as `/secrets/wallet-sa.json`)
- **Env vars** the api reads: `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SA_KEY_PATH`
- Fully integrated since Day 4 (`apps/api/src/wallet/`). Apple Wallet lives in `apps/api/src/wallet-apple/`.
- ⚠️ The issuer is **still in Google's demo mode** — only allowlisted test Google accounts can save a pass. Production approval is a Business Console form submission, not a code change. See ROADMAP.md "Wallet production approval".

## Schema

See `apps/api/src/db/migrations/` — the numbered SQL files are the single source of truth, `001_initial.sql` through `008_card_event_amount.sql`. Core tables: `merchants`, `locations`, `loyalty_programs`, `customers`, `loyalty_cards`, `card_events`, `staff_users`, `auth_tokens`; later migrations add `broadcasts`, `sweep_runs`, `message_deliveries`, `apple_pass_registrations`, `points_batches`.

Polymorphism is in two JSON columns:

- `loyalty_programs.config_json` — type-specific rules (e.g. stamp cards: `{ stamps_required }`; points: `{ points_per_currency, expiry }`).
- `loyalty_cards.card_state` — type-specific state (e.g. stamp cards: `{ stamps_current, total_lifetime, rewards_redeemed }`).

When adding a new `program_type`, define its config + state shapes in `packages/shared` first, then handle it in api business logic. No schema migration needed for new types.

## Conventions

- Strict TypeScript everywhere. No `any` in checked-in code.
- API uses **ESM** (`"type": "module"`); imports use `.js` extensions in compiled output.
- Env validated with zod at startup; the api fails fast if required vars are missing.
- Secrets only via env vars or mounted files — never committed.
- All tenant-scoped queries must filter by `merchant_id`. (Will be enforced via a request-scoped context once auth lands.)

## Status — Day 15 (current)

**Deployed live at `api.onusclub.com` + `app.onusclub.com`.** The old `api.sippzy.com` / `app.sippzy.com` routes still resolve to the same containers via legacy Traefik routers, because wallet passes saved before the Day 13 cutover still point at them.

What works end-to-end:

- ✅ Owner signup/login with password (bcrypt), forgot/reset password flow
- ✅ Multi-tenant with auto-generated public slug per merchant
- ✅ **Two program types**: stamp cards, and points cards with per-batch FIFO expiry (Day 14)
- ✅ **Google Wallet**: per-merchant LoyaltyClass, per-card LoyaltyObject, save-to-Wallet JWT, live state PATCH on every stamp/redeem, lifecycle push notifications
- ✅ **Apple Wallet**: signed `.pkpass`, Apple Web Service endpoints, live in-place updates via APNs push (Days 11-12)
- ✅ Public QR-driven customer self-signup (`/m/[slug]`) + customer card view (`/c/[qrToken]`)
- ✅ QR scanner UI (`html5-qrcode`) with state-machine feedback, incl. the points `needs_amount` step
- ✅ **Revenue capture** (Day 15): optional sale amount at scan / on manual buttons → `card_events.amount_cents` → revenue, AOV, and a real activity feed on the Overview page
- ✅ Async broadcasts with audience filters + live progress polling
- ✅ Daily cron sweeps: expiry 03:00, points-expiry 04:00, birthday 08:00, inactivity 10:00 (Europe/Amsterdam)
- ✅ Per-card delivery audit (broadcasts + sweeps) with manual retry
- ✅ Premium feature gate (fake unlock for now) + crons-enabled kill-switch
- ✅ Staff/team accounts (`/dashboard/team`, owner-only CRUD)
- ✅ Smoke suite at 108 assertions, gated in CI on every PR
- ⚠️ Resend still on test mode — only delivers to sippzy.official@gmail.com until the sender domain is verified
- ⚠️ `/dashboard/card-builder` and `/dashboard/analytics` are placeholder pages

### Naming: three different names, on purpose

Local dir is `stampdeck` (legacy), the GitHub repo is `onusclub`, pnpm packages are `@onusclub/*`. The MySQL DB name, MySQL user, Docker volume, VPS deploy dir (`/docker/stampdeck/`) and the Google Wallet issuer project (`sippzy-wallet`) were **deliberately not renamed** in Day 13 — renaming them risks data loss for zero user-visible benefit. Customers never see these names.

## Where to look for the current plan

**[ROADMAP.md](./ROADMAP.md)** is the canonical source of truth for:
- Day-by-day history (every shipped feature)
- Deferred items (Wallet production approval, Resend domain, card customization, etc.) with the "why"
- Likely next-step candidates ranked by effort vs value
- How to onboard a fresh Claude session (or any new collaborator)

Read ROADMAP.md before planning anything new.

## Other key docs

- **[DEPLOY.md](./DEPLOY.md)** — first-time VPS deploy + day-to-day deploy commands.
- **[METABASE.md](./METABASE.md)** — wire the existing VPS Metabase to OnUsClub data, with 7 starter SQL queries.
- **[README.md](./README.md)** — local-dev quickstart.
