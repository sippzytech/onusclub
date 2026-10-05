# Security review — 2026-10-05

Backlog item 19, the pass deliberately scheduled last. A review is only useful
if it records what was checked and found **clean** as well as what was fixed —
otherwise the next person repeats the work, or assumes an area was covered
when it was not.

Scope: the api, the Next web app, the CI pipeline and the production compose.
Not in scope: the VPS host itself, Traefik's configuration, and the Netlify
marketing site.

---

## Fixed

### 1. No rate limiting anywhere — the real finding

`POST /v1/auth/login` accepted unlimited password guesses at whatever rate a
script could manage. `POST /v1/auth/forgot-password` sent unlimited mail to any
address that existed — a mailbox-flooding tool aimed at our own customers, and
a way to exhaust the shared Resend daily quota and take every real card invite
down with it.

Added `src/http/rate-limit.ts`: login 10 per 15 min, password reset 5/hour,
signup 5/hour, public enrolment 30 per 10 min.

**Login is keyed on address AND submitted email.** Address alone lets one
person behind an office NAT lock out their colleagues; email alone lets anyone
lock a known owner out of their own account from anywhere, which is a
denial-of-service handed over for free. Asserted both ways in smoke.

Hand-rolled rather than `express-rate-limit`: there is one api container, so
the library's pluggable store buys nothing without Redis, and it would still
need the X-Forwarded-For resolution below. A fixed-window counter in a Map is
arithmetic — the failure mode of getting it slightly wrong is "off by one
request", not "bypassable". **Limits are in-memory**, so they reset on restart
and would multiply per replica; swap to express-rate-limit + Redis when api
scales past one container.

### 2. ⚠️ The rate limiter was nearly worse than useless — found while testing it

Login, signup and password reset all go **browser → Next route handler → api**.
The Next handler called the api without forwarding the caller's address, so the
api saw the **web container** for every request on the platform.

With IP-keyed limits that is not a small bug. The whole platform would have
shared one bucket: five signups an hour *in total*, and any single attacker
able to lock out every user at once. The control would have been strictly
harmful.

`apiFetch` now takes `clientIp`, and all four auth proxies pass
`forwardedFor(req)`. Verified end to end: two browsers at different addresses
hitting the same account through the proxy get separate buckets — A hits 429 at
attempt 11, B still gets a normal 401.

### 3. `JWT_SECRET` minimum was 8 characters

This is the HS256 signing key for every session. Eight characters is
brute-forceable offline from one captured token in minutes, and whoever
recovers it can mint a token for any user of any merchant — total takeover
across every café.

Raised to 32, as a hard startup failure rather than a warning, with an error
message that gives the `openssl rand -base64 48` command.

> 🚨 **This can stop production booting.** If the deployed `JWT_SECRET` is
> shorter than 32 characters the container will refuse to start. Check and
> rotate it *before* deploying. Rotating invalidates all sessions — currently
> four test accounts.

### 4. No security headers

None on either app. Added `nosniff`, `X-Frame-Options: DENY`,
`frame-ancestors 'none'`, `Referrer-Policy`, and HSTS (production only — in dev
it pins localhost to HTTPS in your browser, which is unpleasant to undo).
`X-Powered-By` disabled on both.

`/c/:path*` gets **`no-referrer`** specifically: the customer card URL carries
`qr_token` in the path and those pages link out to Google and Apple Wallet.

**No Content-Security-Policy, deliberately.** Next's App Router inlines
bootstrap scripts and streams RSC payloads, so a useful CSP needs per-request
nonces threaded through middleware — and this app has no middleware on purpose.
A CSP loose enough to work without nonces needs `'unsafe-inline'`, which
permits the exact thing it exists to prevent. Better none and knowing it than
one and believing it.

### 5. The admin tripwire logged the wrong address

`requirePlatformAdmin` logged `req.ip` on every denial — behind Traefik, the
proxy. The tripwire built to spot someone probing `/v1/admin` recorded the same
address for every request and could not tell a probe from our own UI.
`routes/leads.ts` had already solved this and documented it; a second copy had
drifted. Hoisted to `src/http/client-ip.ts`, one implementation, and the
address is now **hashed** before logging since an IP is personal data.

