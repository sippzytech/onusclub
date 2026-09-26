# OnUsClub — Handoff Notes (updated 2026-09-25)

**Purpose**: This document exists so any fresh Claude session — in Antigravity, VS Code, another Claude Code CLI, or a chat on claude.ai — can pick up this project cold in under 5 minutes. Nothing load-bearing lives in an ephemeral chat window; everything lives in this repo.

If you are a fresh Claude reading this: **also read `CLAUDE.md`, `ROADMAP.md`, `docs/card-design/README.md`, `PERKSTAR_ANALYSIS.md` in that order.** They are the canonical context.

---

## READ THIS FIRST — Day 16 is shipped, pushed, deployed and verified

**Everything the previous version of this file warned about is resolved.** The card
design work is on GitHub, running in production, and confirmed working on a real iPhone
as of 2026-09-18. If you are reading an older copy of this section claiming `80a9ac9` is
unpushed, that copy is stale.

Current state:

| Thing | State |
|---|---|
| Trunk | **`main`** — created 2026-09-25 from `card-customization`, now the only branch that matters |
| HEAD | `8bdc4bf` — pushed to `origin` |
| VPS | deploys from `main` |
| Migrations | `001`–`008` all applied (`migrate.js` reports `applied:0, total:8`) |
| Apple Wallet | strip artwork verified in prod **and on a physical iPhone** |

**`main` is the trunk as of 2026-09-25.** Before that the repo had no trunk at all — 16
unmerged `day-*` branches and `origin/HEAD` pointing at `day-1-skeleton`, which predates
auth. Every one of those branches was verified to be fully contained in
`card-customization` before `main` was cut, so nothing was lost. Work from `main`.

Confirm any of it in one line: `git ls-remote --heads origin main`.

### What production verification actually covered

Run from a laptop against live, no SSH needed — the Apple pass endpoint is public
because the `qr_token` *is* the credential:

```bash
curl -sS -o /tmp/t.pkpass -w 'http %{http_code}  bytes %{size_download}\n' \
  "https://api.onusclub.com/v1/public/c/<QR_TOKEN>/apple-pass"
unzip -l /tmp/t.pkpass
```

A **stamp** card returns ~141 KB with `strip.png` / `strip@2x.png` / `strip@3x.png` at
375×123 / 750×246 / 1125×369, all three in `manifest.json`, and `primaryFields` empty.
A **points** card returns ~7.8 KB with no strip and the reward in `primaryFields` —
that is correct, not a bug: strips are gated to `programType === "stamp"` with
`total <= 30` in `wallet-apple/pass-builder.ts`. Testing with a points card proves
nothing about the design system; pick a stamp card.

Get tokens on the VPS with:

```bash
docker exec -e MYSQL_PWD="$(grep '^MYSQL_PASSWORD=' .env | cut -d= -f2-)" onusclub-mysql \
  mysql -ustampdeck stampdeck -N -B -e "SELECT qr_token FROM loyalty_cards LIMIT 3"
```

### The musl trap, documented so nobody re-learns it

`@resvg/resvg-js` is a native dependency and the api image is `node:20-alpine` (musl).
It **is** confirmed working there — but note that both call sites reach it through a
*dynamic* import:

```
routes/public.ts        const { buildPkPass } = await import("../wallet-apple/pass-builder.js");
routes/apple-wallet.ts  const { buildPkPass } = await import("../wallet-apple/pass-builder.js");
```

So a clean api startup log proves **nothing** about resvg — the binary isn't touched
until the first pass is built. `grep resvg` over the logs coming back empty is an
absence of evidence. To check it directly in ~10 seconds:

```bash
cd /docker/stampdeck
cat > /tmp/resvg-check.mjs <<'EOF'
import { Resvg } from "@resvg/resvg-js";
const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12'><rect width='12' height='12' fill='red'/></svg>";
console.log("resvg OK — png bytes:", new Resvg(svg).render().asPng().length);
EOF
docker compose -f docker-compose.prod.yml cp /tmp/resvg-check.mjs api:/repo/apps/api/resvg-check.mjs
docker compose -f docker-compose.prod.yml exec api node resvg-check.mjs
docker compose -f docker-compose.prod.yml exec api rm -f resvg-check.mjs
```

