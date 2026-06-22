# OnUsClub Roadmap

The durable plan. Any Claude session (or human) opening this repo cold should be able to read this file and know exactly what's done, what's coming, and what's deliberately on hold.

## North star

Multi-tenant SaaS for **digital loyalty cards** (Google Wallet phase 1, Apple Wallet phase 2). Netherlands-first, SMB-friendly. Competing with Perkstar (UK) and Tap2 (NL).

See also: [CLAUDE.md](./CLAUDE.md) for stack + conventions, [DEPLOY.md](./DEPLOY.md) for the prod deploy runbook, [METABASE.md](./METABASE.md) for analytics setup.

---

## Done — day-by-day

Each day below corresponds to a git branch + a commit. Run `git log --oneline --all` to see them, or browse on GitHub.

### Day 1 — skeleton
- pnpm-workspaces monorepo (apps/api, apps/web, packages/shared).
- Express + TypeScript api with `GET /health`.
- Next.js 14 web on port 3001 (3000 reserved for VPS Metabase).
- MySQL 8 in Docker, custom SQL migration runner.
- Docker dev compose + a stub prod compose.

### Day 2 — auth + first business objects
- Magic-link email auth (later replaced by password auth on Day 8).
- `POST /v1/merchants` (signup), `POST /v1/programs` (create stamp program), `GET /v1/me`.
- Dashboard `/dashboard` shows merchant + programs.

### Day 3 — customers, cards, stamp + redeem
- Schema already-polymorphic from Day 1 fills in: `loyalty_cards`, `card_events`.
- Stamp + redeem run in transactions with `SELECT … FOR UPDATE` so concurrent stamps can't double-count.
- Dashboard pages: Customers, Cards, Card Detail with stamp/redeem buttons + event timeline.

### Day 4 — Google Wallet end-to-end + live push notifications
- `apps/api/src/wallet/` — service-account loader, GoogleAuth, LoyaltyClass/Object lifecycle, save JWT issuance.
- Card lifecycle now mirrors to Google Wallet (best-effort — DB row is source of truth, wallet is eventual).
- 4 lifecycle messages with distinct copy: signup welcome, +1 stamp, threshold-unlocked, reward-redeemed.
- Verified live on a Samsung phone (sippzy.official@gmail.com test user).

### Day 5 — QR scan flow + automatic email invite
- New `/dashboard/scan` page using `html5-qrcode` for live camera scan.
- `POST /v1/scan` shares the same stamp/redeem transactional core as the manual buttons.
- Resend integration: enrolling a customer with an email auto-sends an "Add to Google Wallet" email with a real signed save link.
- Customer/card list pages get search + inline +1 stamp button.

### Day 6 — broadcasts, sweeps, cron monitor
- Migration `002_messaging`: `broadcasts`, `sweep_runs`, `message_deliveries`, `customers.birthday`.
- Async broadcasts (fire-and-forget, polled by UI for live progress %).
- Birthday + inactivity daily cron sweeps via node-cron.
- `/dashboard/messages` tab: composer, live activity feed, per-card detail, retry-failed button.

### Day 7 — first VPS deploy
- Real HTTPS at `api.sippzy.com` + `app.sippzy.com` via the existing Traefik on `n8n_default` network.
- MySQL container joins both `internal` (private) AND `n8n_default` so n8n + Metabase can reach it.
- Host port `127.0.0.1:33061` for SSH-tunnel debug.
- Init script creates a read-only `reporting` user on first MySQL boot.
- Migration runner copies SQL files into dist/ so `node dist/db/migrate.js` works in prod.
- Hit `ERR_UNKNOWN_FILE_EXTENSION` because `@stampdeck/shared` was shipping `.ts` — fixed by compiling shared and pointing main/exports to dist.
- DEPLOY.md is the canonical runbook for day-to-day deploys.

### Day 8 — password auth + public QR-driven customer signup
- Migration `003_auth_and_public_slug`: `staff_users.password_hash`, `merchants.public_slug`.
- bcryptjs for password hashing (cost 12).
- Web /signup and /login replaced with password forms.
- Slug generator: `<kebab-business-name>-<5-char>` (e.g. `cafe-bonsoir-x7k9z`).
- Public no-auth endpoints: `GET /v1/public/m/:slug` + `POST /v1/public/m/:slug/enrol`.
- `/m/[slug]` page — branded customer-facing landing, Perkstar-style flow.
- Dashboard gains a QR-share card with downloadable PNG.

