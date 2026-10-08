# OnUsClub Roadmap

The durable plan. Any Claude session (or human) opening this repo cold should be able to read this file and know exactly what's done, what's coming, and what's deliberately on hold.

## North star

Multi-tenant SaaS for **digital loyalty cards** (Google Wallet phase 1, Apple Wallet phase 2). Netherlands-first, SMB-friendly. Competing with Perkstar (UK) and Tap2 (NL).

See also: [CLAUDE.md](./CLAUDE.md) for stack + conventions, [DEPLOY.md](./DEPLOY.md) for the prod deploy runbook, [METABASE.md](./METABASE.md) for analytics setup.

---

## Backlog — consolidated 2026-10-02

Everything open, ranked. Reviewed in full on 2026-10-02 after Google Wallet went to
production. Items marked 🔴 are live exposures rather than features.

### 🔴 P0 — open exposures

**1. Production is hosted in India.** 🔶 **DEFERRED 2026-10-03 — deliberately, with a
trigger. Re-read this before onboarding anyone real.**

`srv1573651.hstgr.cloud` / `187.127.149.147` is **Mumbai, IN** (Hostinger). India has no
EU adequacy decision, so EU customer data there is a third-country transfer requiring
SCCs, a Transfer Impact Assessment and disclosure in the privacy policy — none of which
exist.

**Why it is deferred**: GDPR protects *natural persons*. Every merchant and customer row
today is test data (`Smoke Café …`, `@example.com`), so there is no data subject and
therefore no exposure. Buying a second VPS now would mean 2-3 months of cost with no
revenue and nothing to protect.

🚨 **The trigger — migrate BEFORE whichever comes first:**
- the first real merchant is onboarded
- any marketing or outreach that could produce one
- a pilot café "just to test" — this is the one that will catch you out

It is not "before launch" and not "at the end". It is **before the first real person's
name enters the database**.

**What is already real**: the `leads` table. The demo form on onusclub.com captures real
names, emails and phone numbers. Low volume while unmarketed, but it means the privacy
policy should be accurate about the processing region, and a rising lead count is the
trigger arriving early.

**Deferring is safe because** migration difficulty scales with data volume and local
state, not with features. Docker Compose, versioned SQL migrations and file-based secrets
all migrate identically in three months.

⚠️ **The one exception is item 8, merchant logo upload.** Implemented as local-disk
writes it creates a volume of customer-uploaded images that must also be migrated. Decide
*before* building it: keep `logo_url` as a URL, or use object storage — the Backblaze B2
code from Day 13 is already written and unwired.

**When the trigger fires** (~half a day, minutes of downtime):
- Hostinger has **no Netherlands VPS**. Regions are France, Germany, Lithuania, UK.
  **Germany** is the pick — EU, ~10 ms to Amsterdam. Avoid the UK; it runs on a
  periodically-reviewed adequacy decision.
- **Do NOT use Hostinger's "change location".** It is a reinstall that permanently
  deletes all data, backups and snapshots. Buy a second VPS, migrate, verify, cancel the
  old one — parallel running is what makes this low-risk.
- **Move OnUsClub only.** The box also runs MenuDeck, n8n, Metabase and the shared
  Traefik; none of them hold OnUsClub data. Metabase is confirmed *not* connected to
  OnUsClub (it serves MenuDeck and sippzy lead capture), so there is no cross-border
  query path to worry about.
- **Lower the DNS TTL first.** `api.` and `app.onusclub.com` are at **3600s**; drop to 60s
  at least two hours ahead or the cutover window is an hour instead of minutes. DNS is on
  NS1, via the Netlify panel.
- **`/docker/stampdeck/secrets/apple/` is the irreplaceable part.** Copy byte-for-byte and
  checksum both sides. Lose it and every Apple pass customers already hold stops updating,
  with no quick path to re-sign. Worth backing up off the box **today**, migration or not —
  a VPS failure has the same consequence.

**2. The marketing site throws away every lead.** ✅ **FIXED 2026-10-03** — see Day 18.
Kept here because the shape of the bug is worth remembering: it failed silently and
looked like success.

`components/FinalCTA.tsx` `handleSubmit()` validates, calls `setSubmitted(true)`, and
**never sends the data anywhere**. No `fetch`, no API route — the site has no `app/api`
directory at all. The visitor sees a success state; nobody receives anything. The footer
newsletter form in `ui/footer-section.tsx` does the same. Every demo request since launch
is gone.

**3. The site promises a trial that does not exist.** 🔶 **HALF FIXED 2026-10-03** — the
CTAs now link to `app.onusclub.com/signup` and the copy reads "Get started free", so
nothing is promised that signup does not deliver. The trial *mechanism* is still item 7;
restore trial wording when it ships.

The CTA reads **"Start 14-day free trial"** and links to `#demo` — an anchor to the form
that discards. There is no signup link to `app.onusclub.com` anywhere on the site, and no
trial mechanism in the product.

**4. Resend's daily cap.** 🔶 **CORRECTED 2026-10-03 — not an exposure, and not about
broadcasts. Moved to the first-real-customer checklist alongside item 1.**

The original claim here was wrong: broadcasts do not send email. `dispatch()` calls
`sendCustomCardMessage` — Google Wallet push, plus Apple APNs — and never touches Resend.

Email volume tracks **signups**, not messaging. The only senders are the enrolment invite
(one per new customer), the manual resend button, magic-link and password-reset, and the
lead notification to ourselves. CSV import deliberately sends none.

So the free tier's **100/day** (which binds long before the 3,000/month headline) means
100 new customer enrolments in a day. The realistic scenario is a café's launch day where
150 people scan the QR and 50 get a card with no email — and even then it degrades rather
than breaks: `email/client.ts` logs the failure and returns `{ ok: false }`, the card is
still created, and the customer is already on the card page where they can add it to their
wallet.

Pro is $20/mo for 50,000 and needs **no code change**. Buy it when the first real café is
onboarded, not before.

✅ **Delivery itself confirmed 2026-10-08.** The weekly digest fired Mon 2026-10-05 at
06:00 UTC — 08:00 Amsterdam, as scheduled — from `noreply@send.onusclub.com` and landed in
a third-party Gmail inbox, correctly rendered and not in spam, recorded as `sent` in
`email_deliveries`. That retires the long-standing "we think email works but nobody has
watched one land" caveat. The cap is a separate question from whether delivery works.

~~**The real gap is visibility, not the cap.**~~ ✅ **FIXED 2026-10-05.** Migration 013
adds `email_deliveries`, written from inside `sendEmail` so no sender can forget. Three
states, not two: `skipped` means no provider is configured, and counting those as failures
would make the figure permanently alarming and therefore ignored.

Surfaced where each audience needs it — a banner on the merchant Overview that appears
only when something failed, the detail on Settings, the per-customer history on the card
page (the actual support question: *"my customer says they never got their card"*), and
platform-wide on `/admin`. "Delivered" is labelled as *our provider accepted it*, not
inbox delivery, since we do not consume Resend's webhooks.

Buying Pro is still the fix for the cap itself — but a hit limit is now a number on a
screen rather than a log line nobody reads.

### Working order (set 2026-10-03)

1. **Item 8** — merchant logo upload. One day, and the last visibly-missing piece of the
   customer-facing product now that Google Wallet is live and every pass shows the OnUsClub
   badge as the merchant's logo.
2. ~~**Tenant-scoping enforcement**~~ ✅ **DONE 2026-10-04.** Shipped as a behavioural
   isolation suite in smoke rather than a code mechanism: two merchants, and every
   `:id`-taking endpoint tried with the wrong tenant's token. 9 refusal checks plus list,
   export and counter assertions.

   Chosen over a query wrapper deliberately. An audit found 47 statements touching tenant
   tables without naming `merchant_id`, but nearly all operate on an id already verified
   upstream — a mechanism forcing scope on all of them would be high-friction and mostly
   redundant. A test that *proves* isolation is worth more than one that approximates it.

   ⚠️ **Its limit**: it covers the endpoints enumerated in it. **Every new `:id` endpoint
   needs a case adding**, or the suite quietly stops being a guarantee. The admin block
   added on 2026-10-04 drives its paths from one array constant for exactly this reason —
   a missing entry is visible, silence is not.