### 6. No dependency scanning

Nothing would have reported a published CVE in express, mysql2, jsonwebtoken or
passkit-generator. Added `.github/dependabot.yml`: weekly, grouped so a routine
week is one PR rather than fifteen, with majors ignored for `passkit-generator`
(a bad pass is invisible until an iPhone refuses to open it) and `mysql2` (its
RowDataPacket typing is load-bearing across every query).

---

## Checked and clean — recorded so it is not re-reviewed blindly

**SQL injection.** Every statement is parameterised. The template-literal SQL
that exists interpolates only constant fragments (`CARD_SELECT`,
`EVENT_SELECT_COLUMNS`, `CUSTOMER_SELECT`), generated `?` placeholder lists
from array length, and `sets.join(", ")` built from a fixed allow-list of
column assignments. No request data reaches SQL unparameterised.

**CSRF.** The session cookie is `httpOnly` + `sameSite: "lax"`, so the browser
does not attach it to cross-site POST/PATCH/DELETE at all — classic form-CSRF
is already blocked without a token. Lax *does* send the cookie on cross-site
top-level GET, so every state-changing GET was audited: there is exactly one
(`/v1/public/c/:qrToken/apple-pass` lazily generating an Apple auth token), and
it is an unauthenticated public route keyed by a secret token, so there is no
ambient authority to ride. Not a finding.

**CORS.** The api sets no CORS headers and the browser default therefore blocks
cross-origin reads. Auth is a `Authorization` header, which is not a
simple header, so any cross-origin attempt triggers a preflight that fails.

**Tenant isolation.** Proven behaviourally by the isolation block in
`scripts/smoke.ts` — every `:id`-taking endpoint attempted with the wrong
tenant's token, plus the deliberate `/v1/admin` exception refused for an owner,
a staff member, an unauthenticated caller and a forged-role token.

**Error leakage.** `errorHandler` returns a generic `internal error` for
anything unrecognised; only `ApiError` messages reach a client.

**Secrets.** None committed. The Google Wallet key is a mounted file, every
other secret is an env var, and `scripts/check-env-wiring.mjs` in CI asserts
each one is actually wired through prod compose.

**SSRF.** One outbound fetch takes a caller-supplied URL — the Maps short-link
resolver in `routes/locations.ts`. It is gated on the parsed `URL.hostname`
being one of two Google hosts over https. Three attack shapes tested
(`http://127.0.0.1`, `https://example.com`, both carrying the `goo.gl`
substring) and none made a request.

---

## Accepted, with reasoning

**`qr_token` is a bearer credential in a URL.** Anyone holding
`/c/<64-hex-token>` can view that card and add the pass. That is inherent: the
QR code *is* the credential, and the customer must be able to open it from a
printed code with no account. 64 hex characters is not guessable, the pages now
send no referrer, and the blast radius of one leaked token is one card. The
alternative — an account per customer — is a different and much worse product.

**No account lockout beyond rate limiting.** Lockout is itself a
denial-of-service: anyone who knows an owner's email can lock them out. The
rate limit slows guessing without handing over that lever.

**Password minimum is 8 characters.** Short by modern guidance, but NIST
explicitly favours length over composition rules and bcrypt plus the new rate
limit covers the realistic attack. Raising it would lock out existing accounts
or need a forced reset, for a small gain.

**In-memory rate limits.** See the caveats in `src/http/rate-limit.ts`. The
upgrade path is Redis, and the trigger is a second api container.

---

## Still open

- **CodeQL** is not configured. Dependabot covers dependencies; static analysis
  of our own code does not exist. Worth adding, lower value than the above.
- **Production is in Mumbai** (ROADMAP item 1). Not a code issue, and the
  largest remaining compliance exposure. Trigger: before the first real
  person's name enters the database.
- **No alerting.** Rate-limit trips and admin-denial tripwires write pino
  `warn` lines nobody watches. The logs are now worth watching; nothing
  watches them.