### Day 8b — premium gate + once-per-day scan + UI polish
- Migration `004_premium_and_cron_flags`: `merchants.is_premium`, `merchants.crons_enabled`.
- Messages feature is premium-only (fake unlock via PATCH /v1/me/preferences for now).
- Cron sweeps filter on both flags.
- Scan: server-side once-per-day stamp rule, scanner state-machine UI with pulsing camera frame, 30s same-token cooldown.
- Default stamps_required dropped from 10 → 6.
- Bonus: fixed `Cannot stop, scanner is not running or paused.` Next.js error overlay by guarding `stop()` on scanner state.

### Day 9 — forgot password + card expiry + audience filters + team + Metabase
- Migration `005_expiry_and_audience`: `loyalty_cards.status` widens to include `'expired'`, `broadcasts.audience_filter` JSON.
- Forgot/reset password flow on `/forgot-password` + `/auth/reset-password`. Reuses `auth_tokens` table.
- Card expiry: programs accept optional `expiryDays`, daily cron at 03:00 flips stale cards to `expired` + PATCHes Wallet to `state=EXPIRED` (pass auto-moves to Inactive).
- Broadcast audience filters: minLifetimeStamps, withBirthdayThisMonth, specific programId.
- Staff/team accounts: /dashboard/team page, owner-only CRUD on staff_users, staff role can log in and use the dashboard.
- METABASE.md runbook with 7 starter SQL queries.
- Smoke test: 70 assertions.

### Day 12 — Apple Wallet live updates via APNs push
- Static pass from Day 11 becomes live: every stamp / redeem now shows a lock-screen notification on the iPhone and updates the pass in-place, matching the Google Wallet UX.
- Migration `006_apple_wallet_registrations`: per-card `apple_auth_token` for the `Authorization: ApplePass <token>` header that Wallet sends on every web-service call, plus `apple_pass_registrations` (device⇄pass mappings, push tokens, last-updated for stale-cleanup).
- 5 Apple Web Service endpoints under `/v1/apple-wallet`: register (POST), unregister (DELETE), list-updated-serials (GET), get-latest-pass (GET, returns fresh signed `.pkpass` with `Last-Modified` header), log sink (POST).
- APNs client (`wallet-apple/apns.ts`) — raw Node `http2`, lazy-loads the Pass Type ID push cert via the same node-forge PKCS#12 dance as the pass signer. No extra npm dep. Stale registrations auto-pruned when APNs returns 410.
- `pushAppleWalletUpdate()` wires into `syncCardToWallet()` so every stamp/redeem fans out push notifications to all registered devices for that card. Best-effort, off-the-critical-path.
- Pass.json now emits `webServiceURL` + `authenticationToken` — but only when `BASE_URL_API` is HTTPS (iOS rejects HTTP), so dev over plain HTTP gracefully falls back to a Day-11-style static pass.
- `changeMessage` on the stamps + remaining fields so Wallet shows the actual notification text ("You have 5/6 stamps — keep going!") instead of silently swapping.
- Smoke 82/82 (6 new Day 12 web-service assertions: 401 without auth, 401 with wrong token, 404 with bogus passType, 401 on get-latest-pass without auth, 204 on list-updated for unknown device, 200 on log endpoint).
- Verified end-to-end on real iPhone: stamp on dashboard → ~3s later, lock-screen banner + Wallet count updates from 4/6 → 5/6 → 6/6 with no manual interaction.

### Day 11 — Apple Wallet end-to-end + OnUsClub branding rename (Phase A)
- Phase A rename: Stampdeck → OnUsClub in user-visible strings only (page titles, emails, dashboard headings, wallet placeholder logo text). Internal package / container / repo / DB names still `stampdeck` until the Day 13 Phase B rename.
- New module `apps/api/src/wallet-apple/`: lazy-loading client (extracts PEM cert + key from `.p12` via node-forge), state mapper, passkit-generator-based pass builder. Apple Wallet vars empty → 503 gracefully.
- New endpoint `GET /v1/public/c/:qrToken/apple-pass` — no auth, signed `.pkpass` download. Content-Type `application/vnd.apple.pkpass`, no-store.
- "Add to Apple Wallet" button on `/dashboard/cards/[id]`, `/c/[qrToken]`, and the invite email (alongside Google Wallet).
- `BASE_URL_API` env var added so the api can build its own public URLs for email links.
- Verified on real iPhone via LAN: signed pass downloaded in Safari → saved to Wallet → renders storeCard layout with QR + member ID + stamp count.
- Smoke 76/76 (3 new Apple-pass assertions: malformed qr_token 404, unknown qr_token 404, active card returns 7-8 KB pkpass with PK magic bytes).