3. ~~**Items 10-13** — the master dashboard.~~ ✅ **DONE 2026-10-04.** See P2 below for the
   three decisions that overruled the obvious design, and docs/admin/README.md for how to
   grant yourself access.
4. ~~**Item 15** proximity notifications~~ ✅ **DONE 2026-10-04.**
   ~~**Item 18** weekly digest~~ and ~~email-failure visibility~~ ✅ **DONE 2026-10-05.**
   Remaining small items: 21 (`/contact`, separate Netlify repo), 22 (MCC label, Google
   console), 23 (dead `sippzy.com` routers), the expiry input on the program form, and
   audience-filter display on broadcast detail.
5. **Item 16** template gallery, whenever the commissioned motifs land.
6. **Items 20 and 19** — Playwright and the security review, last, as the pre-launch pass.

Gated separately on the first real customer: **1** (EU hosting), **4** (Resend Pro),
**9** (Stripe Billing).

### P1 — next builds

**5. Google Wallet hero image** ✅ **DONE 2026-10-03.** Originally: The card design system feeds the customer
page, the Apple strip and the editor preview — but never Google Wallet, so Android passes
show no stamp art. Deferred originally as "low value while in demo mode"; that expired
2026-10-02. Needs a public per-card PNG endpoint plus `heroImage` on the object patch. The
hard part is cache-busting: Google caches hero images hard, and a grid frozen at 1/6
forever is worse than none.

**6. Signup + lead capture on the marketing site** ✅ **DONE 2026-10-03.** Originally: Replace `#demo` with a real
signup link to `app.onusclub.com/signup`, keep "Book a demo" as the secondary CTA, and POST
both forms somewhere durable. Cheapest credible store is a `leads` table on the existing
API plus a notification email.

**7. Trial periods with dynamic length** ✅ **DONE 2026-10-03.** Originally: Per-merchant
trial with a configurable day count, not a hardcoded 14. Needs `trial_ends_at` on
`merchants`, a gate on expiry, and in-app "N days left" messaging. The existing premium
flag is the natural place to hang it.

**8. Merchant logo upload** ✅ **DONE 2026-10-03.** Originally: Every Google pass currently shows the OnUsClub badge
as the merchant's logo, and customers now see it. `logo_url`, `brand_color` and `hero_url`
columns exist with **no write path anywhere**. The `ensureLoyaltyClass()` PATCH fix shipped
2026-09-27, so changes now actually propagate.

**9. Payment gateway — Stripe Billing.** 🔶 **GATED 2026-10-03** — moved to the
first-real-customer checklist alongside items 1 and 4. There is nobody to bill yet, and
billing is what makes the trial gate real, so it lands with the first paying café.
Originally: For a Netherlands-first SMB product the
instinct is Mollie (NL-native, iDEAL at ~1.8% + €0.25 vs Stripe's higher rate). But the
trial/tiering/proration logic in items 7 and 13 is exactly what Stripe Billing does and
what Mollie's recurring API does not. Stripe supports iDEAL, so Dutch customers still pay
the way they expect. Paying ~1% more per transaction to avoid hand-rolling proration and
trial-to-paid conversion is the right trade at this stage; revisit if iDEAL volume gets
large.

### P2 — the admin/master dashboard

A distinct product surface for OnUsClub staff, not a dashboard feature. Items 10-13 below
are one project.

**10-13. Master dashboard** ✅ **DONE 2026-10-04.** Shipped as six commits: the gate, the
café list with health flags, cross-merchant customer search and timelines, balance
corrections, account controls plus the audit viewer, and docs. Lives at `/admin` (web) and
`/v1/admin` (api); **[docs/admin/README.md](./docs/admin/README.md)** is the reference,
including how to grant access.

Three decisions worth carrying forward, because each overrules something that looked
obvious:

- **Platform admin is a row in `platform_admins`, NOT a role on `staff_users`.** The design
  note that used to sit here recommended a role; that was wrong, for reasons visible in the
  code at the time. `role` travels in the JWT (7-day expiry, no denylist), so revoking a
  role-based privilege would take a week. Worse, `verifyJwt` validated `userId` and
  `merchantId` and never `role` — a token minted with `role: "superadmin"` verified cleanly.
  And `POST /v1/staff` is one field away from being an escalation path the day merchants can
  choose their staff's role. Membership is therefore checked against the **database on every
  `/v1/admin/*` request**, never cached, so `DELETE` revokes instantly. The role allow-list
  in `verifyJwt` closed the second hole permanently.
- **No "profit" figure anywhere.** It is not computable: `card_events.amount_cents` is the
  café's own self-reported sale amount, it is sparse (NULL = staff skipped the prompt, which
  is not a €0 sale), and there is no cost-of-goods data. What ships instead is **health
  flags** with stated thresholds — `never_used`, `dormant`, `dead_enrolments`,
  `low_wallet_adoption`, `low_capture`, `onboarding`, `healthy` — each with the action it
  implies. Plus `merchants.monthly_fee_cents`, typed in by hand, which is the only revenue
  number and renders "—" when unset rather than €0.
- **Balance adjustments go through the `points_batches` ledger, never `card_state`.**
  `card_state.points_current` is a cache that `computePointsBalance` recomputes, so a direct
  write would display correctly, update the wallet pass, and then be silently reverted by the
  café's next transaction. `apps/api/scripts/smoke-admin.ts` asserts this the only way that
  counts: grant points, transact as the merchant, re-read, check the grant survived.

The honesty property to preserve: every adjustment also writes a `manual_adjust` row to
`card_events`, so it appears on the **café's own dashboard** with the before/after and the
stated reason. An operator changing a merchant's data invisibly is the real risk here, and
the fix is that they cannot do it invisibly. Don't remove that.

**13. Hard tenant isolation** — proven before the exception was introduced. The isolation
suite in `apps/api/scripts/smoke.ts` asserts that no owner, no staff member, no
unauthenticated caller and no forged-role token can reach any `/v1/admin` path. **That path
list is a constant at the top of the admin block — add a line to it for every new admin
endpoint**, so a missing denial test is a visible gap rather than silence.

