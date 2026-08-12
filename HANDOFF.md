# OnUsClub — Handoff Notes (2026-08-12)

**Purpose**: This document exists so any fresh Claude session — in Antigravity, VS Code, another Claude Code CLI, or a chat on claude.ai — can pick up this project cold in under 5 minutes. Nothing load-bearing lives in an ephemeral chat window; everything lives in this repo.

If you are a fresh Claude reading this: **also read `CLAUDE.md`, `ROADMAP.md`, `PERKSTAR_ANALYSIS.md` in that order.** They are the canonical context.

---

## The last chat had this exact context (for continuity)

The prior Claude Code CLI session on Sanchit's Mac walked through Perkstar's dashboard, wrote `PERKSTAR_ANALYSIS.md`, and updated `ROADMAP.md` with the Day 15+ candidates. Then, deploying Day 14 + UI redesign to prod (Option A):
- Confirmed VPS was already on branch `day-14-points-programs` at commit `1a329c0`
- Confirmed migration `007_points_batches.sql` was already applied
- Confirmed api + web containers were rebuilt from that branch on ~2026-06-29
- Sanchit visited `https://app.onusclub.com` and said "looks good"
- Sanchit asked "what about broken functionalities" — I listed known stubs (`/dashboard/card-builder` and `/dashboard/analytics` were shipped as placeholders), then he never came back with specifics
- **Open question at the moment of handover**: is there anything actually broken on prod, or was it just a vague check-in? Ask Sanchit to name specifics before poking around.

Immediately after that, Sanchit decided to switch from the CLI to Antigravity IDE, so this doc exists to bridge the gap.

---

## Where the code lives (nothing can be lost)

| Location | Path | What it holds |
|---|---|---|
| Sanchit's Mac | `/Users/sanchit/Projects/stampdeck` | Local clone, working tree clean |
| GitHub | `github.com/sippzytech/onusclub` (SSH: `git@github.com:sippzytech/onusclub.git`) | Source of truth for code |
| Production VPS | `root@api.onusclub.com:/docker/stampdeck` | Deployed clone, currently serving prod |

**Note the mismatch**: local dir is `stampdeck` (legacy name), GitHub repo is `onusclub`, pnpm packages are `@onusclub/*`. See `CLAUDE.md` for the full rename history. This is intentional — some names weren't renamed because renaming them (MySQL DB name, Docker volume, VPS deploy dir) would risk data loss for zero user-visible benefit.

## Current git state (as of this doc)

- **Branch**: `day-14-points-programs`
- **HEAD**: `407b8ea` — "Docs: Perkstar tear-down + Day 15+ candidates + office-laptop handoff"
- **Working tree**: clean
- **Remote**: up to date with origin

## What is live on prod right now

- `https://api.onusclub.com` — Node/Express API
- `https://app.onusclub.com` — Next.js dashboard + customer-facing pages
- Both routed via existing Traefik on the VPS (`n8n_default` network, cert resolver `mytlschallenge`)
- MySQL 8 on the internal Docker network (`onusclub-mysql` container, DB name `stampdeck` — not renamed)
- All 7 migrations applied through `007_points_batches.sql`
- Both containers on the `day-14-points-groups` build (~2026-06-29 rebuild)

## What is on-hold / gated externally

- **Google Wallet production approval** — issuer still in demo mode. Only allowlisted Google accounts can save passes. Waiting on friend to finish marketing site (privacy/ToS/logo) so Google can approve.
- **Resend sender domain** — currently `onboarding@resend.dev`. Verified subdomain `send.onusclub.com` at some point but not sure if `EMAIL_FROM` env was flipped on VPS. Worth verifying if we get to email work.
- **Backblaze B2 offsite backup** — code shipped Day 13, needs 10 min of user-side sign-up + 3 env lines on VPS. See `DEPLOY.md §9`.

---

## What we're doing next (Day 15 — planned, not started)

**"Revenue capture + dashboard come-alive"** — the biggest lever from the Perkstar tear-down (`PERKSTAR_ANALYSIS.md` explains the full reasoning).

**One-line summary**: Perkstar has no POS integration. They ask the merchant to type the sale amount at scan time and derive every revenue/ROI/AOV/RFM number from that one input. We can do the same with one column on `card_events` + one field on the scanner.

