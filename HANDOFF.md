# OnUsClub — Handoff Notes (updated 2026-09-16)

**Purpose**: This document exists so any fresh Claude session — in Antigravity, VS Code, another Claude Code CLI, or a chat on claude.ai — can pick up this project cold in under 5 minutes. Nothing load-bearing lives in an ephemeral chat window; everything lives in this repo.

If you are a fresh Claude reading this: **also read `CLAUDE.md`, `ROADMAP.md`, `docs/card-design/README.md`, `PERKSTAR_ANALYSIS.md` in that order.** They are the canonical context.

---

## 🚨 READ THIS FIRST — the card-design work is NOT on GitHub yet

As of 2026-09-16 there is **one commit that exists only on Sanchit's Mac**:

```
80a9ac9  Card design system: stamp-grid art, per-program editor, Apple Wallet strip
```

It is committed, the working tree is clean, and it is **not pushed**. `git push` fails
because this machine has no GitHub credential: nothing in the macOS keychain for
github.com, no `~/.git-credentials`, no `GITHUB_TOKEN`/`GH_TOKEN`, no `gh` CLI, and both
`~/.ssh/id_ed25519` and `~/.ssh/id_rsa` are unencrypted but **rejected by GitHub**
(`Permission denied (publickey)`) — i.e. neither public key is registered on the account.

**Consequences, so nobody wastes an hour on this again:**
- `git pull` on the VPS correctly reports "Already up to date" — there genuinely is
  nothing new on the remote. Rebuilding containers changes nothing. This is not a
  Docker problem, a cache problem, or a build problem.
- A second laptop cloning from GitHub will **not** get this work.

### Fix (pick one, ~2 minutes)

**A — register the SSH key (preferred; lets Claude push in future sessions):**
```bash
cat ~/.ssh/id_ed25519.pub | pbcopy     # paste at github.com/settings/keys
git remote set-url origin git@github.com:sippzytech/onusclub.git
git push -u origin card-customization
```

**B — personal access token:** create at github.com/settings/tokens with `repo` scope,
then `git push -u origin card-customization` and paste the token as the password.
`credential.helper` is already `osxkeychain`, so it is stored once.

**C — no GitHub at all (offline transfer):** a bundle of this exact commit is at
`~/Desktop/onusclub-card-customization.bundle` (2.0 MB, verified). On the other machine:
```bash
git clone <existing onusclub clone or GitHub>          # get the base repo first
git bundle verify /path/to/onusclub-card-customization.bundle
git fetch /path/to/onusclub-card-customization.bundle card-customization:card-customization
git checkout card-customization
```
The bundle requires parent commit `f5265c7`, which is already on
`origin/day-14-points-programs` — so any normal clone can absorb it.

### After pushing — the branch mismatch that will bite next

`origin/HEAD` points at `day-1-skeleton`, which is **behind** and does not contain
Days 14/15. The real line of work is `day-14-points-programs` (`f5265c7`), and
`card-customization` is one commit on top of it. The VPS is almost certainly checked
out on `day-14-points-programs`, so a plain `git pull` there will still not bring the
new commit. On the VPS:

```bash
cd /docker/stampdeck
git branch --show-current          # confirm what it is actually on
git fetch origin
git checkout card-customization    # or merge origin/card-customization into its branch
git log --oneline -1               # MUST show 80a9ac9 before you rebuild
docker compose -f docker-compose.prod.yml up -d --build
```

**No migration needed for this commit** — the card design is stored inside
`loyalty_programs.config_json.design`, so there is no new DDL. (Migration `008` from
Day 15 is a separate question — see below.)

---

## Where the code lives (nothing can be lost)

| Location | Path | What it holds |
|---|---|---|
| Sanchit's Mac | `/Users/sanchit-easy/personal/onusclub` | Local clone — **holds the only copy of `80a9ac9`** |
| Desktop bundle | `~/Desktop/onusclub-card-customization.bundle` | Offline copy of that commit |
| GitHub | `github.com/sippzytech/onusclub` | Source of truth for everything up to `f5265c7` |
| Production VPS | `root@api.onusclub.com:/docker/stampdeck` | Deployed clone, currently serving prod |

