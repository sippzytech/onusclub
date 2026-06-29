# OnUsClub — Handoff Notes (office laptop, 2026-06-29)

Picking up from the personal Mac to the office laptop today. The plan is to work **directly on the VPS** (no local dev stack needed for what's queued).

---

## What changed since the last handoff

- **Day 14 (points programs) is shipped and live on prod.** No longer "feature branch only."
- **UI redesign Phase 1-8 is committed** on `day-14-points-programs` (commits `5e3b282`, `1a329c0`). Brand colors, Fraunces/Lato fonts, dark sidebar shell, branded customer-facing pages — across every page in the app.
- **Perkstar tear-down complete.** See [PERKSTAR_ANALYSIS.md](./PERKSTAR_ANALYSIS.md) for the full feature inventory + COPY/DEFER/SKIP classification.
- **ROADMAP.md updated** with proposed Day 15 (revenue capture + dashboard come-alive) + the priority order for Days 16-19.

## Where we stand right now

- **Latest branch (where this work is)**: `day-14-points-programs` (HEAD = the redesign commit)
- **Working tree**: clean as of this commit
- **Pushed to GitHub**: yes — `github.com/sippzytech/onusclub`
- **Production VPS**: still on `phase-b-rename` branch (Day 14 + redesign not yet deployed live). Code is on GitHub, just not pulled on the box.
- **Today's office goal**: deploy Day 14 + UI redesign to prod **OR** start Day 15 (revenue capture). Either works.

## Days shipped (newest first)

| Day | What | Live on prod? |
|---|---|---|
| UI Redesign | Brand color palette + Fraunces/Lato + dark sidebar + branded auth/landing/cards | ❌ Not deployed |
| 14 | Points programs (+ per-batch expiry, FIFO redemption, points-expiry cron) | ❌ Not deployed |
| 13 | Phase B rename + DNS cutover to onusclub.com + smoke in CI + B2 backup code | ✅ Deployed |
| 12 | Apple Wallet live updates via APNs push | ✅ Deployed |
| 11 | Apple Wallet end-to-end + OnUsClub branding (Phase A) | ✅ Deployed |

Full history in [ROADMAP.md](./ROADMAP.md). Day-by-day commits visible with `git log --oneline --all`.

---

## Today's options (pick one)

### Option A — Deploy Day 14 + UI redesign to prod (lowest risk, ~20 min)

The redesign + points programs have been sitting on a feature branch. Get them live.

```bash
ssh root@api.onusclub.com
cd /docker/stampdeck

git fetch origin
git checkout day-14-points-programs
git pull origin day-14-points-programs

# Rebuild api + web (mysql untouched)
docker compose -f docker-compose.prod.yml up -d --build api web

# Apply migration 007 (points batches table)
docker compose -f docker-compose.prod.yml exec api node dist/db/migrate.js
# expect: "applying migration 007_points_batches.sql"

# Verify
curl -sf https://api.onusclub.com/health
curl -sI https://app.onusclub.com
```

Then visit `https://app.onusclub.com` from a browser, log in, sanity-check:
- Dashboard renders with new dark green sidebar
- Fraunces serif headings render (not falling back to system serif)
- Create a points program in the dashboard, enrol a customer, add a transaction
- Open the public `/m/<slug>` enrol page and confirm brand styling

### Option B — Start Day 15 (revenue capture) directly on VPS

This is the Perkstar-inspired bundle. See [PERKSTAR_ANALYSIS.md](./PERKSTAR_ANALYSIS.md) for the full reasoning.

**Scope** (~1.5-2 days):
1. New migration `008_card_event_amount.sql` — `ALTER TABLE card_events ADD COLUMN amount_cents BIGINT NULL;`
2. Update `card_events` insert paths to accept optional `amountCents`:
   - `apps/api/src/cards/operations.ts` — `addStampToCard`, `redeemStampCard`, `addPointsToCard`, `redeemPointsCard`
   - `apps/api/src/routes/scan.ts` — accept `amountCents` in body
3. Scanner state machine (`apps/web/src/app/dashboard/scan/scan-client.tsx`) — add a skippable "Sale amount (€)" prompt step between scan + commit
4. Manual stamp/redeem buttons on `/dashboard/cards/[id]` — small amount input next to the buttons
5. Overview page (`apps/web/src/app/dashboard/page.tsx`):
   - Sum `amount_cents` last 7d → "Revenue (last 7 days)" KPI
   - Sum / count → "AOV" KPI
   - Last 10 card_events → recent activity feed
6. Smoke test additions — 5-6 assertions covering amount capture + aggregates
7. Currency: add `merchants.currency_code` (default `'EUR'`) on a same migration

**Recommended approach for VPS-only work:**
- Edit on the VPS via `ssh` + `vim` / `nano`, or use VS Code Remote-SSH
- Run the smoke test in the dev compose on the VPS before deploying to prod:
  ```bash
  cd /docker/stampdeck
  git checkout -b day-15-revenue-capture
  # make edits
  docker compose -f docker-compose.dev.yml up -d
  docker compose -f docker-compose.dev.yml exec api pnpm --filter @onusclub/api run smoke
  ```
- Don't deploy until smoke is green.

### Option C — Other small wins from the polish backlog

If you want a quick win instead of either of the above:
- **Backblaze B2 backup setup** — 10 min. Sign up at backblaze.com, create a bucket, get an application key, paste 3 lines into VPS `.env`, install `b2` CLI. Full runbook in `DEPLOY.md §9`. Code shipped on Day 13.
- **Bump GitHub Actions to v5** — 15 min. Edit `.github/workflows/ci.yml`, replace `actions/checkout@v4` etc. with `@v5`. Kills the deprecation warning.

---

## What you need on the office laptop

If you're working directly on the VPS via SSH, you need almost nothing locally:
- SSH client (built-in on macOS/Linux, OpenSSH on Windows)
- The VPS SSH key (in your password manager — pull it down)
- A terminal

If you want VS Code Remote-SSH (recommended for the Day 15 option):
- VS Code installed
- Remote-SSH extension installed
- SSH config entry for `api.onusclub.com` with the right key

If you want to clone the repo locally too (for diffs / git tooling):
```bash
git clone https://github.com/sippzytech/onusclub.git
cd onusclub
git checkout day-14-points-programs
```
Use a Personal Access Token if HTTPS auth asks for a password.

---

## Secrets you do NOT need today

The following live only on Sanchit's personal Mac + password manager. **You don't need them for any of today's options:**
- Apple Wallet `.p12` certs (already deployed on VPS; only needed to test pass downloads from a fresh local environment)
- Google Wallet service-account JSON (already deployed on VPS)
- Resend API key (already in VPS `.env`)
- APNs cert PEM files (already on VPS)

The VPS already has all these mounted. If you're working only on the VPS, everything just works.

---

## Items still in the TODO list (unchanged)

1. **Day 15: revenue capture** — Perkstar-inspired, see PERKSTAR_ANALYSIS.md
2. **Day 16-19**: CSV import → RFM → templates → digest email (see ROADMAP.md)
3. **Stripe billing** — user flagged as "last part" of feature work. Pairs with Day 14's tier-system feature.
4. **Google Wallet production approval** — paperwork: marketing site + privacy/ToS + 660×660 logo + business contact email. Friend shipping the marketing site. ~10 min user-side once friend is done, then 1-3 days Google review.
5. **Backblaze B2 offsite backup** — code shipped Day 13, needs 10 min of user-side setup.

Smaller items (no rush):
- Drop sippzy.com legacy Traefik routes (after 1-2 weeks of onusclub.com stability)
- Day 14 scan-flow for points (will fall out of Day 15 naturally — same amount field)
- Bump GitHub Actions to v5
- Owner magic-link email re-wire

See [ROADMAP.md](./ROADMAP.md) for the full prioritized list.

---

## Continuity tips for the office laptop session

- **All context lives in the repo** — CLAUDE.md, ROADMAP.md, PERKSTAR_ANALYSIS.md, DEPLOY.md, FEATURES.md, this HANDOFF.md. You can drop into Claude Code from a fresh checkout with zero memory and be fully up to speed.
- **Don't commit secrets to the repo.** The office laptop probably doesn't have your `.env` files anyway, so this is mostly a non-issue.
- **If you spin up local dev on the office laptop**, leave Apple/Google Wallet env vars empty — they degrade to 503 gracefully and don't block points / scan / dashboard work.
- **VPS `.env` editing**: be careful with smart-quotes when pasting on macOS. There's a saved memory note about this. After editing on the VPS, run `grep -P '[^\x00-\x7F]' .env` to catch any curly quotes that snuck in.