Expect `resvg OK — png bytes: 79`. `ERR_DLOPEN_FAILED` means the musl prebuild didn't
resolve — the lockfile does carry `@resvg/resvg-js-linux-x64-musl` and
`-linux-arm64-musl`, so check that `pnpm install --frozen-lockfile` actually succeeded
in the `deps` stage rather than falling through to the `|| pnpm install` branch.

### Deploying to the VPS

The VPS deploys from `main`:

```bash
cd /docker/stampdeck
git fetch origin
git checkout main                  # only needed once, if it is on an old branch
git pull
git log --oneline -1               # confirm the SHA you expect BEFORE you rebuild
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api node dist/db/migrate.js   # idempotent
./scripts/verify-deploy.sh
```

Checking the SHA before rebuilding is not ceremony — building the wrong commit and
concluding the feature is broken has already cost one session.

### Gotcha: local dev used to write to the PRODUCTION Wallet issuer

There is only one Google Wallet issuer — `3388000000023150410` — and it is the
production one. `apps/api/.env.example` used to seed it as the *dev* default, so every
local `pnpm smoke` run created real LoyaltyClasses on the live issuer. That is how ~40
classes named `Smoke Café <timestamp>` and `Pw Café <timestamp>` ended up there.

**They cannot be removed.** The Google Wallet API has no delete operation for classes —
`insert`, `get`, `patch`, `update`, `list`, `addmessage`, and that is the whole list. The
junk is permanent on that issuer, and a reviewer assessing it for production sees it.

Fixed 2026-09-27: `apps/api/.env.example` now defaults to `GOOGLE_WALLET_ISSUER_ID=0` and
a nonexistent key path, mirroring what CI already did. The api reports "wallet not
configured", every Google Wallet path degrades gracefully, and the smoke suite passes
unchanged. Apple Wallet is unaffected and is the wallet worth testing locally anyway.

**Before running anything that creates merchants, check what your env is pointed at:**

```bash
grep -E '^GOOGLE_WALLET' apps/api/.env      # want ISSUER_ID=0 for day-to-day work
```

Only set the real issuer when you are deliberately testing Google Wallet, and set it back
afterwards. Anything you create while it is pointed at production is there forever.

### Gotcha: `.env` and shell scripts

`EMAIL_FROM`'s display-name form contains `<` and `>`. **Unquoted, it breaks
`set -a; . ./.env`** with ``syntax error near unexpected token `newline` `` and silently
leaves every variable *below that line* unset. Docker Compose uses its own parser and is
unaffected, so the damage is invisible until a shell script — `verify-deploy.sh` — reads
it. `.env.example` now ships it quoted; check the VPS `.env` matches:

```bash
cd /docker/stampdeck
( set -a; . ./.env; set +a; echo "sourced OK -> $EMAIL_FROM" )
grep -P '[^\x00-\x7F]' .env && echo "^^ smart quotes" || echo "ASCII clean"
```

(The `grep -P` is the macOS-curly-quote check — pasting into a remote editor from a Mac
substitutes `"` for `"`, which breaks env parsing in a way that is very hard to see.)

---

## Where the code lives (nothing can be lost)

| Location | Path | What it holds |
|---|---|---|
| GitHub | `github.com/sippzytech/onusclub` | **Source of truth.** `main` is the trunk |
| Mac #1 | `/Users/sanchit-easy/personal/onusclub` | Clone the card-design work was authored on |
| Mac #2 | `/Users/sanchit/Projects/stampdeck` | Second laptop, up to date on `main` |
| Production VPS | `root@api.onusclub.com:/docker/stampdeck` | Deployed clone, serving prod |

**Both local paths are real** — there are two laptops. An older version of this file
declared `/Users/sanchit/Projects/stampdeck` "stale"; it isn't, it is Mac #2's clone. The
directory name difference is only the legacy `stampdeck` name. GitHub repo is `onusclub`,
pnpm packages are `@onusclub/*`. See `CLAUDE.md` for the rename history; the un-renamed
names (MySQL DB, Docker volume, VPS deploy dir) are deliberate — renaming risks data loss
for zero user-visible benefit.