**Note the mismatch**: local dir used to be `stampdeck` (legacy name) and some older notes
still say `/Users/sanchit/Projects/stampdeck` — **that path is stale**, the real one is
`/Users/sanchit-easy/personal/onusclub`. GitHub repo is `onusclub`, pnpm packages are
`@onusclub/*`. See `CLAUDE.md` for the full rename history; the un-renamed names (MySQL DB,
Docker volume, VPS deploy dir) are deliberate — renaming risks data loss for zero
user-visible benefit.

## Current git state

- **Branch**: `card-customization`, forked from `day-14-points-programs`
- **HEAD**: `80a9ac9` — clean tree, **unpushed** (see the top of this doc)
- **Remote heads**: `day-1-skeleton` (default, stale), `day-14-points-programs` (`f5265c7`,
  the real trunk), plus the older `day-*` branches

Run `git log --oneline -5` — this section goes stale faster than anything else here.

---

## What shipped in `80a9ac9` — the card design system

Replaces the plain `4/6` text on stamp cards with real stamp-card artwork, and lets
merchants design that card. Full spec in **`docs/card-design/README.md`**.

**The engine** — `packages/shared/src/card-art.ts` is the single source of truth for how a
card looks. Pure functions, zero dependencies, no DOM, so it runs identically in the
browser and in Node. That is deliberate: the customer web page, the Apple Wallet strip and
the dashboard editor preview all call the same renderer, so they cannot drift apart.

- 10 tintable icons (star, heart, cup, droplet, sparkle, paw, dumbbell, scissors, gift, flower)
- `balancedColumns()` picks a layout that fills its rows — 6→3×2, 8→4×2, 9→3×3, 10→5×2 —
  instead of the 5+1 hole a fixed 5-column grid produced
- `renderCardStrip()` lays badges out for the wallet's ~3:1 band; the web grid's box is
  ~1.4:1, so scaling the grid up was never going to work
- SVG element ids are namespaced by a stable hash, otherwise two grids on one page both
  paint the first one's motif

**Storage** — `CardDesign` lives in `loyalty_programs.config_json.design`. **No migration**,
per the polymorphic-config convention. `PATCH /v1/programs/:id/design` *merges* rather than
replaces, so a colour change cannot clobber `stamps_required` or `expiry_days`; the UPDATE
is filtered by `merchant_id`. Colours are validated with a hex regex at the API boundary
**and** sanitised at render, because the SVG is injected into a customer-facing page.

**Apple Wallet** — `strip.png` @1x/2x/3x embedded via `pass.addBuffer()`; pass colours come
from the design. `primaryFields` is deliberately left **empty** when a strip is present: a
`storeCard` renders its primary field *on top of* the strip, so leaving the reward there
printed "Free coffee" across the stamp badges. Reward moved to a secondary field. Strips
are cached in a bounded LRU (`apps/api/src/card-art/raster.ts`) because `buildPkPass` runs
on **every device pull** — 296 ms cold vs 0.017 ms warm.

**Dashboard** — `/dashboard/card-builder` now has a live editor per program (icon, colours,
badge style, tiled pattern + opacity, field labels) with a phone preview. `/dashboard/cards/[id]`
gained a "Customer view" preview plus a link to the customer card page.

### What was verified, and what was not

Verified locally: monorepo typecheck, full production build (`pnpm build`), smoke suite
(108 assertions), design round-trip (save → customer page), and a **real `.pkpass`
unpacked** to confirm strip dimensions (375×123 / 750×246 / 1125×369) and `pass.json`.

**Not verified — do this first on the other machine / on prod:**
- ❌ **Never rendered on a physical iPhone.** Apple signing certs are not present locally
  (`APPLE_TEAM_ID` and `APPLE_PASS_P12_PASSWORD` are empty in `apps/api/.env`, `secrets/`
  is empty); they only exist on the VPS. The local test used a throwaway self-signed cert,
  which proves bundle *structure* but not Apple acceptance.
- ⚠️ **`@resvg/resvg-js` is a new native dependency** and the API image is `node:20-alpine`
  (musl). `pnpm install` runs inside that image so the `linux-*-musl` prebuild should
  resolve, but if the api container crash-loops after deploy, look there first.
- ❌ Google Wallet still uses default styling — the hero image is not wired up. Low value
  while the issuer is in demo mode anyway.

### Known gaps / next candidates for this feature

