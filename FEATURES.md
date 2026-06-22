# OnUsClub — Features

What OnUsClub does, grouped by who it serves and what it actually delivers. Use this as a brief for designers, marketers, copywriters, or AI tools building the OnUsClub marketing website.

For day-by-day implementation history, see [ROADMAP.md](./ROADMAP.md). For deployment, see [DEPLOY.md](./DEPLOY.md). For analytics setup, see [METABASE.md](./METABASE.md).

---

## What it is, in one line

**OnUsClub is a multi-tenant SaaS that gives cafés, salons, and other small businesses digital loyalty cards their customers actually keep on their phone — via Google Wallet today, Apple Wallet tomorrow. No app, no plastic card, no carrying around a paper card with seventeen ink stamps.**

Positioned as the Netherlands-first, SMB-friendly alternative to Perkstar (UK) and Tap2 (NL).

---

## What's built today (June 2026)

### For the café / shop owner

#### Onboarding without friction
- **Self-service signup** with email + password — no payment, no demo call required. Owner is signed in within 60 seconds.
- **Auto-generated public signup link per business** in the form `app.sippzy.com/m/<business-name>-<5-char-suffix>` — readable, unguessable, branded. Stays the same forever.
- **Downloadable QR code** of that public link. Print it, put it on the counter, customers scan and self-enrol.