Since everything is pushed, **GitHub is now the sync point** — no bundles, no
laptop-specific copies of anything. The old
`~/Desktop/onusclub-card-customization.bundle` on Mac #1 is obsolete and can be deleted.

## Current git state

- **Trunk**: `main` — branch from it, merge back into it, deploy it
- **HEAD**: `8bdc4bf` — pushed, and what the VPS runs
- **Legacy branches**: the `day-*` series and `phase-b-rename` are historical snapshots,
  every one of them an ancestor of `main`. They hold nothing unique. `card-customization`
  is the immediate parent of `main` and is equally redundant.

Run `git log --oneline -5` — this section goes stale faster than anything else here.

### SSH access is per-machine

Mac #2 can reach GitHub over SSH but its keys are **not** on the VPS — `id_rsa` and
`id_ed25519` are both offered and both rejected, so `ssh root@api.onusclub.com` falls
back to asking for a password. To fix it for a given laptop:

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub root@api.onusclub.com
```

If SSH refuses with `Host key verification failed`, that machine has simply never
connected. The box's ED25519 fingerprint is
`SHA256:qTOHwGb8Nk1Yb92Vc5c38fPb6SuezmZSbQFKM+vuGok` — verify against that rather than
blindly accepting, and note it is the *same* key the retired `api.sippzy.com` entry
used, since it is the same machine.

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

**Verified in production on 2026-09-18:**
- ✅ **Renders on a physical iPhone.** The pass installs and displays correctly.
- ✅ **`@resvg/resvg-js` works on musl** inside the `node:20-alpine` api container.
- ✅ Live stamp pass carries all three strips at spec dimensions, hashed in the manifest,
  with `primaryFields` empty. Points passes correctly carry no strip.

**Still not verified:**
- ❌ **Nobody has saved a custom design on production yet.** Every prod card is rendering
  `DEFAULT_CARD_DESIGN` (plus `merchants.brand_color`). The editor round-trip is proven
  locally but not against the live database — so a `PATCH /v1/programs/:id/design`
  followed by re-downloading the pass is still worth doing once.
- ❌ Google Wallet still uses default styling — the hero image is not wired up. Low value
  while the issuer is in demo mode anyway.

### Bug found during that verification, and fixed

The strip and the pass body resolved their background colour through **two different
fallback chains**. `buildStripSet` merges `DEFAULT_CARD_DESIGN` internally, while
`passBg` jumped straight from an absent design to `merchant.brandColor`. With no saved
design — which is every card today — that produced a `#14271C` dark green strip sitting
on a `#000000` black pass. A visible seam, and exactly the drift the shared renderer
exists to prevent.

`pass-builder.ts` now resolves the design **once** and paints both surfaces from it,
using the same precedence the customer page already documented:

```ts
// defaults < merchant brand colour < the design saved in the card builder
const design: CardDesign = {
  ...DEFAULT_CARD_DESIGN,
  ...(merchant.brandColor ? { backgroundColor: merchant.brandColor } : {}),
  ...(program.design ?? {}),
};
```

If you add a third surface that paints card colours, merge from that same shape. Do not
reintroduce a parallel `?? ?? ??` chain — that is precisely how this broke.

### Known gaps / next candidates for this feature

1. **Google Wallet hero image** — public cache-busted URL + `heroImage` on the object patch.
2. **Merchant logo upload** — `merchants.brand_color` has no write path at all, and there is
   no logo upload. Note `ensureLoyaltyClass()` in `apps/api/src/wallet/loyalty.ts` does a GET
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
- ✅ **Deployed state verified 2026-09-18**: VPS deploying `main`,
  `verify-deploy.sh` 13/13, migrations `001`–`008` **all applied**
  (`migrate.js` → `applied:0, total:8`).
- ⚠️ The legacy `api.sippzy.com` / `app.sippzy.com` routers are still configured but their
  **DNS records are gone**, so they resolve to nothing. Apple passes issued before the
  Day 13 cutover point their `webServiceURL` there and have silently stopped updating.
  See the Status section of `CLAUDE.md`.