1. **Google Wallet hero image** — public cache-busted URL + `heroImage` on the object patch.
2. **Merchant logo upload** — `merchants.brand_color` has no write path at all, and there is
   no logo upload. Note `ensureLoyaltyClass()` in `apps/api/src/wallet/loyalty.js` does a GET
   and returns early on 200 — **it never PATCHes**, so a brand-colour change would silently
   never reach Google Wallet. Needs an `updateLoyaltyClass()`.
3. **Template gallery** — decided: mirror Perkstar's full catalogue with *original*
   illustrated motifs, authored as single-colour tintable SVG tiles. 94 template names were
   extracted from the competitor capture; **T–Z is missing** because their gallery capture
   was truncated. See `docs/card-design/README.md` §3–4.
4. The `"icon-tile"` pattern is a **placeholder** tiling the stamp icon, holding the slot
   until the commissioned motifs land.

---

## What is live on prod right now

- `https://api.onusclub.com` — Node/Express API
- `https://app.onusclub.com` — Next.js dashboard + customer-facing pages
- Both routed via existing Traefik on the VPS (`n8n_default` network, cert resolver `mytlschallenge`)
- MySQL 8 on the internal Docker network (`onusclub-mysql` container, DB name `stampdeck` — not renamed)
- ⚠️ **Deployed state is UNVERIFIED as of 2026-09-16.** The last session tried to deploy the
  card-design work, but the commit was never pushed (see the top of this doc), so whatever
  is running is whatever was there before. Do not trust the next two lines without checking.
- Migrations `001`–`007` were applied. `008_card_event_amount.sql` (Day 15) may or may not
  have run — **verify before assuming**.
- Verify all of it in one go:
  ```bash
  ssh root@api.onusclub.com
  cd /docker/stampdeck && git branch --show-current && git log --oneline -1
  docker compose -f docker-compose.prod.yml exec api node dist/db/migrate.js   # idempotent; applies anything outstanding
  ```

## What is on-hold / gated externally

- **Google Wallet production approval** — issuer still in demo mode, but **both prior blockers are cleared as of 2026-08-23**: friend delivered the KvK-registered NL entity details, and the marketing site is live at `https://onusclub.com` with `/privacy` and `/terms` (verified 200 OK). What's left is purely Sanchit-driven: log into <https://pay.google.com/business/console/>, fill the Business Info form with the KvK entity + policy URLs + logo, submit. Google review is 1-2 business days. No code change needed after approval. Apple Wallet is unaffected and already live. See `ROADMAP.md` "Wallet production approval" for the step-by-step.
- **Resend sender domain** — currently `onboarding@resend.dev`. Verified subdomain `send.onusclub.com` at some point but not sure if `EMAIL_FROM` env was flipped on VPS. Worth verifying if we get to email work.
- **Backblaze B2 offsite backup** — code shipped Day 13, needs 10 min of user-side sign-up + 3 env lines on VPS. See `DEPLOY.md §9`.

---

## What we're doing next

**Immediate, in order:**

1. **Push `80a9ac9`** — see the top of this doc. Nothing else can proceed until this lands.
2. **Get it onto the VPS** and confirm `git log --oneline -1` shows `80a9ac9` *before* rebuilding.
3. **Test the Apple Wallet pass on a real iPhone** — the one thing that could not be tested
   locally. Card builder → design → Save → customer card page → Add to Apple Wallet → stamp
   the card from the dashboard and watch the pass repaint.
4. Then pick from "Known gaps" above — merchant logo upload is the highest value, because it
   also fixes the `ensureLoyaltyClass()` never-PATCHes bug.

**Still open from the 2026-08-23 plan (B below is untouched and still valid):**

### B — Submit Google Wallet issuer for production approval (Sanchit's keyboard, ~half day)

This is form-filling on <https://pay.google.com/business/console/> for existing issuer `3388000000023150410`. **Not something Claude does — Sanchit has to log in personally.** Claude in Antigravity should walk Sanchit through it if asked, but should not attempt to automate.

**Which Google account to log in with**: almost certainly **`sippzy.official@gmail.com`** — that's the identity the whole `sippzy` GCP project + service account + Resend account was built under, and it's the sole test-user on the current demo allowlist. To verify before filling anything: open the console in an incognito window, sign in with `sippzy.official@gmail.com`, and check that issuer `3388000000023150410` is visible. If not, wrong account.