### Day 10 — polish + infra
- UI gaps: Create Program form gains an "Expiry (optional)" days input (the API supported it from Day 9, just needed surfacing). Program list shows the expiry policy. Broadcast detail page shows an "Audience:" summary line above the totals.
- **Customer-facing card page** at `/c/[qrToken]`: branded read-only view a customer can bookmark or share, no auth (qr_token's 32-byte entropy is the access credential). Shows stamps_current / required, reward, status pill, lifetime redeemed count, and an "Add to Google Wallet" link if not yet saved. New endpoint `GET /v1/public/c/:qrToken` — sanitised return (no events, no other customers).
- **MySQL backup automation**: `scripts/backup-mysql.sh` streams `mysqldump --single-transaction` out of the container, gzips to `/docker/stampdeck/backups/stampdeck-YYYY-MM-DD_HHMMSS.sql.gz`, prunes anything older than 30 days. Wires to host cron at 02:30 UTC. Restore command + retention tunable + future-offsite-backup note documented in DEPLOY.md §9.
- **CI**: `.github/workflows/ci.yml` runs on every push and PR — pnpm install (frozen lockfile), build shared, typecheck all, build api + web. Cheap safety net.
- Smoke test: 73 assertions (adds public card view happy + 404 + malformed).

---

## Deferred — saved for later (with the why)

### Wallet production approval *(blocker on real customer launch)*
- Issuer `3388000000023150410` is still in Google's demo mode.
- Until approved, only Google accounts on the test users allowlist can save passes.
- **Gated on**: OnUsClub marketing site with a privacy policy + ToS URL + business logo.
- Process: submit at <https://pay.google.com/business/console/> → Google reviews in 1-2 business days.

### Resend sender domain verification *(blocker on real customer email)*
- Currently `EMAIL_FROM=OnUsClub <onboarding@resend.dev>` (Resend's onboarding domain).
- Resend test mode only delivers to the account-owner email (`sippzy.official@gmail.com`).
- **Gated on**: ownership of DNS for sippzy.com (we have it) + a verified domain in Resend → add 3 TXT records → minutes later flip `EMAIL_FROM` env on the VPS.
- **Zero code change required.**

### Wallet / card visual customization *(deliberately big-bang)*
- The user has many ideas (possibly AI-assisted curation/design).
- Will be a focused, designed-properly project — not a quick logo+color toggle.
- Default `placehold.co` logo + black brand color until then.

### Owner magic-link email *(small gap)*
- Day 2's magic-link auth was replaced by password auth in Day 8.
- The magic-link API endpoints (`/v1/auth/request`, `/v1/auth/verify`) still exist in the codebase but aren't wired to email delivery.
- If/when we want passwordless owner login again, just wire `issueMagicLink()` to `sendEmail()`.

### Expiry input on Program create form *(2-minute follow-up)*
- The API accepts `expiryDays` (Day 9) but the dashboard's Create Program form doesn't surface a UI for it yet.
- One number input + a small "leave blank for no expiry" hint.

### Audience filter display on broadcast detail page *(small polish)*
- The filter is stored and surfaced in `/v1/broadcasts/:id`, but the detail page doesn't render it.
- Just add a small summary line: "Sent to: customers with ≥5 stamps".

---

## Likely next steps (Day 13+)

Pick whatever the user finds most valuable next. None are dependencies on each other.

| Idea | Effort | Value |
|---|---|---|
| **VPS migration + Phase B rename** (`stampdeck` → `onusclub` in code/infra) | half day | Required before pointing onusclub.com DNS. Quick once we commit to a date. |
| **Stripe billing** for the premium gate | 1-2 days | Turn fake unlock into real revenue |
| **Multi-program type support** (points, membership) | 1-2 days | Schema is already polymorphic — just need the business logic + UI. |
| **Offsite backup upload** (S3 / Backblaze / second VPS) | 2-3 h | Day 10 backs up locally; an offsite copy survives VPS disk failure. |
| **Owner magic-link email** (re-wire) | 1-2 h | Optional passwordless flow for owners who prefer it. |
| **Smoke test in CI** | 2-3 h | Day 10 CI runs typecheck + build only. A MySQL service container would let us run the full 76-assertion smoke on every PR. |
| **Wallet/card visual customization** | TBD | When the user is ready to design properly (see deferred above). |

---

## How to onboard a fresh Claude session

If a new Claude account opens this repo cold:

1. **Read [CLAUDE.md](./CLAUDE.md)** — stack, ports, conventions, secrets locations.
2. **Read this file (ROADMAP.md)** — full history + deferred + next steps.
3. **`git log --oneline --all`** — every day is a branch + a commit with a detailed message.
4. **Open the latest branch** (typically the most recent `day-N-*` branch).
5. **Read [DEPLOY.md](./DEPLOY.md)** if anything deploy-related is being asked.

That should be enough to get fully up to speed in 10 minutes. Memory files (`~/.claude/projects/.../memory/`) are bonus context but **not required** — everything load-bearing lives in the repo.
