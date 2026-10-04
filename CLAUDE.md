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

- **Issuer ID**: `3388000000023208694` — console account `BCR2DN6D5KYJPGBL` ("On Us Club"), on the **Netherlands** payments profile `4896-3145-4976`. Live in prod since 2026-10-01.
- **Service account email**: `wallet-issuer@sippzy-wallet.iam.gserviceaccount.com`
- **Key path (VPS)**: `/docker/stampdeck/secrets/wallet-sa.json` (mounted into api container as `/secrets/wallet-sa.json`)
- **Env vars** the api reads: `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SA_KEY_PATH`
- Fully integrated since Day 4 (`apps/api/src/wallet/`). Apple Wallet lives in `apps/api/src/wallet-apple/`.
- ✅ **PRODUCTION APPROVED 2026-10-02.** Out of demo mode — any Google account can save a pass, not just allowlisted testers. Google confirmed against issuer `3388000000023208694` / merchant `BCR2DN6D5KYJPGBL`, region NL. No code change was needed: the LoyaltyClass, LoyaltyObject and save-to-Wallet JWT flow have worked since Day 4.

### The old issuer, and the one thing that must not be deleted

The original issuer `3388000000023150410` (console `BCR2DN5TV76KB735`) is **retired**. It was bound to an **India** payments profile (`2385-6594-2270`) whose country can never be changed, and that profile makes PAN/GSTIN mandatory — which a Dutch eenmanszaak cannot supply, permanently blocking publishing access. Google support confirmed they will not re-associate an issuer; the supported fix is a new business profile. Google has been asked to disable the old merchant account.

🚨 **`2385-6594-2270` must NOT be disabled.** It is the *organization profile for Google Cloud*, attached to the GCP project `sippzy-wallet` that hosts the service account above — the one still signing every pass on the **new** issuer. Disabling it could take out the signing identity. Only the merchant account `BCR2DN5TV76KB735` is safe to disable.

Switching issuers is an env-var change, never a code change — `GOOGLE_WALLET_ISSUER_ID` is not hardcoded anywhere. But see `objectOnCurrentIssuer()` in `wallet/state.ts`: stored `google_wallet_object_id` values embed the issuer, so a stale one must be treated as absent or pre-existing cards silently stop syncing.

## Schema

See `apps/api/src/db/migrations/` — the numbered SQL files are the single source of truth, `001_initial.sql` through `013_email_deliveries.sql`. Core tables: `merchants`, `locations`, `loyalty_programs`, `customers`, `loyalty_cards`, `card_events`, `staff_users`, `auth_tokens`; later migrations add `broadcasts`, `sweep_runs`, `message_deliveries`, `apple_pass_registrations`, `points_batches`, `leads`, `merchant_assets`, `platform_admins`, `admin_audit_log`,
`email_deliveries`.

⚠️ **`loyalty_cards.card_state.points_current` is a CACHE, not the ledger.** The
authoritative points balance is `SUM(points_batches.points_remaining)` over non-expired
batches, which `computePointsBalance` recomputes on every write. Anything that changes a
points balance must go through the batch rows; writing `card_state` directly displays
correctly, updates the wallet pass, and is then silently reverted by the next real
transaction. See `applyManualAdjust` in `apps/api/src/cards/operations.ts`.

Polymorphism is in two JSON columns:

- `loyalty_programs.config_json` — type-specific rules (e.g. stamp cards: `{ stamps_required }`; points: `{ points_per_currency, expiry }`).
- `loyalty_cards.card_state` — type-specific state (e.g. stamp cards: `{ stamps_current, total_lifetime, rewards_redeemed }`).

When adding a new `program_type`, define its config + state shapes in `packages/shared` first, then handle it in api business logic. No schema migration needed for new types.

## Conventions

- Strict TypeScript everywhere. No `any` in checked-in code.
- `pnpm --filter @onusclub/api run typecheck` uses **`tsconfig.scripts.json`**, which covers
  `scripts/` as well as `src/`. The build still uses `tsconfig.json` (it needs
  `rootDir: src`). Before 2026-10-05 the smoke scripts were not typechecked at all, and six
  real errors had accumulated in them.
- API uses **ESM** (`"type": "module"`); imports use `.js` extensions in compiled output.
- Env validated with zod at startup; the api fails fast if required vars are missing.
- Secrets only via env vars or mounted files — never committed.
- All tenant-scoped queries must filter by `merchant_id`. Not enforced by a mechanism — an
  audit found a query wrapper would be high-friction and mostly redundant — but **proven**
  behaviourally by the cross-tenant isolation suite in `apps/api/scripts/smoke.ts`. Every
  new `:id`-taking endpoint needs a case added there.
- **The one deliberate exception is `apps/api/src/routes/admin/` and
  `apps/api/src/admin/`**, which read across tenants on purpose. That is why they are their
  own directories: "where is tenant scoping bypassed?" should be answerable with `ls`.
  Authorization is applied once, to the `/v1/admin` mount in `index.ts`, not per route —
  see `docs/admin/README.md`.

## Status — Day 23 (current)

**Deployed live at `api.onusclub.com` + `app.onusclub.com`**, from branch **`main`**.