#### Programs
- Create unlimited **stamp programs** (e.g. "Buy 6 coffees, get the 7th free") with:
  - Stamps required (1 – 100)
  - Reward text (free-form, shown on the customer's pass)
  - Optional **card expiry** in days of inactivity (cards auto-move to "Inactive" in Google Wallet when expired)
- Schema is intentionally polymorphic so points cards, memberships, multipass, discount cards, etc. plug in without a rewrite (Phase 2).

#### Customers
- Add customers manually with name + phone *or* email, optional birthday.
- **Full-text search** across name, phone, and email (instant client-side filter — handles thousands of rows).
- Birthday field used by the automatic birthday-greeting feature (premium).

#### Cards
- Enrol a customer into a program with one click → unique card created with a 64-character cryptographic QR token, initial stamp count of 0.
- **Three ways to stamp a card** (all share the same atomic database transaction so two staff stamping at once can't double-count):
  1. **QR scan** from the dashboard (laptop webcam or staff phone). State-machine UI shows pulsing-blue while scanning, amber while recording, green when a stamp lands, amber notice on "already stamped today".
  2. **One-click "+1 stamp"** button inline on the cards list (no detail-page navigation needed for fast service).
  3. **Detail-page Add stamp** button when the cashier wants to see the customer's history first.
- **Once-per-day-per-card limit** at the server level — prevents a customer flashing their QR twice from accidentally getting two stamps.
- **Auto-redeem suggestion** at threshold (button switches from "Add stamp" to "Redeem reward").
- Per-card event timeline showing every stamp, redeem, and message delivery.
- Card status badges: Active / Blocked / Expired.

#### Staff / team accounts
- Owner can add team members (cashiers, baristas) with email + initial password.
- Team members log in independently and can do everything an owner can (stamp, redeem, enrol, run broadcasts).
- Owner-only actions: add/remove team members.
- Designed for cafés with multiple shifts where you don't want everyone sharing one login.

#### Authentication
- Email + password sign-in (bcrypt-hashed at cost 12).
- **Forgot password flow** with single-use, 1-hour token emails.
- Future-ready for magic-link or SSO (the infrastructure is still in the codebase from earlier auth iterations).

---

### For the café's customers

#### Sign-up that takes 30 seconds
- Customer **scans the QR code** at the counter → opens a branded landing page → fills in name + phone or email + optional birthday → hits "Get my loyalty card" → instantly sees an **Add to Google Wallet** button.
- One tap → pass is in their Google Wallet. **No app to download.**
- **Welcome push notification** delivered as part of the signup.
- If they scan again later (different visit, lost the pass), the system recognises their phone/email and returns the existing card — no duplicates.

#### Their card, in their pocket
- Pass shows in Google Wallet with: business name, program name (e.g. "Coffee stamp card"), current stamps as `2 / 6`, reward text, member name, member ID (8-char shortcut).
- **Updates live as they earn stamps** — the number on the pass changes within a few seconds of the cashier scanning their QR or clicking +1 stamp.
- Every stamp, threshold-hit, and redeem fires a **push notification** to their phone (customer can mute per-pass via Google Wallet settings).
- When they hit the threshold, the pass shows "Reward unlocked" — they show it at the till to claim.

#### Customer-facing card page (no app needed)
- Every card has a public URL `app.sippzy.com/c/<qr-token>` showing:
  - Big stamp counter
  - Reward
  - Lifetime stats (e.g. "5 rewards redeemed on this card")
  - Status (active / expired)
  - "Add to Google Wallet" link if not yet saved
- URL is unguessable (32 bytes of randomness). Customers can bookmark, share via iMessage, screenshot — without exposing other customers' data.

#### Email invitation (when email is provided)
- On enrolment, the customer receives a branded email with a big **"Add to Google Wallet"** button.
- Subject: "Your loyalty card for <Business> is ready".
- Plain-text fallback for non-HTML clients.

---

### Marketing & customer engagement (premium tier)

#### Broadcasts
- Owner composes a message (max 60-char title, 200-char body), clicks Send.
- Within minutes, **every active customer's Google Wallet pass receives the message** + a push notification.
- **Async with live progress bar** — owner doesn't wait on a spinner; they can navigate away and check back later.
- Per-customer delivery audit log: who got it, who failed, why. **Retry failed** button re-attempts only the ones that didn't land.
- Capped at 3 retry attempts per message per customer.

#### Audience filters for broadcasts
- "All active customers" by default.
- Filter by:
  - **Lifetime stamps ≥ N** — reward your most engaged customers with exclusive offers.
  - **Birthday this month** — target a birthday-month-only promo.
  - **Specific program** — only customers on a particular loyalty program.
- Filters AND together.

#### Birthday automation
- Daily cron at 08:00 Europe/Amsterdam finds every customer whose birthday is today and sends them a push: "Happy birthday from `<Business>` 🎉".
- Dedupes against same-day re-runs (a customer never gets two birthday messages on the same day).
- Per-merchant on/off switch.

#### Inactivity nudges
- Daily cron at 10:00 finds customers who haven't visited in 30+ days and sends a "We miss you" push.
- Dedupes against any inactivity nudge sent in the prior 30 days (so a stale customer gets one ping, not a daily nag).
- Failed deliveries auto-retry on the next day's run.
- Per-merchant on/off switch.

#### Card expiry
- Per-program expiry policy (in days of inactivity).
- Daily cron at 03:00 flips stale cards to **Expired** state.
- Pass auto-moves to Google Wallet's "Inactive passes" section.
- The card row is preserved (history intact); status just flips.

#### Operations cockpit
- `/dashboard/messages` shows a unified timeline: every broadcast, every birthday-sweep run, every inactivity-sweep run, with live progress for in-flight items.
- Click any row → per-customer delivery table with statuses (Sent / Failed / Pending), attempt counts, and last error messages.
- One-click retry on any failed batch.

#### Premium gate
- Messaging features live behind a "Premium" gate. Non-premium owners see a polished lock screen with feature highlights and a "Try premium (free during testing)" button.
- The gate is enforced server-side (broadcast sends return 402 to non-premium accounts) so the lock isn't bypassable.
- Stripe billing isn't wired yet — Day 11+ work. Currently the lock can be unlocked freely during beta.
- Premium merchants get a switch to **pause all automatic notifications** (birthday + inactivity crons) without losing broadcast access.

---

### Analytics

- Read-only `reporting` MySQL user is provisioned automatically on first deploy.
- [METABASE.md](./METABASE.md) ships seven starter SQL queries: top cafés by active customers, stamps per day, redemption rate per merchant, cards by status, most engaged customers, broadcast success rate, daily merchant signups.
- Read access is scoped to OnUsClub's database only — no other databases on the VPS are visible to the analytics user.

---

### Operations

- **Daily MySQL backups** at 02:30 UTC, gzipped, with 30-day retention. One-line restore command.
- **HTTPS by default** via Traefik + Let's Encrypt. Both `api.sippzy.com` and `app.sippzy.com` have valid certs auto-renewed.
- **Continuous integration** on GitHub Actions: every push and PR runs typecheck + build for shared, api, and web.
- **Three independent cron sweeps** run inside the api process (no external orchestrator needed): birthday, inactivity, expiry. All log structured JSON to stdout for ops visibility.

---

### Security & privacy posture

- **Multi-tenant by design**. Every database query in the api is filtered by `merchant_id` derived from the authenticated user's JWT — staff at one café cannot read another café's customer list, ever.
- **bcrypt** for owner / staff passwords (cost 12). **No plaintext credentials** anywhere.
- **JWT-signed sessions** with strong, env-driven HS256 secrets. Cookies are httpOnly + Secure + SameSite=Lax in production.
- **Customer data minimisation** — we never ask customers to create a OnUsClub account. The pass on their phone IS their identity. No customer password DB to breach.
- **Token-based customer URLs** — the public `/c/<qr-token>` route relies on 32 bytes (256 bits) of cryptographic randomness as the access credential. Effectively unguessable.
- **Google Wallet is the storage of record** for the pass-side data — Google handles biometric unlock, device encryption, and remote wipe if the customer loses their phone.
- **Service account key for Google Wallet** lives in a chmod-600 file on the VPS, mounted read-only into the api container. Never committed.
- **Resend API key** for transactional email is env-only, never committed.
- **Database backups** run with `--single-transaction` so no read-lock contention with live traffic.

---

### Tech stack

For the marketing site, knowing the stack might help the AI position credibility statements. We don't expose technical details to end users in the product.

- **Monorepo**: pnpm workspaces — `apps/api`, `apps/web`, `packages/shared`.
- **API**: Node 20 + Express + TypeScript (strict, ESM). MySQL 2.x driver, zod validation, pino structured logs, jsonwebtoken, bcryptjs, google-auth-library, node-cron, Resend HTTP API.
- **Web**: Next.js 14 App Router + TypeScript + Tailwind. Server components for data fetching, client components for forms and live polling.
- **Database**: MySQL 8 in Docker, custom migration runner reading sequenced SQL files.
- **Wallet integration**: Google Wallet REST API for LoyaltyClass + LoyaltyObject lifecycle, signed Save-to-Wallet JWTs via service-account RS256.
- **QR generation + scanning**: `qrcode` (SVG/PNG output) + `html5-qrcode` (camera-based scanning).
- **Deployment**: Docker Compose, fronted by Traefik with Let's Encrypt. Already deployed on a Hostinger VPS at `api.sippzy.com` + `app.sippzy.com`.

---

## Not built yet (Phase 2 / deferred)

These are intentional gaps — see [ROADMAP.md](./ROADMAP.md) for the why-deferred reasoning.

- **Apple Wallet pass support** (`.pkpass` issuance) — Phase 2.
- **Stripe billing** — turn the fake premium unlock into real subscription revenue.
- **Wallet pass visual customization** (per-merchant logos, brand colors, layouts, possibly AI-assisted design) — deliberately deferred to be designed properly rather than shipped quickly.
- **Google Wallet production approval** — currently in demo mode, only allowlisted test accounts can save passes. Submission requires a marketing site with privacy policy + terms of service.
- **Resend sender domain verification** for `sippzy.com` — currently emails go from `onboarding@resend.dev` and only deliver to the Resend account owner. Verification is a 5-minute DNS task once the marketing site is up.
- **Offsite backup upload** to S3 / Backblaze — local backups exist; offsite is the missing piece.
- **Multi-program-type support** beyond stamp cards (points, memberships, multipass) — schema is ready, business logic + UI not yet.
- **Owner passwordless / magic-link login** — the auth infrastructure exists, just isn't wired to email delivery.

---

## Suggested website framing

For a website AI building the OnUsClub marketing site, here's how the value props ladder up:

1. **Headline value**: "Your loyalty card, on your customer's phone. No app required."
2. **For the customer**: scan a QR, save to Google Wallet, watch stamps appear as they collect them, get notified about offers and birthdays.
3. **For the café owner**: a tablet at the counter, a QR sticker on the wall, and three minutes of setup. From their phone, they can stamp a card, see who's active, and broadcast offers — without ever exporting a CSV or sending a mass email.
4. **Differentiators vs Perkstar / Tap2**: Netherlands-first (Europe/Amsterdam timezone, GDPR-considered design, NL phone format defaults), instant signup (no demo call), and a single transparent SaaS price point with the cron automation included rather than upsold.
5. **Proof points**: live push notifications within seconds (Google Wallet handles delivery), per-customer audit logs for every push, daily database backups, multi-staff support, granular event log per card.

The marketing site itself is the gating dependency for going fully live — it's the privacy policy + terms of service URL that Google Wallet requires for approval out of demo mode.