**Scope (~1.5-2 days)**:
1. Migration `008_card_event_amount.sql` — `ALTER TABLE card_events ADD COLUMN amount_cents BIGINT NULL;` + `ALTER TABLE merchants ADD COLUMN currency_code CHAR(3) NOT NULL DEFAULT 'EUR';`
2. Accept optional `amountCents` in card event insert paths:
   - `apps/api/src/cards/operations.ts` — `addStampToCard`, `redeemStampCard`, `addPointsToCard`, `redeemPointsCard`
   - `apps/api/src/routes/scan.ts` — accept in body
3. Scanner state machine (`apps/web/src/app/dashboard/scan/scan-client.tsx`) — add a skippable "Sale amount (€)" prompt step between scan + commit
4. Manual stamp/redeem buttons on `/dashboard/cards/[id]` — small amount input next to buttons
5. Overview page (`apps/web/src/app/dashboard/page.tsx`):
   - Sum `amount_cents` last 7d → "Revenue (last 7 days)" KPI
   - Sum / count → "AOV" KPI
   - Last 10 `card_events` → recent activity feed
6. Smoke test additions — 5-6 assertions covering amount capture + aggregates

Full priority table for Days 15-19 in `ROADMAP.md` "Perkstar-inspired candidates" section.

---

## Bootstrapping a fresh Claude session in Antigravity

### Step 1: Open the project

```bash
cd /Users/sanchit/Projects/stampdeck
# open in Antigravity — however that CLI/GUI shortcut works
```

The repo is already there; do NOT re-clone (you'd nuke uncommitted work if there ever is any).

If for some reason it's missing, clone fresh:
```bash
git clone git@github.com:sippzytech/onusclub.git /Users/sanchit/Projects/stampdeck
cd /Users/sanchit/Projects/stampdeck
git checkout day-14-points-programs
```

### Step 2: Verify state

```bash
git status && git log --oneline -5
# expect: clean tree on day-14-points-programs, HEAD at 407b8ea or later
```

If HEAD is not at `407b8ea`, run `git pull` first.

### Step 3: Paste this exact prompt into the fresh Claude chat

Copy-paste the block below verbatim as your first message in the new chat. This gives Claude instant grounding without you having to explain anything.

---

> I'm resuming a project called **OnUsClub** — a multi-tenant SaaS for digital loyalty cards (Google Wallet + Apple Wallet, Netherlands-first, competing with Perkstar UK and Tap2 NL). The prior chat was in a Claude Code CLI terminal and I'm continuing in Antigravity.
>
> Please read these files in order before answering anything:
>
> 1. `CLAUDE.md` — stack, ports, conventions, secrets locations
> 2. `HANDOFF.md` — where I stopped, current git/prod state, what's next
> 3. `ROADMAP.md` — full day-by-day history + Perkstar-inspired candidates for Days 15-19
> 4. `PERKSTAR_ANALYSIS.md` — the feature tear-down that shaped the current plan
>
> Once you've read those, tell me:
> - What's currently live on prod
> - What the next planned work is
> - Confirm you understand that "Day 15 revenue capture" is the recommended next feature
>
> Then wait for me to say what I want to do. Don't start coding until I confirm.

---

That's it. Antigravity + Claude reads those four files, and it will know everything the previous CLI session knew.

### Step 4 (optional but recommended): tell Claude what your memory contains

If Antigravity's Claude has access to a memory store, it may not have the entries the CLI session built up. The important ones live at `/Users/sanchit/.claude/projects/-Users-sanchit-Projects-stampdeck/memory/`. Two files are load-bearing enough to mention explicitly:

- `feedback_dont_use_office_email.md` — `sanchit.shinde@easyhomefinance.in` is off-limits in any test data. Use personal gmails.
- `feedback_env_smart_quotes.md` — macOS auto-substitutes " when you paste, breaking .env on remote hosts. After editing `.env` on the VPS: `grep -P '[^\x00-\x7F]' .env` to catch curly quotes.

The rest is nice-to-have context, not action-blocking.

---

## Restart the laptop safely — checklist

Before you close the terminal / restart:

- [ ] `git status` shows clean tree (already true — checked at the top of this doc)
- [ ] `git log` shows HEAD is pushed (`origin/day-14-points-programs` at `407b8ea` — already true)
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