⚠️ **Production is behind `main` on migrations.** As of 2026-10-04 the box had `001`–`009`
applied; `010_trial_period`, `011_merchant_assets`, `012_platform_admin` and
`013_email_deliveries` are on `main` but not confirmed applied there. Check with
`docker compose -f docker-compose.prod.yml exec api node dist/db/migrate.js` — it is
idempotent and skips what is already in `_migrations`. Note that is the **compiled** runner;
`pnpm db:migrate` is dev-image only and will fail in prod.

**Branching**: `main` is the trunk — branch from it, merge back into it, deploy it. It was created on 2026-09-25; before that the repo had no trunk, just 16 unmerged `day-*` branches with `origin/HEAD` pointing at `day-1-skeleton` (which predates auth). Every legacy branch was verified to be an ancestor of `main` before the cut, so they hold nothing unique.

⚠️ **The legacy `sippzy.com` routes are dead.** `api.sippzy.com` and `app.sippzy.com` no longer resolve in DNS (checked against the system resolver, `1.1.1.1` and `8.8.8.8` on 2026-09-17 — all three return nothing). `docker-compose.prod.yml` still carries the `DOMAIN_API_LEGACY` / `DOMAIN_WEB_LEGACY` Traefik routers, but with no DNS in front of them they are unreachable. Any Apple pass saved before the Day 13 cutover has `webServiceURL` baked in pointing at `api.sippzy.com`, so **those passes have already stopped updating** — they still display, just frozen. Either restore the DNS records or drop the legacy routers; keeping them as-is is the one option that helps nobody.

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
- ✅ Cron sweeps: expiry 03:00, points-expiry 04:00, birthday 08:00, inactivity 10:00 daily,
  plus the merchant digest Mondays 08:00 (all Europe/Amsterdam)
- ✅ Per-card delivery audit (broadcasts + sweeps) with manual retry
- ✅ Premium feature gate (fake unlock for now) + crons-enabled kill-switch
- ✅ Staff/team accounts (`/dashboard/team`, owner-only CRUD)
- ✅ Smoke suite gated in CI on every PR, in three parts: `pnpm smoke` (black-box, includes
  the cross-tenant isolation section), `pnpm smoke:admin` (needs `DATABASE_URL`, because
  granting platform admin is SQL-only), and `pnpm check:wallet` (pure assertions on the
  Google Wallet class payload — the integration cannot be exercised outside production)
- ✅ **Card design system** (Day 16): shared SVG renderer, per-program design editor in
  `/dashboard/card-builder`, Apple Wallet `strip.png` artwork. See `docs/card-design/README.md`.
  Deployed and **verified on a physical iPhone 2026-09-18**.
- 🔶 Resend: the VPS `.env` sends from `noreply@send.onusclub.com`, a verified custom
  domain — so the old "test mode, only delivers to sippzy.official@gmail.com" note no
  longer holds. **Delivery to an arbitrary third-party address has not actually been
  observed**, so treat "real customer email works" as likely-but-unconfirmed until
  someone watches one land.
- ✅ **Analytics page** (Day 17): trends, busiest hours, new-vs-returning, top members.
  Charts are hand-rolled inline SVG so the page ships zero client JS. Day/hour bucketing
  is converted to the merchant's timezone **in Node via `Intl`**, not in SQL — see the
  Day 17 ROADMAP entry for why `CONVERT_TZ` and fixed offsets were both rejected.
- ✅ **Merchant branding** (Day 21): `/dashboard/settings` writes `brand_color` and the
  merchant's own logo, which until now had no write path at all. Logos are stored as a
  BLOB in `merchant_assets` rather than on disk — it travels with `mysqldump` instead of
  becoming a second thing to migrate — and served from a public, content-hashed URL
  because Google fetches `programLogo` server-side and caches it by URI.
- ✅ **Email delivery visibility + weekly digest** (Day 25): `email_deliveries` records
  every send, written from inside `sendEmail` so no caller can forget. Three states —
  `skipped` means no provider configured and must never be counted as a failure. Surfaced
  on the merchant Overview (only when something failed), Settings, the card page, and
  `/admin`. Plus a Monday-morning digest to each café, idempotent via `email_deliveries`
  rather than a new table.
- ✅ **Proximity notifications** (Day 24): shop locations on `/dashboard/settings`, up to
  10 per café, feeding the OS-level geofence on both wallets — the pass surfaces on the
  lock screen near the shop with nothing running on our side. Coordinates come from a
  pasted Google Maps link or typed in; no geocoding API. ⚠️ Google's
  `LoyaltyClass.locations` is **deprecated and silently never fires** — the working field
  is `merchantLocations`, and anything added to `buildLoyaltyClass` must also be added to
  `classBrandingDiffers` or it reaches new classes only. `pnpm check:wallet` guards both.
- ✅ **Master admin dashboard** (Day 23): `/admin` — every café in one place with health
  flags, cross-merchant customer search and timelines, balance corrections, account
  controls and an append-only audit log. **[docs/admin/README.md](./docs/admin/README.md)**
  is the reference, including the grant SQL. Three things to know before touching it:
  access is a row in `platform_admins` checked per-request and never cached (not a JWT
  role, so revocation is instant); there is no "profit" figure anywhere and that is
  deliberate; and every balance adjustment is visible to the café on **their own**
  dashboard, with the reason — don't remove that.

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