**Field-by-field checklist for the Business Info form:**

| Field | What to enter |
|---|---|
| Legal business name | Friend's KvK-registered legal name (Sanchit has this from friend) |
| KvK number | From friend |
| Registered address | From friend |
| Business contact email | From friend, OR a monitored OnUsClub inbox |
| VAT / BTW number | From friend, if applicable |
| Business website | `https://onusclub.com` |
| Privacy policy URL | `https://onusclub.com/privacy` (verified 200 OK on 2026-08-23) |
| Terms of Service URL | `https://onusclub.com/terms` (verified 200 OK on 2026-08-23) |
| Business logo | From marketing site — square, PNG, typically ≥660x660 |
| Program category | Loyalty program |
| Program description | "Digital loyalty stamp & points cards for cafés, salons, and SMBs in the Netherlands" |
| Countries served | Netherlands (add EU later if desired) |

**Sanity checks before hitting submit:**
- Log into `pay.google.com/business/console/` and check that the LoyaltyClass created for the first real merchant looks sane — proper name/description, real logo (not `placehold.co`). If placeholder logos are still in play from `apps/api/src/wallet/…`, either update to a real logo or wait until we ship per-merchant logo upload.
- After submit, review typically arrives via email in 1-2 business days.
- Once approved: **no code change** — the LoyaltyClass + LoyaltyObject + save-to-Wallet JWT already work end-to-end; the issuer just flips from "demo (allowlisted testers only)" to "any Google account."

### A — Day 15: Revenue capture + dashboard come-alive ✅ **DONE (2026-08-23)**

Built, tested, committed on `day-14-points-programs`. **Not deployed to prod yet.**

Full detail in the Day 15 entry of `ROADMAP.md`. The short version:

- Migration `008_card_event_amount.sql` — `card_events.amount_cents` + `merchants.currency_code`, and it backfills existing points transactions so revenue is right on first render.
- Optional sale amount on the manual buttons and on `POST /v1/scan`; a new `PATCH /v1/cards/:id/events/:eventId/amount` for the scanner.
- New `GET /v1/analytics/overview`; the Overview page grew a money KPI row and a real `card_events`-backed activity feed.
- Smoke 95 → 108 assertions, all passing against the local dev stack.

**Two corrections to what this doc previously claimed**, for anyone comparing:
- The scan flow for **points** cards was already built before Day 15 (`needs_amount` in `ScanResult`), despite ROADMAP listing it as a 2-3h todo. Day 15 only had to extend capture to *stamp* cards.
- The operations functions are named `stampCardById` / `redeemCardById`, not `addStampToCard` / `redeemStampCard`.

**Design decision worth knowing**: on the scanner, the amount is captured *after* the stamp applies, not before. A stamp has to land the instant the QR is read because the once-per-day rule can reject it — making staff type an amount only to then be told "already stamped today" is the worse ordering. The manual buttons capture up front, since that click is deliberate.

### To deploy Day 15

Standard `DEPLOY.md` flow, plus the migration:

```bash
ssh root@api.onusclub.com
cd /docker/stampdeck
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api node dist/db/migrate.js   # applies 008
```

Note the migration command runs the **compiled** `dist/db/migrate.js` via `exec` on the
running container — not `pnpm db:migrate`, which only exists in the dev image.

Migration `008` is additive (two nullable/defaulted columns + a backfill UPDATE) so it is safe to run against live data with no downtime window.

### Sequencing note

A and B are independent. If Google approval lands while other work is in flight, react to it separately — approval needs no code change, rejection means another round of the form.

---

## Bootstrapping a fresh Claude session (any tool, any machine)

### Step 1: Get the code

**On this Mac** the repo is already at `/Users/sanchit-easy/personal/onusclub` — do NOT
re-clone, it holds the only copy of `80a9ac9`.

**On a second laptop**, once `80a9ac9` is pushed:
```bash
git clone https://github.com/sippzytech/onusclub.git onusclub
cd onusclub
git checkout card-customization
git log --oneline -1          # must show 80a9ac9
```
If it has NOT been pushed yet, use the bundle — see "READ THIS FIRST" at the top.