**Deliberately not in v1**: impersonation ("log in as this café" — owner's decision),
deleting a merchant, editing programs or card design, editing customer PII, broadcasting as
a merchant, bulk adjust, and cross-merchant identity merging (ships only as an "also a
member at Café B" hint). Reasons for each are in docs/admin/README.md.

**Still SQL-only, by design**: granting and revoking platform admin. A CI step asserts
`platform_admins` is referenced nowhere in `apps/api/src/**/*.ts` except
`src/admin/authorize.ts`, so a second read path with a weaker check cannot quietly appear.

### P3 — planned

**14. RFM segments** ✅ **DONE 2026-10-03.** Shipped with sensible café defaults. The same
classifier now also powers the customer-mix panel on each café's admin detail page, so our
view of "at risk" and theirs cannot drift. A settings page for editing the thresholds is
still unbuilt — `DEFAULT_RFM_THRESHOLDS` in `packages/shared` is the single source.
**15. Geo / proximity notifications** ✅ **DONE 2026-10-04.** The pass surfaces on the
lock screen near the shop, with no app and nothing running on our side — both OSes handle
the trigger. Managed on `/dashboard/settings`; up to 10 shops per café, which is where
Apple and Google both cap out.

⚠️ **Two findings worth keeping, because each is silent in production:**

- **Google's `LoyaltyClass.locations` is deprecated and does nothing.** Its own reference
  says: *"This item is deprecated! Note: This field is currently not supported to trigger
  geo notifications."* The working field is **`merchantLocations`** (`{latitude, longitude}`
  only — no name, no address, Google picks the radius). Sending the old one is accepted,
  stored, and never fires. Do not "simplify" it back.
- **`classBrandingDiffers` must learn about every new class field.** `ensureLoyaltyClass`
  PATCHes only when a field that comparator explicitly checks differs, so anything added to
  `buildLoyaltyClass` alone reaches *new* classes only — every existing café keeps a class
  without it, forever, with nothing in the logs. Exactly the logo bug that function was
  written to fix. The location comparison rounds to 6 decimals and sorts, because Google
  echoes floats back and the round-trip is not bit-exact; comparing raw values would PATCH
  on every stamp.

`scripts/check-wallet-payload.ts` (in CI) guards both. Google Wallet cannot be exercised
outside production — it is disabled in local dev on purpose and the API has no delete — but
`buildLoyaltyClass` and `classBrandingDiffers` are pure, so the payload check is exact.
Both traps were verified to actually fail it.

Coordinate entry is a paste box, not a geocoder: a Maps link or a raw pair, parsed by
`parseCoordinates` in `shared`. Geocoding would have meant an API key, billing and a new
failure mode to replace parsing a string. Note **Google Maps' Share button returns a
`maps.app.goo.gl` link with no coordinates in it** — the API follows the redirect, and if
there are still none it says "copy from your address bar". That resolution is gated on the
parsed hostname being one of the two short-link domains, since it is our server fetching a
URL a caller supplied.

**Still unverified on hardware**: nobody has walked near a shop and watched the pass
appear. No test in this repo can prove that.

**Not included**: writing `card_events.location_id`, which is still never populated — so
"which branch was this stamped at" remains unanswerable. It needs a location picker on the
scanner and a story for existing NULL rows; separate feature.
**16. Template gallery** ✅ **DONE 2026-10-05** (presets) · 🔶 artwork still optional.

24 named presets in `packages/shared/src/card-templates.ts`, grouped into five industries,
with a browse-and-apply gallery at the top of `/dashboard/card-builder`.

Shipped **without any artwork**, because the old "blocked on ~90 commissioned motifs" note
conflated two things: a preset is a dozen lines of JSON picking from the 10 tintable icons
that have existed since Day 16, while only the tiled background *motifs* need an
illustrator. `pattern: "icon-tile"` already holds that slot. The gallery works now and gets
richer later with no change to the file's shape.

24 rather than Perkstar's 94. Their list runs alphabetically from ATV rental to Shawarma
and is mostly long tail — Billiard club, Climbing wall, Lift — which pads a gallery without
helping anyone. These are the trades a Netherlands-first loyalty product actually meets, and
adding one is a one-entry pull request whenever a real café asks.

Two properties worth preserving:

- **Applying a template changes local editor state only.** Nothing is written until Save,
  exactly as if the controls had been moved by hand — otherwise browsing the options would
  rewrite a live card several times. Asserted: the stored design is still empty after the
  page renders.
- **Labels are carried over, never reset.** A café that renamed "STAMPS UNTIL THE REWARD"
  into Dutch must not lose that by trying a colour scheme. Restyling is not relabelling.

Each tile renders through the real `CardPreview` component rather than a swatch, so a tile
cannot promise something the pass will not show.

**If you do commission motifs**: single-colour SVG tiles, `fill="currentColor"` only (we
tint at render, so a café changing brand colour never clashes with its own card), square
and seamlessly tiling, `viewBox="0 0 64 64"`, paths only — no `<image>`, no embedded
rasters, no gradients — under ~4KB each, since they rasterise into Apple's `@3x` strip.
Start with the top 10 industries. **Original artwork**: mirroring industry *names* is fine,
tracing their art is not.

**17. CSV customer import/export** ✅ **DONE 2026-10-03.**
**18. Weekly merchant digest email** ✅ **DONE 2026-10-05.** Mondays at 08:00
Europe/Amsterdam — the one moment a "here is what happened" email has somewhere to go.
Four numbers, one interpretation line, one link.

The interpretation line is the feature. "47 stamps" means nothing alone; "up 52% on last
week's 31" is a reason to keep going, and *"Nothing was scanned this week — if your staff
have stopped using the scanner, a quick reminder is usually all it takes"* is the single
most useful thing we can send a café that is drifting away. Percentages are suppressed
below a base of five, where they are noise.

Not premium-gated, matching the recorded decision that analytics stays free: withholding
it from the cafés most at risk of churning works against us. It *is* gated on
`crons_enabled`, the existing kill switch every sweep respects. Cafés with **zero cards**
are skipped — a digest reading "0 scans" to someone who has not started is noise — but
zero-*activity* weeks are not, because that is the case worth sending.

Idempotent without a new table: it asks `email_deliveries` whether the merchant already
got one in the last 6 days, so a container restart or a double cron fire cannot send
twice. Verified — 74 cafés on the first run, all 74 skipped on the second. `POST
/v1/sweeps/run/digest` forces a run in dev.

⚠️ **This is the only sender that scales with merchant count rather than signups, and it
fires all at once.** At four cafés it is four emails; past roughly 90 it would eat a whole
day of Resend's free quota in one Monday burst and starve the card invites. Pro (item 4)
lands long before that, but if merchant count ever nears it without Pro, batch this across
the day first.

**Follow-up, deliberately not built:** there is no dedicated opt-out. The email points at
the `crons_enabled` toggle under **Campaigns**, and says plainly that switching it off also
pauses birthday and win-back messages to customers — because it does. A digest-only
preference needs a column and a toggle; promising a control that does something broader
would have been the small lie that costs trust.
**19. Security review** ✅ **DONE 2026-10-05.** Full write-up, including what was checked
and found *clean*, in **[docs/security-review.md](./docs/security-review.md)**.

Six fixes. The one that mattered most was not on the original list:

⚠️ **Rate limiting was nearly worse than useless.** Login, signup and password reset all go
browser → Next route handler → api, and the handler did not forward the caller's address —
so the api saw the *web container* for every request on the platform. With IP-keyed limits
that means one shared bucket: five signups an hour in total, and any single attacker able
to lock out every user at once. Found while testing the limiter I had just added. `apiFetch`
now forwards `forwardedFor(req)`; verified that two browsers at different addresses get
separate buckets through the proxy.

The rest: rate limiting itself (login keyed on address **and** email, so one person behind
an office NAT cannot lock out colleagues); **`JWT_SECRET` minimum raised from 8 to 32** —
eight characters is brute-forceable offline from one captured token, and whoever recovers
it can mint a session for any user of any merchant; security headers on both apps, with
`no-referrer` specifically on `/c/*` because `qr_token` sits in that URL; the admin tripwire
was logging Traefik's address rather than the caller's, and now logs a hash of the real one;
and Dependabot, which did not exist.

🚨 **`JWT_SECRET` can stop production booting.** If the deployed value is under 32
characters the container refuses to start. Check and rotate before deploying — rotation
invalidates all sessions, currently four test accounts.

Checked and clean, recorded so nobody re-reviews it blindly: SQL injection (everything
parameterised; the template-literal SQL interpolates only constant fragments and generated
placeholder lists), CSRF (`sameSite: "lax"` already blocks cross-site writes; the single
state-changing GET is an unauthenticated public route with no ambient authority), CORS,
tenant isolation, error leakage, committed secrets, and the one SSRF surface.

Accepted with reasoning rather than fixed: `qr_token` as a bearer credential in a URL (the
QR code *is* the credential — an account per customer is a worse product), no account
lockout (lockout is itself a DoS lever), the 8-character password minimum, and in-memory
rate limits (upgrade to Redis when api runs more than one container).

Still open: **CodeQL** is not configured, and **nothing watches the logs** — rate-limit
trips and admin denials now write `warn` lines that are worth seeing and that nobody sees.

**20. Testing** ✅ **DONE 2026-10-05.** Four layers now, each covering what the others
cannot:

| | Covers |
|---|---|
| `pnpm smoke` | the API black-box, ~200 assertions, incl. cross-tenant isolation |
| `pnpm smoke:admin` | the platform-admin surface (needs `DATABASE_URL` — granting is SQL-only) |
| `pnpm check:wallet` | the Google Wallet class payload, which cannot be exercised outside prod |
| `pnpm e2e` | **Playwright**, in `e2e/` — browser flows |

The browser suite deliberately does **not** re-test the API. It covers only what a browser
is required for: the onboarding checklist (whose entire logic is "derive four booleans from
several API calls and render" — there is no endpoint to test), `/admin` returning
not-found rather than redirecting to `/login`, revocation killing a live browser session,
and the two-step balance-adjustment confirm including the café seeing the result on their
own card page.

⚠️ **The QR scanner is NOT covered, and that is a decision.** `/dashboard/scan` is
camera-only with no manual token-entry fallback, so testing it would mean feeding Chromium
a fake video stream containing a generated QR and hoping `html5-qrcode` decodes it — a test
of that library, not of us. The scan *operation* is already covered through the card detail
page, which hits the same endpoints. Written down in `playwright.config.ts` so nobody
assumes otherwise.

Runs in the existing `smoke` CI job rather than its own: mysql and the api are already up
there, and duplicating the service block to start them twice is the more fragile
arrangement. Chromium only. Fixtures are built over HTTP, never through the UI — a card
builder test should fail when the card builder breaks, not when signup does.

**Found while writing it:** neither the login nor the signup form associated its `<label>`
with its input (no `htmlFor`/`id`), so a screen reader announced five unlabelled boxes and
clicking a label did nothing. Fixed on both, plus `autoComplete` hints — which is also why
the tests can address fields by label rather than by placeholder.

### Small / cosmetic

- **`/contact` page** on onusclub.com — 🔶 **WRITTEN, NOT DEPLOYABLE FROM HERE
  (2026-10-05).** The page content, the footer link, the Google console click-path and the
  reasoning are in **[docs/marketing-site/contact-page.md](./docs/marketing-site/contact-page.md)**.
  `onusclub.com` is a separate Netlify site, so publishing is manual.

  ⚠️ **Blocked on one human check**: nobody has verified `support@onusclub.com` receives
  mail, and it appears 14 times across Privacy/Terms/GDPR as the data-subject contact. Send
  it a test from an outside address first. A bounce there is a compliance problem, not an
  inconvenience — do not publish the page until that address works.

  Same file also flags that **the trial copy can be restored**: CTAs were softened to "Get
  started free" because no trial existed, and trials have since shipped, so the site is now
  under-promising a feature we have.
- **MCC reads "Internet Cafes"** in the Google Business Profile — 🔶 **NOT A CODE CHANGE
  (confirmed 2026-10-05).** Nothing in this repo sets it; it is a field on the payments
  profile. Click-path: Google Pay & Wallet Console → **Business profile** → payments profile
  `4896-3145-4976` → *Business category / Merchant category code* → change to **5814
  (Fast Food Restaurants)** or **5812 (Eating Places and Restaurants)**, whichever the
  dropdown offers; for a loyalty-card SaaS, **7372 (Computer Programming / Software)** is
  the more accurate choice if it is available.

  Genuinely cosmetic — MCC affects card-network categorisation, and we take no payments
  through that profile. Worth correcting before the first real merchant mostly so the issuer
  record is not visibly wrong if anyone at Google looks at it again. Only you can change it;
  there is no API.
- ~~**`sippzy.com` legacy Traefik routers**~~ ✅ **REMOVED 2026-10-05.** DNS had been gone
  since at least 2026-09-17, so a router whose `Host()` rule named them could never receive
  a request — inert config that only misled anyone reading the compose file. The reasoning,
  including why restoring DNS was the alternative and why it was not chosen (every pass
  predating the cutover belongs to test data), is recorded at the top of
  `docker-compose.prod.yml`. **Requires a `docker compose up -d` to take effect.**
- ~~**Bump GitHub Actions**~~ ✅ **DONE 2026-10-05.** `actions/checkout` and
  `actions/setup-node` to v5, clearing the Node 20 runtime deprecation warnings.
  `pnpm/action-setup` deliberately left on v4: with no `packageManager` field in
  package.json the `version:` input is the only thing selecting pnpm, and that input is
  exactly what changes across its majors. Only CI can verify an Actions bump — if the next
  run fails on install, the revert is one line.
- ~~**Local dev DB** — accumulated smoke merchants break `pnpm smoke` locally.~~
  ✅ Done 2026-10-03: 53 historical test merchants had `crons_enabled` set false, which
  stops the inactivity sweep finding them without deleting anything.
- **`scripts/resync-wallet-class-logos.ts`** — written 2026-09-27, never needed: every class
  on the new issuer was created after the logo fix. Kept for future issuer work.

### Decisions already made

- **Analytics stays free, not premium-gated.** Decided 2026-10-02. It is the screen that
  makes the product demoable; gating it works against adoption. Built ungated.
- **Not feasible as described: logging customers who pass by without entering.** Wallet
  passes never report location to us — geofence triggers are handled entirely by iOS and
  Android, and the OS tells you nothing. Capturing "walked past but did not come in" would
  need our own app with background-location permission, which is a separate product, a
  consent burden under GDPR (location is personal data), and a battery/ratings problem.
  What *is* achievable: proximity notifications (item 15) and the visit timeline we already
  have from `card_events`.

---

## Done — day-by-day

Each day below corresponds to a git branch + a commit. Run `git log --oneline --all` to see them, or browse on GitHub.

### Day 23 — Master admin dashboard (backlog items 10-13)

Six commits. The first feature deliberately designed to read *across* tenants, which made
the privilege model the whole job.

**Migration `012_platform_admin`**: `platform_admins`, `admin_audit_log`,
`merchants.monthly_fee_cents`.

**Access is a table row, not a role** — overruling the design note that previously sat in
the P2 backlog section. Three reasons, all properties of code that already existed:
`role` travels in the JWT (7-day expiry, no denylist), so revoking a role-based privilege
would take a week; `verifyJwt` validated `userId` and `merchantId` and **never `role`**, so
a token minted with `role: "superadmin"` verified cleanly and arrived at handlers as a
well-typed value; and `POST /v1/staff` is one field from being an escalation path the day
merchants can choose their staff's role. Membership is checked against the **database on
every `/v1/admin/*` request and deliberately not cached**, so `DELETE` revokes instantly,
mid-session. `verifyJwt` now validates `role` against an allow-list, closing the second
hole permanently.

**Authorization is applied to the mount, not per route** —
`app.use("/v1/admin", requireAuth, requirePlatformAdmin, adminRouter)` — inverting this
codebase's convention on purpose: forgetting `requireAuth` on a normal route exposes one
tenant to one tenant, while forgetting it on an admin route exposes every café to anyone
with a login. A new admin endpoint cannot be written ungated. Denials answer **404, not
403** (confirming the namespace exists is itself a leak) and log a pino `warn` with user,
merchant, path and IP.

**No "profit" figure, and that is a decision.** It is not computable:
`card_events.amount_cents` is the café's own self-reported sale amount, it is sparse (NULL
means staff skipped the prompt, which is not a €0 sale), and there is no cost-of-goods data
anywhere. A number labelled "profit" built on that would be trusted. What ships instead is
**health flags** with stated thresholds, each carrying the action it implies —
`never_used`, `dormant`, `dead_enrolments`, `low_wallet_adoption`, `low_capture`,
`onboarding`, `healthy`. `onboarding` is checked first and returned alone, so a café three
days old doesn't appear as four problems and bury the ones that are real. Minimum-card
counts matter as much as the percentages: "1 of 2 cards has a pass" is two customers, not a
50% adoption problem.

What counts as café *activity* is narrower than "has rows in `card_events`": `signup` is
joining rather than visiting, `expire` is our own cron (counting it would make an abandoned
café look alive forever), and `manual_adjust` is **us** — counting that would mean our own
support fix marks a dormant café as active, so the metric would respond to our
interventions rather than theirs. Asserted in smoke.

**The ledger trap.** `card_state.points_current` is a cache of
`SUM(points_batches.points_remaining)` which `computePointsBalance` recomputes. A points
adjustment written to `card_state` would display correctly, update the wallet pass, and
then be **silently reverted by the café's next real transaction**. So grants insert a batch
row (`expires_at = NULL` — an administrative correction should not evaporate on the
program's clock) and deductions go through `deductPointsFifo`, extracted from
`redeemPointsCard` so the two cannot drift. The first draft of the *read* path had the same
bug: caught by corrupting the cached column to 999 and checking what the page rendered. Both
paths now use the ledger, and a disagreement is **surfaced** rather than quietly corrected.

**`applyManualAdjust` does not reuse the existing primitives**, on purpose. `stampCardById`
adds exactly +1 and throws at the threshold, so it cannot express a delta nor make the
commonest correction (landing *on* the threshold when the tenth scan failed).
`addPointsToCard` takes **euros** and writes `amount_cents` — routing an administrative
grant through it would fabricate revenue and corrupt that café's sales total and AOV, so a
support fix would quietly alter their business figures. It takes a **delta, not a target**:
a target invites a lost update, where the operator reads 5 on a stale page, the café stamps
twice, and "set to 7" discards those two stamps.

**The café sees every adjustment.** The `manual_adjust` enum value had existed unused since
migration 001; it now carries the before/after and the stated reason into the merchant's own
card timeline and activity feed, reading e.g. `Adjusted by OnUsClub · +3 stamps · 1 → 4 ·
"their third scan did not register"`. An operator changing a merchant's data invisibly is
the real risk in this feature, and the fix is that they cannot do it invisibly.
`card_events.staff_user_id` — present since 001 and written by nothing until now — carries
who. `amount_cents` stays NULL and `setCardEventAmount` still refuses to attach money to a
`manual_adjust`, so an adjustment can never pollute revenue or AOV.

**`admin_audit_log`** is append-only with no edit or delete path, and `writeAuditLog` takes
a `PoolConnection` so the audit row commits with the change it describes — a mutation that
forgets to audit itself cannot commit. No FK on `merchant_id`: the log outlives what it
describes, so a null café name at read time means "that café is gone", the case most worth
having a record of.

**Shape**: the café list is six `GROUP BY merchant_id` queries joined in Node, not a loop
over merchants calling the single-tenant analytics helpers (6×N queries — noticeable at 20
cafés, unusable at 200). Platform totals are summed from the same per-merchant aggregate the
list renders, so the header and the rows cannot disagree; smoke asserts the equality.

**Web** is a *sibling* of `/dashboard`, not a child: `DashboardShell` wants a merchant and
renders a trial banner and plan card, all meaningless here, and `DashboardNav`'s `TABS` is a
module constant so admin links there would ship in every café's bundle behind a flag.
`AdminShell` is near-black rather than brand green and names the environment — someone who
can adjust any customer's balance on any café's account should never be unsure which screen
they are on. `requireAdminSession` calls `/v1/admin/whoami` and renders not-found on
failure, not a redirect to `/login` which would confirm the route exists. There is
deliberately **no `middleware.ts`**: Next middleware cannot cheaply reach the api, and a
second half-authorization is mostly useful for being trusted by mistake.

**Fixed on the way**: `merchants.trial_ends_at` is a MySQL `TIMESTAMP`, whose range ends
2038-01-19. A trial date past that reached the database and returned an opaque 500. Now
bounded in the contract with a message naming the date as the problem.

**Guards**: a CI step asserts `platform_admins` is referenced nowhere in
`apps/api/src/**/*.ts` except `src/admin/authorize.ts`, so a second read path with a weaker
check cannot quietly appear. A new `apps/api/scripts/smoke-admin.ts` (32 blocks) covers the
positive side and connects to MySQL because granting is SQL-only — it is the only thing in
the repo that writes `platform_admins`. The main suite's isolation section drives the admin
denial paths from **one array constant**, so a new endpoint without a denial test is a
missing entry somebody has to edit rather than silence; it refuses an owner, a staff member,
an unauthenticated caller, another merchant's owner, and a self-minted `superadmin` token.

**Deliberately not in v1**: impersonation (owner's decision), deleting a merchant (the
cascade is irreversible; smoke asserts the route does not exist), editing programs or card
design (changes the deal for customers already holding a card), editing customer PII,
broadcasting as a merchant, bulk adjust, and cross-merchant identity merging (ships only as
an "also a member at Café B" hint, since `customers` is per-merchant by design and joining
identities would let one café's correction alter another's data).

See **[docs/admin/README.md](./docs/admin/README.md)** for the grant SQL and the full
reasoning.

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

### Day 20 — RFM segments
- Recency / Frequency / Monetary, cut down to something a café with 60 customers can act
  on. Classic RFM scores each dimension into quintiles and crosses them into 125 cells;
  that needs a population large enough for quintiles to mean anything. **Six threshold-based
  segments** instead, each with an obvious next action: champions, promising, new, at_risk,
  sleeping, lost.
- `classifyRfm()` lives in `packages/shared` — pure, so the API and the dashboard cannot
  drift on what "at risk" means. Same reasoning as the card renderer. 13 cases checked
  including boundaries and the one that matters: a daily regular who vanished six months
  ago is **lost**, not champions.
- **`GET /v1/analytics/segments`** is deliberately *not* range-scoped, unlike `/detail` —
  recency only means something measured from now, and bounding it to "the last 30 days"
  would make everyone outside the window look identically lapsed. Grouped by **customer**,
  not card: someone holding a stamp card and a points card is one person.
- **The payoff is `audienceFilter.rfmSegment` on broadcasts** — "message the 20 people about
  to churn" instead of all 200. Classification runs in Node and feeds an `IN` list rather
  than being re-expressed in SQL: two definitions of "at risk" free to drift apart is not a
  trade worth making for a query that decides who gets a win-back message.
- An empty segment **short-circuits to zero recipients**. `IN ()` is a MySQL syntax error,
  and the tempting fallback — drop the filter — would turn a targeted win-back into a
  message to the entire customer base. Covered by smoke.
- Thresholds (30 days recent / 90 lapsed / 5 visits regular) are tuned for a café and
  echoed in the API response, so the page states the rule rather than presenting the
  buckets as self-evident. Editing them belongs with the master dashboard.
- Smoke +6 assertions. Verified end to end against six planted cohorts, one per segment.

### Day 19 — Google Wallet hero, trial periods, CSV import/export
- **Google Wallet hero image.** The card design system fed the customer page, the Apple
  strip and the editor preview — never Google Wallet, so Android passes showed no stamp
  artwork at all. `renderCardStrip` already took width/height and its comment already named
  the target, so no new artwork was needed. The subtle part is cache-busting: Google caches
  hero images by URI and will not refetch an unchanged one, so a static URL would freeze
  the grid at whatever it first saw — a card reading 1/6 forever while the header counted
  up. The `?v=` token is derived from stamp count plus a design hash. Root cause of the gap:
  `ProgramForWallet` never carried `design`; the Apple path always had it.
- **Trial periods.** `merchants.status` had carried a 'trial' value since migration 001 with
  nothing recording when it should end. Migration 010 adds `trial_ends_at`;
  `TRIAL_DAYS_DEFAULT` applies to new signups; NULL means no clock, which is what pre-existing
  rows keep. **The banner informs, it does not block** — there is no billing yet, so blocking
  would lose the account with nothing to convert to, and in a loyalty product it would strand
  the café's customers mid-card. Editable from `/admin/merchants/:id` since 2026-10-04.
- **CSV import/export.** The detail that mattered: **Dutch Excel writes semicolon-delimited
  CSV**, because the list separator follows the OS locale. An importer assuming commas would
  fail on most real café files, and fail confusingly. Delimiter is sniffed, BOM stripped,
  headers matched through an English/Dutch alias table, dates read day-first. Dry run is
  mandatory before writing — a café's list is often their only copy. Import never sends
  invite emails: 200 customers would hit Resend's 100/day cap and silently deliver a third.
- Also fixed a dead branch found while testing trials: `daysLeft` used `ceil`, which can
  never return 0 for a live trial, so "ends today" was unreachable and the contract comment
  claiming otherwise was wrong.

### Day 18 — Lead capture, and a signup route into the product
- **The marketing site had been discarding every enquiry since launch.** Both forms
  validated input, called `setSubmitted(true)`, and stopped there — no `fetch`, no
  `app/api` directory, no outbound call anywhere in the project. Each visitor was told
  "we'll be in touch". Nobody ever received anything.
- New **`POST /v1/public/leads`** + migration `009_leads.sql`. The marketing site calls it
  **server-side** from its own `/api/leads` handler, so the browser never touches
  `api.onusclub.com` — the same rule the dashboard follows. That choice is why this uses a
  shared secret instead of CORS: opening CORS for one marketing form would weaken the whole
  api, and would make this a genuinely public write endpoint in a codebase with **no rate
  limiting anywhere**. An unset secret therefore means **closed (503)**, not open.
- Deliberate details: only `source` + `email` required (validation that rejects a real
  prospect is worse than null columns); repeat submissions inside 24h merge via `COALESCE`
  so a double-click is one lead and omitted fields survive; honeypot answered 200 and
  dropped, because a visible rejection tells the bot which field caught it; `ip_hash`
  stores SHA-256 and never the address; the notification email is sent **after** the INSERT
  and is best-effort, since the row is the record and a Resend outage must not lose a lead.
- Site: both forms only show success once the lead is actually stored, the demo form gained
  a real error state (previously failure and success were indistinguishable), primary CTAs
  point at `app.onusclub.com/signup` — there had been **no route from the site into the
  product at all** — and "Start 14-day free trial" became "Get started free", since no trial
  exists yet.
- `support@onusclub.com` deliberately untouched: it appears 14 times across Privacy, Terms
  and GDPR as the contact for data-subject requests. If that mailbox does not work, the fix
  is to make it work, not to point legal documents at a Gmail.
- **`scripts/check-env-wiring.mjs`**, now in CI. `docker-compose.prod.yml` lists every env
  var explicitly, and `LEADS_INGEST_SECRET` was added to `config.ts` and `.env.example` but
  not to compose — so the endpoint answered 503 in production while `.env` looked perfect.
  Second time that class of bug shipped (the first left local dev pointed at the production
  Wallet issuer), so it is now a mechanical check rather than something to remember.
- Smoke +7 assertions, CI gets the secret so the real path is exercised rather than the 503
  branch.

### Day 17 — Analytics page (trends, busiest hours, top members)
- `/dashboard/analytics` stops being a "Coming soon" card. Day 15 had already captured
  everything it needed; this is the page that reads it.
- New **`GET /v1/analytics/detail?range=7d|30d|90d|12m`** — gap-filled daily series,
  24-bucket hour histogram, new-vs-returning, top members by visits and by spend. Kept
  **separate from `/overview`**, which the dashboard hits on every page load. Both queries
  ride the existing `(merchant_id, created_at)` index — no new index, no migration.
- **Timezone is the whole story.** `card_events.created_at` is UTC, merchants are
  `Europe/Amsterdam`, and bucketing UTC into *named* days and hours silently lies: a stamp
  at 00:30 Amsterdam is 22:30 UTC the previous day. Both SQL fixes were rejected —
  `CONVERT_TZ` with a named zone returns **NULL rather than an error** when the server's
  tz tables are unpopulated (silently empty charts), and a fixed offset is wrong for half
  the year because Amsterdam is +01:00 in winter and +02:00 in summer. So MySQL groups by
  UTC hour and **Node re-buckets via `Intl`**, DST-correct by construction since each hour
  converts at its own instant. Verified against planted events: `2026-09-26T22:30Z` →
  local `2026-09-27` hour `00`; `2026-09-28T10:00Z` → local `2026-09-28` hour `12`.
- mysql2 pinned to `timezone: "Z"`. It defaulted to `'local'` — the Node process zone —
  which was UTC only because neither compose file sets `TZ`. A `TZ` anywhere would have
  shifted every timestamp and taken the bucketing with it.
- **Charts are hand-rolled inline SVG**, following the `card-art.ts` precedent: pure
  functions of their props, no interactivity, so they server-render. The page is still
  **1.31 kB of client JS — byte-identical to the placeholder it replaced.** Visits and
  revenue are separate charts on purpose; a shared axis would need a second y-scale, and
  dual-axis charts invite correlations the scaling invented.
- Empty states are deliberate: revenue capture is optional per scan, so "no revenue" is
  ordinary. The page explains where the number comes from rather than drawing a confident
  zero.
- Smoke +9 assertions: gap-filling, 24-hour bucket integrity, series/hours/total
  agreement, ranking and caps, the 7d window, junk range falling back to 30d, and auth.
- **Not built**: RFM segments (deferred until the shape is proven — they also need a
  thresholds settings UI) and demographics (we collect neither age nor gender, so those
  Perkstar panels would be fabricated). The placeholder's old promise of "member journey
  conversion" is also still outstanding.

### Day 16 — Card design system (stamp art + per-program editor + Apple strip)
- ✅ **Pushed, deployed and verified on a physical iPhone (2026-09-18.)** Shipped as
  `80a9ac9` + `9f9c4d2`, plus the follow-up fix `8bdc4bf`. That line of work became
  `main` when the repo got a trunk on 2026-09-25.
- **`packages/shared/src/card-art.ts`** — one dependency-free SVG renderer feeding the
  customer card page, the Apple Wallet strip and the dashboard preview, so they cannot
  drift. 10 tintable icons; `balancedColumns()` fills rows evenly (6→3×2, 10→5×2) instead
  of leaving a 5+1 hole; `renderCardStrip()` re-lays the badges for the wallet's ~3:1 band.
- **Design storage** in `loyalty_programs.config_json.design` — **no migration**, the
  polymorphic-config convention paying off again. `PATCH /v1/programs/:id/design` merges
  rather than replaces so rules can't be clobbered; hex validated at the API boundary and
  sanitised at render (the SVG is injected into a customer-facing page).
- **Apple Wallet**: `strip.png` @1x/2x/3x via `pass.addBuffer()`, pass colours from the
  design, `primaryFields` left empty because a storeCard paints it over the strip. Strips
  cached in a bounded LRU — `buildPkPass` runs on every device pull (296 ms → 0.017 ms).
- **Dashboard**: live per-program design editor in `/dashboard/card-builder` (icon,
  colours, badge style, pattern + opacity, labels) with phone preview; `/dashboard/cards/[id]`
  gained a customer-view preview and a link to the customer card page.
- Verified: typecheck, production build, smoke 108/108, a real `.pkpass` unpacked to confirm
  strip dimensions and `pass.json`. Google Wallet hero image still not wired.
- **Verified against production 2026-09-18**, which retired the two open risks:
  - `@resvg/resvg-js` loads and rasterises inside the `node:20-alpine` (musl) api
    container. Note it is reached through a *dynamic* `await import()` in
    `routes/public.ts` and `routes/apple-wallet.ts`, so a clean startup log proves
    nothing about it — it has to be exercised.
  - A live stamp pass pulled over HTTPS came back 141,454 bytes carrying
    `strip.png` / `@2x` / `@3x` at exactly 375×123 / 750×246 / 1125×369, all three
    in the manifest, `primaryFields` empty. The same pull for a points card is
    7,843 bytes with no strip — correct, strips are stamp-only. Installed and
    rendered on a physical iPhone.
- **Fixed on the way through**: the strip and the pass body resolved their background
  through two different fallback chains, so any program with no saved design got a
  `#14271C` strip on a `#000000` pass — a visible seam on every unedited card.
  `pass-builder.ts` now merges the design once, using the same
  `defaults < merchant brand colour < saved design` precedence the customer page
  already documented, and paints both surfaces from it.
- Decisions recorded in `docs/card-design/README.md`: mirror Perkstar's full template
  catalogue using *original* single-colour tintable SVG motifs (94 names extracted; T–Z
  missing from the capture). `"icon-tile"` is a placeholder until those motifs exist.
- `/dashboard/card-builder` is **no longer a placeholder**. (`/dashboard/analytics` was
  still one at the time of writing — resolved in Day 17.)

### Day 15 — Revenue capture + dashboard come-alive
- **The lever from the Perkstar tear-down**: no POS integration, ever. Staff optionally type the sale amount and every monetary number is derived from that one input.
- Migration `008_card_event_amount`: `card_events.amount_cents BIGINT NULL` + `merchants.currency_code CHAR(3) DEFAULT 'EUR'`. No new index — 001's `INDEX (merchant_id, created_at)` is already the exact access path. **Backfills** existing `points_add` events from `delta_json.amount_euros`, so revenue is correct on first render instead of starting at zero.
- `NULL` amount means "not captured", deliberately distinct from `0` ("a real zero-value sale"). Every aggregate filters `amount_cents IS NOT NULL` so skipped scans never drag the AOV denominator down.
- Money crosses the wire in **euros** (what a human types) and is stored as **integer cents** (floats aren't money). One sanctioned crossing: `euroToCents()` in `packages/shared`, using `Math.round` because `12.34 * 100` is `1233.9999999999998` in IEEE-754 and a truncating cast silently loses a cent.
- Two capture paths, because the UX constraints genuinely differ:
  - **Pre-capture** — optional `{ amount }` body on `POST /v1/cards/:id/stamp` and `/redeem`, and on `POST /v1/scan`. Used by the manual buttons on `/dashboard/cards/[id]`, where the click is deliberate.
  - **Post-capture** — new `PATCH /v1/cards/:id/events/:eventId/amount`. Used by the **scanner**: a stamp must apply the instant the QR is read, because the once-per-day rule can reject it, and making staff type an amount only to be told "already stamped today" is the worse ordering. So the stamp lands, then the success card offers an optional sale box. Skipping is a non-action — scan the next customer and it disappears.
- Points programs needed no new prompt at all: they already collect the bill amount because it drives the points maths, so `addPointsToCard` just writes the same column.
- New `GET /v1/analytics/overview` — 7d/30d revenue, 7d transaction count, AOV (null when there are no transactions, so the UI shows a dash rather than a confident `€0.00`), and the last 10 real `card_events`.
- Overview page: a money KPI row, an empty-state hint explaining where the numbers come from, and an activity feed now reading **actual events** instead of each card's `last_event_at` — so a card stamped three times today shows three entries, each with its own amount. Card-detail timeline shows captured amounts too.
- Smoke 108 assertions (13 new). Revenue checks are **deltas against a baseline snapshot**, not absolutes, so an unrelated test added above won't break them. Covers: amount recorded / skipped-stays-null, overview deltas, retro-attach, 400 on attaching revenue to a `signup` event, 404 on unknown event, 404 on an event belonging to a different card, 400 on `amount=0`, scan-with-amount, and feed ordering.

### Day 14 — Multi-program type: points programs with per-batch expiry
- Second program type alongside stamps. Customer earns N points per €1 spent; threshold of points = free reward. Each "add transaction" creates its own batch row with an optional expiry timer (Starbucks-style). Redemptions deduct FIFO from oldest non-expired batches.
- **Zero DB migration on existing tables** — Day 1's polymorphic columns (`loyalty_programs.program_type`, `loyalty_programs.config_json`, `loyalty_cards.card_state`) already handled this. Migration `007_points_batches` only adds the new ledger table.
- Shared types: `PointsProgramConfig` + `PointsCardState` as discriminated unions; `ProgramCreateInput` unifies stamp + points via `z.discriminatedUnion("programType")`. Legacy `POST /v1/programs` callers (no `programType`) default to stamp.
- New endpoint `POST /v1/cards/:id/add-points` (body `{amount}`) — computes `points = floor(amount × points_per_euro)`, writes a batch row, recomputes cached balance, emits a `points_add` card_event. `POST /v1/cards/:id/redeem` now dispatches by program_type — calls `redeemPointsCard` which FIFO-deducts the reward threshold from oldest non-expired batches under `FOR UPDATE`.
- Wallet rendering (Google + Apple) is now type-aware via discriminated `ProgramForWallet`/`CardForWallet`. Apple pass shows `POINTS 420 / 1000` header with notification `"You have 420 points — keep going!"` on add-transaction. Falls back gracefully if type ↔ state mismatch.
- New daily cron at 04:00 Europe/Amsterdam: `runPointsExpirySweep` finds batches with `expires_at < NOW` + `points_remaining > 0`, zeroes their remainders, recomputes card balance, increments `card_state.total_expired`, PATCHes wallet, sends customer "X points expired" message. Manual trigger at `POST /v1/sweeps/run/points-expiry`.
- Dashboard create-program form gains a Stamps/Points type selector with conditional config inputs (points-per-euro default 1, points-for-reward, optional batch-expiry days). Card detail page shows correct unit + an "Add transaction (€)" input with live "= N points" preview instead of "+1 stamp". Cards list shows indigo "Points" pill + the right unit. Public `/c/[qrToken]` page renders points or stamps based on `unitLabel`. (The scan flow for points landed shortly after, via the `needs_amount` step in `ScanResult` — see Day 15.)
- Smoke 95 assertions (13 new for points: create program, enrol, three add-transactions with varied €, three FIFO redemptions, insufficient-balance 400, amount=0 400, points-expiry sweep, public view shape).

### Day 13 — Polish bundle (repo rename, smoke in CI, B2 backup code)
- GitHub repo renamed `sippzytech/stampdeck` → `sippzytech/onusclub`. Local remote URLs updated on Mac + VPS (GitHub auto-redirects old URLs as a safety net).
- `.github/workflows/ci.yml` gains a `smoke` job alongside `typecheck-and-build`: spins up a MySQL 8.0 service container, applies migrations, starts the api in background, runs the 82-assertion (now 95-assertion) smoke. Gates every PR on full end-to-end behavior instead of just `tsc`. Catches: `NODE_ENV=production` dropped pnpm devDeps, missing config env vars at module-import time, smoke dev-mode assertions colliding with prod-mode api, wallet-unconfigured paths returning 'failed' deliveries.
- `scripts/backup-mysql.sh` extended with optional Backblaze B2 upload after gzip. Reads `B2_KEY_ID` / `B2_APP_KEY` / `B2_BUCKET` from `.env`; missing creds / missing `b2` CLI = WARN+skip (local backup still completes; B2 outage doesn't break local safety net). Container default renamed `stampdeck-mysql` → `onusclub-mysql`. Backup filenames `stampdeck-...sql.gz` → `onusclub-...sql.gz` (prune step still matches both for transition). DEPLOY.md §9 expanded with B2 signup + `b2` CLI install + `.env` lines + manual verification runbook.

### Day 13 — VPS migration + Phase B rename (`stampdeck` → `onusclub`)
- Code-level rename across pnpm package names (`@stampdeck/*` → `@onusclub/*`, 67 .ts/.tsx/.json files), Docker container + image names (`stampdeck-api` → `onusclub-api`, etc.), Traefik router/service labels, Dockerfile build filters, and human-readable docs.
- **Deliberately NOT renamed**: MySQL DB name (`stampdeck`), MySQL user (`stampdeck`), Docker volume (`stampdeck_mysql`), VPS deploy dir (`/docker/stampdeck/`), GitHub org (`sippzytech`), Google Wallet issuer (`sippzy-wallet`). Renaming any of these risks data loss or breaks existing scripts for zero user-visible benefit. Customers never see these names.
- `docker-compose.prod.yml` gains optional `DOMAIN_API_LEGACY` / `DOMAIN_WEB_LEGACY` env vars for a no-downtime migration window — primary router serves the new domain, legacy router serves the old. Default `_disabled_` sentinel keeps the legacy router inert when unset.
- DNS cutover via Netlify (NS1 manages onusclub.com): `onusclub.com` apex + `www` → Netlify marketing site (separate repo, not in scope here); `api.onusclub.com` + `app.onusclub.com` → VPS. Both `api.sippzy.com` (legacy) and `api.onusclub.com` (primary) route to the same containers during transition.
- Verified end-to-end on iPhone via `https://api.onusclub.com`: pass downloads + adds to Wallet + live-updates on stamp via APNs, same flow as the sippzy.com setup. Legacy sippzy.com routes confirmed still working.

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

### Wallet production approval ✅ **DONE — approved 2026-10-02**

Google Wallet is **out of demo mode**. Any Google account can now save a pass; the
allowlist no longer applies. Approved against issuer `3388000000023208694` /
merchant `BCR2DN6D5KYJPGBL`, region NL. **No code change was required** — the
LoyaltyClass / LoyaltyObject / save-JWT flow has worked since Day 4; the issuer simply
flipped state. This was the longest-running open item in the project, first raised on
Day 4.

Getting there took a detour worth remembering: the original issuer could never have been
approved, and nothing in the console said so. Details below.

- **Update 2026-10-02**: the original issuer `3388000000023150410` turned out to be unapprovable — it sat on an India payments profile whose country is immutable and which requires PAN/GSTIN. Google support confirmed issuers cannot be re-associated. A new business + issuer `3388000000023208694` was created on the Netherlands profile `4896-3145-4976`, production cut over to it, and publishing access requested. Everything below describes the original attempt.
- Until approved, only Google accounts on the test users allowlist can save passes.
- **Apple Wallet is not affected** — Apple Developer Program accepts individual enrollment, our `.pkpass` flow is production-ready and live.
- **Both prior blockers are now cleared** (confirmed 2026-08-23):
  1. ✅ **KvK-registered NL entity** — friend has delivered the details (KvK number, legal name, address, contact). That entity's name will appear on the Google Wallet pass as issuer.
  2. ✅ **Marketing site** — live at `https://onusclub.com` with `/privacy` and `/terms` reachable (verified `200 OK`).
- **What's left (Sanchit-driven, ~half-day of forms + 1-3 day Google review):**
  1. Log into <https://pay.google.com/business/console/> for the existing issuer.
  2. Fill "Business information" with the friend's KvK-registered details + `onusclub.com` + `/privacy` + `/terms` + logo.
  3. Submit for production approval. Google reviews in 1-2 business days typically.
  4. Once approved: no code change needed — the LoyaltyClass/Object flow already works; it just becomes savable by any Google account.
- See `/Users/sanchit/.claude/projects/-Users-sanchit-Projects-stampdeck/memory/project_google_wallet_kvk.md` for the historical log of how this blocker was recovered from a lost pre-compaction summary.

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

### ~~Expiry input on Program create form~~ ✅ ALREADY DONE *(confirmed 2026-10-05)*

This was listed as outstanding but `create-program-form.tsx` has carried the `expiryDays`
input since Day 9. Nothing to do — the entry was stale.

### Superseded: Expiry input on Program create form *(original note)*
- The API accepts `expiryDays` (Day 9) but the dashboard's Create Program form doesn't surface a UI for it yet.
- One number input + a small "leave blank for no expiry" hint.

### ~~Audience filter display on broadcast detail page~~ ✅ ALREADY DONE *(confirmed 2026-10-05)*

Also stale — the broadcast detail page renders `describeAudience(broadcast.audienceFilter)`.

### Superseded: Audience filter display *(original note)*
- The filter is stored and surfaced in `/v1/broadcasts/:id`, but the detail page doesn't render it.
- Just add a small summary line: "Sent to: customers with ≥5 stamps".

---

## Polish backlog (small, no urgency, do in any order)

User has explicitly asked these be saved for later — not picking any of them now but they're real options to come back to.

- **Owner magic-link email re-wire** (1-2 h) — `issueMagicLink` exists from Day 2; just needs to wire to `sendEmail` so owners can passwordless-login if they prefer.
- ~~**Bump GitHub Actions to v5**~~ ✅ **DONE 2026-10-05** — see the Small/cosmetic list.
- **First-merchant demo seed script** (1-2 h) — `pnpm seed:demo` drops a realistic "Café De Klep" merchant with stamp + points programs into the DB for showing the dashboard to prospects without manual setup each time.
- **Customer card archive view** (2-3 h) — `/dashboard/cards` only shows active cards; no way to see expired/blocked. Small product gap.
- **Daily/weekly merchant digest email** (2-3 h) — cron emails each merchant a summary ("This week: 12 new cards, 47 stamps, 3 redeems"). Stickiness feature.
- **Onboarding wizard for new merchants** (3-4 h) — first-time signup dumps you on an empty dashboard. A 3-step guided start (create program → share QR → invite first customer) reduces cold-start friction and converts signups to active use.

## Perkstar-inspired candidates (post-tear-down, 2026-06-29)

We walked through a paid Perkstar sandbox. Full inventory + reasoning lives in **[PERKSTAR_ANALYSIS.md](./PERKSTAR_ANALYSIS.md)**. Headline insight: **Perkstar does not integrate to POS** — they ask the merchant to type the sale amount at scan time, and derive every revenue/ROI/AOV/RFM number from that one data point. We can do the same with one column on `card_events` + one field on the scanner.

The ranked shortlist below comes from that analysis.

### Day 15 — "Revenue capture + dashboard come-alive" ⭐ ✅ SHIPPED
Items 1 + 5 + 6 + 7 from the COPY list. See the Day 15 entry in the history above for what actually landed and why the design differs from the original sketch (post-capture on the scanner rather than a pre-scan prompt). **Unlocks**: RFM (Day 17), AOV/ROI everywhere, demo-worthy Overview.

### After Day 15, in priority order:
| Day | Bundle | Effort | Dependency |
|---|---|---|---|
| **16** | CSV customer import/export + add-customer field alignment (last/first/phone-cc/email/DOB) | 1 day | — |
| **17** | RFM segments (9 buckets) + editable thresholds settings page | 2-3 days | Day 15 (needs revenue data) |
| **18** | Industry template gallery (10-15 OnUsClub-branded card designs) | 2-3 days | — |
| **19** | Weekly merchant digest email (already on polish backlog) | 2-3 h | Day 15 (richer data) |
| 20+ | Referral tracking + UTM capture on enrol form (bundle) | 2-3 days | — |

### Deferred from Perkstar tear-down (low ROI for our user base or too big):
- **Push automation rules** ("event → wait → message") — 4-5 days, needs scheduler. Defer.
- **Geo-push (Apple Wallet `locations[]`)** — PassKit supports it, UX messy. Phase 3.
- **Two-way push reply / Inbox** — only works on Google Wallet. Probably skip permanently.
- **Tier system + soft-walls** — pair with Stripe billing when that lands.
- **Scanner as standalone PWA** — defer until staff complain about the dashboard wrapper.
- **Feedback / Google Reviews loop** — 4-5 day feature, deserves its own week.
- **Multipass / Gift card / Cashback / Coupon as separate program types** — covered by Stamp + Points engine already. Skip.
- **Telegram bot stats / 100+ templates** — diminishing returns. Skip.

---

## Likely next steps (legacy backlog, unrelated to Perkstar tear-down)

Still relevant, none depend on each other.

| Idea | Effort | Value |
|---|---|---|
| **Stripe billing** for the premium gate | 1-2 days | Turn fake unlock into real revenue. User flagged this as the *"last part"* to do — pairs with the tier system from Perkstar tear-down. |
| **Google Wallet production approval** (submit issuer to Google) | half day setup + 1-3 day Google review | Unlocks **any Google account** to save passes (not just allowlisted). Apple already production-ready. **BOTH prior blockers cleared as of 2026-08-23** — KvK entity + marketing site + policy URLs all in hand. Now just needs Sanchit to fill the Business Console form. See Deferred section above for the exact steps. |
| **Resend domain verification** for `sippzy.com` or `onusclub.com` | ~30 min setup + DNS propagation | Required to email real customers. Currently `EMAIL_FROM` is on Resend's test domain → only delivers to `sippzy.official@gmail.com`. |
| **Backblaze B2 offsite backup** (code already ready, just needs setup) | 10 min user-side | Just sign up + 3 env lines on VPS. See `HANDOFF.md` for the recipe; deferred earlier on lack of business email. |
| ~~**Scan flow for points programs**~~ | — | ✅ Done. The `needs_amount` step in `ScanResult` + the scanner's `awaiting_amount` state cover it. |
| **Membership program type** (third type, paid subscription) | 2-3 days | Pairs naturally with Stripe — membership is essentially a subscription with a paid pass. Defer until billing is done. |
| **Drop sippzy.com legacy Traefik routes** | 5 min code, 10 min deploy | Wait ~1-2 weeks of onusclub.com stability first. Old saved wallet passes still point at sippzy.com. |
| **Owner magic-link email** (re-wire) | 1-2 h | Optional passwordless flow for owners who prefer it. |
| **Wallet/card visual customization** | TBD | Deliberately deferred for a focused "designed properly with AI" project. Overlaps with Day 18 industry template gallery — could combine. |

---

## How to onboard a fresh Claude session

If a new Claude account opens this repo cold:

1. **Read [CLAUDE.md](./CLAUDE.md)** — stack, ports, conventions, secrets locations.
2. **Read this file (ROADMAP.md)** — full history + deferred + next steps.
3. **`git log --oneline --all`** — every day is a branch + a commit with a detailed message.
4. **Open the latest branch** (typically the most recent `day-N-*` branch).
5. **Read [DEPLOY.md](./DEPLOY.md)** if anything deploy-related is being asked.

That should be enough to get fully up to speed in 10 minutes. Memory files (`~/.claude/projects/.../memory/`) are bonus context but **not required** — everything load-bearing lives in the repo.
