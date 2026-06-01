# Stampdeck Roadmap

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

---

## Deferred — saved for later (with the why)

### Wallet production approval *(blocker on real customer launch)*
- Issuer `3388000000023150410` is still in Google's demo mode.
- Until approved, only Google accounts on the test users allowlist can save passes.
- **Gated on**: Stampdeck marketing site with a privacy policy + ToS URL + business logo.
- Process: submit at <https://pay.google.com/business/console/> → Google reviews in 1-2 business days.

### Resend sender domain verification *(blocker on real customer email)*
- Currently `EMAIL_FROM=Stampdeck <onboarding@resend.dev>` (Resend's onboarding domain).
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

## Likely next steps (Day 10+)

Pick whatever the user finds most valuable next. None are dependencies on each other.

| Idea | Effort | Value |
|---|---|---|
| **Expiry input on Program form** + audience filter summary in broadcast detail | 30 min | Closes the small gaps left from Day 9 |
| **Customer-facing card page** (`/c/[qrToken]`) | half day | Customer can see their stamp count without opening Wallet (e.g., when sharing on iMessage before they save the pass) |
| **Stripe billing** for the premium gate | 1-2 days | Turn fake unlock into real revenue |
| **Apple Wallet** (`pkpass`) | 2-3 days | Phase 2. Doubles the addressable market. |
| **Multi-program type support** (points, membership) | 1-2 days | Schema is already polymorphic — just need the business logic + UI. |
| **Backup automation** for VPS MySQL | half day | `mysqldump` cron, S3/Backblaze upload, retention. Important before going live. |
| **CI** (GitHub Action running `pnpm typecheck` + smoke on PRs) | 1-2 h | Cheap insurance. |
| **Owner magic-link email** (re-wire) | 1-2 h | Optional passwordless flow for owners who prefer it. |
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