### Step 2: Get it running locally

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
mkdir -p secrets
pnpm install
docker compose -f docker-compose.dev.yml up -d mysql
pnpm db:migrate
pnpm dev                      # api :4000, web :3001
```

Local ports: api `4000`, web `3001`. Never publish `3000` — the VPS uses it for Metabase.

**Gotcha from the last session**: `apps/api/.env` on the old Mac pointed MySQL at port
**3307**, not the 3306 in `docker-compose.dev.yml`. If the api cannot reach the DB, check
`DATABASE_URL` against the port the container actually publishes.

Apple Wallet will 503 locally — `APPLE_TEAM_ID` / `APPLE_PASS_P12_PASSWORD` are empty and
`secrets/` is empty. That is expected; the certs live on the VPS.

### Step 3: Paste this prompt into the fresh Claude session

---

> I'm resuming **OnUsClub** — a multi-tenant SaaS for digital loyalty cards (Google Wallet
> + Apple Wallet, Netherlands-first, competing with Perkstar UK and Tap2 NL). I'm
> continuing on a different machine from the last session.
>
> Read these before answering anything:
>
> 1. `CLAUDE.md` — stack, ports, conventions, secrets locations
> 2. `HANDOFF.md` — **start with the "READ THIS FIRST" section at the top**
> 3. `docs/card-design/README.md` — the card design system spec (most recent work)
> 4. `ROADMAP.md` — day-by-day history and candidate next steps
> 5. `PERKSTAR_ANALYSIS.md` — the competitor tear-down behind the plan
>
> Then tell me:
> - Whether commit `80a9ac9` is on the remote yet, and if not, what my options are
> - What the card design system does, and specifically what was **never verified**
> - What you would do first
>
> Context on where I left off: the card design system is built and committed — a shared
> SVG renderer in `packages/shared/src/card-art.ts` feeding the customer card page, a
> per-program design editor in `/dashboard/card-builder`, and Apple Wallet `strip.png`
> artwork. It passes typecheck, production build and the 108-assertion smoke suite. It has
> **never been rendered on a real iPhone** and was **never pushed to GitHub** because that
> Mac had no working GitHub credential.
>
> Don't start coding until I confirm what I want.

---

### Step 4: Memory entries the new session will not have

If the new session has a memory store, it starts empty. The load-bearing entries from the
old machine lived at `~/.claude/projects/-Users-sanchit-easy-personal-onusclub/memory/`:

- **Never use `sanchit.shinde@easyhomefinance.in` in test data** — it is the work email.
  Use personal gmails.
- **macOS smart quotes break `.env` on remote hosts** — pasting substitutes curly quotes.
  After editing `.env` on the VPS: `grep -P '[^\x00-\x7F]' .env` to catch them.

---

## Restart the laptop safely — checklist

Before you close the terminal / restart:

- [ ] `git status` shows clean tree (true as of 2026-09-16)
- [ ] ⚠️ **`git log` shows HEAD is pushed — CURRENTLY FALSE.** `80a9ac9` exists only on this
      Mac plus `~/Desktop/onusclub-card-customization.bundle`. Push it, or keep the bundle
      somewhere safe, before wiping or losing this laptop.
- [ ] Any local uncommitted `.env` files backed up somewhere (they're in `.gitignore` so `git status` won't warn you). If you have wallet certs/keys locally, ensure they're in your password manager or `~/Documents/keys/` too.
- [ ] SSH agent has your VPS key loaded (`ssh-add -l` — if empty, `ssh-add ~/.ssh/id_ed25519` or whichever)

You are safe to close and restart. Prod continues running regardless of your laptop state.

---

## Files you should never delete

| File | Why |
|---|---|
| `CLAUDE.md` | Onboards fresh Claude sessions in one read |
| `ROADMAP.md` | Canonical plan, day-by-day history |
| `HANDOFF.md` | This file — the "resume here" bridge |
| `PERKSTAR_ANALYSIS.md` | The reasoning behind Day 15+ |
| `DEPLOY.md` | Prod deploy runbook |
| `FEATURES.md` | User-facing feature catalogue |
| `METABASE.md` | Analytics setup |
| `.env.example` files | Show what env is needed |
| `apps/api/src/db/migrations/*.sql` | The DB is polymorphic on top of these — deleting = catastrophic |
