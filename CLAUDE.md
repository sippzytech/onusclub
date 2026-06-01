# Stampdeck — Project Context

This file is the canonical context for Claude Code sessions on this repo. Keep it tight and accurate.

## What we're building

Multi-tenant SaaS for **digital loyalty cards** for cafés, salons, and similar SMBs.

- **Phase 1**: stamp cards only, Google Wallet only.
- **Phase 2**: Apple Wallet + more card types (points, memberships, multipass, discount, cashback, gift, coupon).
- The DB schema is already polymorphic (`loyalty_programs.program_type` + `config_json`, `loyalty_cards.card_state` JSON) so adding card types does not require a schema rewrite.

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

Subdomains already pointed at the VPS:

- `api.sippzy.com` → Node API
- `app.sippzy.com` → Next.js dashboard + customer landing pages

In `docker-compose.prod.yml`:

- All stampdeck services join the external `n8n_default` network so Traefik can reach them.
- We do **not** publish api/web ports to the host (Traefik handles ingress).
- MySQL has no published port and is reachable only on the internal stampdeck network.
- Traefik labels use `certresolver=mytlschallenge`.

### How to deploy (stub)

Full runbook TBD. The pattern will be:

1. SSH to VPS, `cd /docker/stampdeck`.
2. `git pull`.
3. `docker compose -f docker-compose.prod.yml up -d --build`.
4. Traefik picks up labels and routes automatically.
5. Migrations: `docker compose -f docker-compose.prod.yml run --rm api pnpm db:migrate`.

The Google Wallet service-account key already lives at `/docker/stampdeck/secrets/wallet-sa.json` on the VPS (chmod 600) and is mounted into the api container at `/secrets/wallet-sa.json`. **Never** put the key in the repo.

## Google Wallet

- **Issuer ID**: `3388000000023150410`
- **Service account email**: `wallet-issuer@sippzy-wallet.iam.gserviceaccount.com`
- **Key path (VPS)**: `/docker/stampdeck/secrets/wallet-sa.json` (mounted into api container as `/secrets/wallet-sa.json`)
- **Env vars** the api reads: `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SA_KEY_PATH`
- No real wallet integration on Day 1 — env is wired so Day 2+ can drop in the loyalty-class/object code.

## Schema

See `apps/api/src/db/migrations/001_initial.sql` — single source of truth. Tables: `merchants`, `locations`, `loyalty_programs`, `customers`, `loyalty_cards`, `card_events`, `staff_users`, `auth_tokens`.

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

## Status — Day 9 (current)

**Deployed live at `api.sippzy.com` + `app.sippzy.com`**.

What works end-to-end:

- ✅ Owner signup/login with password (bcrypt), forgot/reset password flow
- ✅ Multi-tenant with auto-generated public slug per merchant
- ✅ Programs, customers, cards, stamp + redeem (transactional, day-rate-limited on scan)
- ✅ Google Wallet integration: per-merchant LoyaltyClass, per-card LoyaltyObject, save-to-Wallet JWT, live state PATCH on every stamp/redeem, lifecycle push notifications
- ✅ Public QR-driven customer self-signup (Perkstar-style flow at `/m/[slug]`)
- ✅ QR scanner UI (`html5-qrcode`) with state-machine feedback
- ✅ Async broadcasts with audience filters + live progress polling
- ✅ Daily cron sweeps: birthday 08:00, inactivity 10:00, expiry 03:00 (Europe/Amsterdam)
- ✅ Per-card delivery audit (broadcasts + sweeps) with manual retry
- ✅ Premium feature gate (fake unlock for now) + crons-enabled kill-switch
- ✅ Card expiry (per-program `expiry_days` config → Wallet `state=EXPIRED`)
- ✅ Staff/team accounts (`/dashboard/team`, owner-only CRUD)
- ✅ Resend email delivery (still on Resend test mode — only delivers to sippzy.official@gmail.com until domain verified)

## Where to look for the current plan

**[ROADMAP.md](./ROADMAP.md)** is the canonical source of truth for:
- Day-by-day history (every shipped feature)
- Deferred items (Wallet production approval, Resend domain, card customization, etc.) with the "why"
- Likely next-step candidates ranked by effort vs value
- How to onboard a fresh Claude session (or any new collaborator)

Read ROADMAP.md before planning anything new.

## Other key docs

- **[DEPLOY.md](./DEPLOY.md)** — first-time VPS deploy + day-to-day deploy commands.
- **[METABASE.md](./METABASE.md)** — wire the existing VPS Metabase to Stampdeck data, with 7 starter SQL queries.
- **[README.md](./README.md)** — local-dev quickstart.