- Re-verify any time, from a laptop, no SSH needed:
  ```bash
  ./scripts/verify-deploy.sh                      # HTTP checks
  PROD_EMAIL=… PROD_PASSWORD=… ./scripts/verify-deploy.sh   # + logged-in checks
  ```
  Run it **on the VPS** and it additionally diffs every migration file against the
  `_migrations` table. It is strictly read-only — unlike `pnpm smoke`, which creates
  merchants and cards and must never be pointed at prod.

## What is on-hold / gated externally

- **Google Wallet production approval** — issuer still in demo mode, but **both prior blockers are cleared as of 2026-08-23**: friend delivered the KvK-registered NL entity details, and the marketing site is live at `https://onusclub.com` with `/privacy` and `/terms` (verified 200 OK). What's left is purely Sanchit-driven: log into <https://pay.google.com/business/console/>, fill the Business Info form with the KvK entity + policy URLs + logo, submit. Google review is 1-2 business days. No code change needed after approval. Apple Wallet is unaffected and already live. See `ROADMAP.md` "Wallet production approval" for the step-by-step.
- **Resend sender domain** — **resolved**: the VPS `.env` has
  `EMAIL_FROM="OnUsClub <noreply@send.onusclub.com>"`, a verified custom subdomain, so the
  old `onboarding@resend.dev` test-mode restriction no longer applies. Delivery to an
  arbitrary third-party address has not been *observed* though — watch one land before
  treating customer email as proven. (It read `Stampdeck <…>` until 2026-09-18; the old
  brand name was showing in the From header of every customer email.)
- **Backblaze B2 offsite backup** — code shipped Day 13, needs 10 min of user-side sign-up + 3 env lines on VPS. See `DEPLOY.md §9`.

---

## What we're doing next

**Steps 1–3 of the previous plan (push → deploy → iPhone test) are all DONE as of
2026-09-18.** What remains:

1. **Save a real design in `/dashboard/card-builder` on prod** and re-download the pass.
   The only card-design path never exercised against the live database.
2. **Merchant logo upload** — highest value of the known gaps, because it also forces
   fixing the `ensureLoyaltyClass()` never-PATCHes bug *and* gives
   `merchants.brand_color` its first write path (it currently has none, anywhere).
3. **Decide the `sippzy.com` legacy question** — restore DNS or drop the dead routers.
4. **Google Wallet production approval** (section B below) — still pure form-filling,
   still needs Sanchit personally.

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

Everything is on GitHub, so any machine can just clone:

```bash
git clone git@github.com:sippzytech/onusclub.git onusclub
cd onusclub
git checkout main
git log --oneline -1          # should show 8bdc4bf or later
```

On an **existing clone that has been sitting idle**, it will be on whichever `day-*` or
feature branch it was left on, and `main` may not exist locally yet — so fetch and check
out rather than pulling:

```bash
git fetch origin
git checkout main
git pull
pnpm install                                   # Day 16 added @resvg/resvg-js
pnpm --filter @onusclub/shared run build
pnpm -r run typecheck
```

`.env`, `apps/api/.env` and `apps/web/.env` are gitignored and will **not** arrive from
GitHub. Day 16 added no new env vars, so an older machine's existing files still work;
a fresh clone copies them from the `.env.example` files.

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
> - Whether this machine is up to date with `origin/main`, and whether
>   what is running on the VPS matches it
> - What the card design system does, and specifically what is **still unverified**
> - What you would do first
>
> Context on where I left off: the card design system (Day 16) is shipped — a shared SVG
> renderer in `packages/shared/src/card-art.ts` feeding the customer card page, a
> per-program design editor in `/dashboard/card-builder`, and Apple Wallet `strip.png`
> artwork. It is pushed, deployed, and verified on a physical iPhone. The open thread is
> that **no merchant has saved a custom design on production yet**, so the editor
> round-trip is proven only locally.
>
> Don't start coding, and don't deploy, until I confirm what I want.

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

- [ ] `git status` shows a clean tree
- [ ] `git log --oneline -1` matches `git ls-remote --heads origin main` —
      i.e. HEAD is actually pushed. Nothing load-bearing should live only on a laptop;
      that is what cost the 2026-09-16 session an hour.
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
