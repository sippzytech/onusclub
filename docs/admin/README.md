# Platform admin

The master dashboard — one surface that sees across every café on the platform,
rather than inside one. It answers "who is actually using this, and is it
working for them?", and lets us fix a customer's balance when something has
gone wrong.

Everything else in this codebase is tenant-scoped by a hand-written
`WHERE merchant_id = ?`. This is the deliberate exception, which makes it the
most security-relevant thing in the repo.

---

## Granting access

There is **no API and no UI** for this, on purpose. Membership is a row in
`platform_admins`, inserted by hand against the database.

```sql
-- On the VPS:
--   docker compose -f docker-compose.prod.yml exec mysql \
--     mysql -u stampdeck -p stampdeck

INSERT INTO platform_admins (staff_user_id, note)
SELECT id, 'founder' FROM staff_users WHERE email = 'you@example.com';
```

The account must already exist — a platform admin is an ordinary owner or staff
account with an extra capability, not a second kind of login. Sign up normally
first, then run the INSERT for that user.

Verify:

```bash
curl -s -H "authorization: Bearer $JWT" https://api.onusclub.com/v1/admin/whoami
```

A `404` means the grant is not in place (see *Why 404* below). A JSON body with
your user id means it is.

## Revoking access

```sql
DELETE FROM platform_admins WHERE staff_user_id = '...';
```

This takes effect on the **next request**, not when the token expires. That is
the single property the design exists for — see below.

---

## Why a table and not a role

The obvious shape is `staff_users.role = 'superadmin'`. It is wrong here, for
three reasons that are all properties of code in this repo:

1. **`role` lives in the JWT** (`apps/api/src/auth/jwt.ts`), which has a 7-day
   expiry and no denylist. Revoking a role-based privilege would take a week.
2. **`verifyJwt` never validated `role`.** It checked `userId` and
   `merchantId` and passed anything else through as a well-typed value, so a
   token minted with `role: "superadmin"` verified cleanly. That hole is now
   closed with an allow-list, but the lesson stands: a privilege carried in a
   bearer token is only as strong as the weakest thing that can mint one.
3. **`POST /v1/staff` is one field away from being an escalation path.** It
   hardcodes `'staff'` today and `StaffCreateInput` has no `role` — but the day
   merchants can choose their staff's role, an enum value is exactly what an
   attacker asks for. A separate table is not reachable from any
   merchant-facing write path, whatever that endpoint grows into.

So the check hits the **database on every `/v1/admin/*` request**. One
primary-key read, for a caller population of one.

> **Do not cache it.** Caching trades the only property that justifies the
> design — instant revocation — for an unmeasurable saving. The admin smoke
> suite asserts that a `DELETE` locks the holder out while their token is still
> valid; if that assertion fails, the check has been moved into the token or
> memoised.

Similarly, `platform_admins` must have exactly **one read path** in the
application: `apps/api/src/admin/authorize.ts`. A CI step greps for any other
reference in `apps/api/src/**/*.ts` and fails the build, because a second query
is how this would quietly acquire a weaker check.

## Why 404 and not 403

`requirePlatformAdmin` answers **404** to anyone without a grant. A 403 would
confirm that the namespace exists and that some accounts can reach it, which is
a small leak and a large invitation. The same reasoning applies to the web side:
`/admin/*` renders Next's not-found page rather than redirecting to `/login`.

Denials log a pino `warn` carrying the user, merchant, path and IP. A café's own
session reaching that path is either a bug in our UI or someone probing, and
both are worth seeing in the logs rather than discovering later.

---

## Audit

Two layers, and the lower one is the important one:

- **`card_events` with `event_type = 'manual_adjust'`** — balance adjustments
  are written where the **merchant can see them**, on their own dashboard,
  labelled "Adjusted by OnUsClub". An operator changing a café's data invisibly
  is the real risk in this feature, and the fix is that they cannot do it
  invisibly. `card_events.staff_user_id` carries who did it.
- **`admin_audit_log`** — append-only, operator-side. Covers writes that have
  no card to attach to (suspending a merchant, changing a fee, forcing a
  password reset), with the before/after of each. The row is written on the
  **same transaction** as the change, so a mutation that forgets to audit
  itself cannot commit.

Every admin write requires a stated `reason`, minimum 3 characters, with no
default. An adjustment with no reason recorded is indistinguishable from a
mistake.

```sql
-- what has been done to one café
SELECT created_at, actor_email, action, reason, before_json, after_json
  FROM admin_audit_log
 WHERE merchant_id = '...'
 ORDER BY created_at DESC;
```

---

## Deliberately not built

| Not in v1 | Why |
|---|---|
| Impersonation ("log in as this café") | Product owner's call. Read + adjust covers the real support cases without a second session path to get wrong. |
| `DELETE /merchants/:id` | The cascade is irreversible. `status = 'suspended'` covers every real need. |
| Editing programs or card design | Changes the deal for customers who already hold a card. |
| Editing customer PII | GDPR-shaped; a deletion request is a different workflow, not a text field. |
| Sending broadcasts as a merchant | Messages a café's customers under the café's name without them knowing. |
| Changing `owner_email` | Two globally-unique columns across two tables — a small feature with a two-table invariant. |

## Money

There is **no "Profit/Loss" figure anywhere**, and that is a decision rather
than an omission. `card_events.amount_cents` is the café's self-reported sale
amount, it is sparse (NULL = staff skipped the prompt, which is not a €0 sale),
and there is no cost-of-goods data in the system. A number labelled "profit"
built on that would be trusted.

What is shown instead are **health signals** — dormancy, dead enrolments,
wallet adoption, capture rate, sales per reward given — which answer the same
underlying questions honestly.

`merchants.monthly_fee_cents` is the one revenue figure, and it is simply what
each café agreed to pay, typed in by hand. NULL renders as "—", never €0:
a café on a free pilot and a café whose fee nobody recorded are different
facts. When Stripe Billing lands (ROADMAP item 9) this becomes the fallback for
merchants without a subscription.

---

## Testing

```bash
# needs the api running and DATABASE_URL pointed at the same database
pnpm --filter @onusclub/api run smoke:admin
```

The main suite (`pnpm smoke`) covers the negative side: that no owner, no staff
member, no unauthenticated caller and no forged-role token can reach any
`/v1/admin` path. That path list is a constant at the top of the admin block in
`apps/api/scripts/smoke.ts` — **add a line to it for every new admin
endpoint**, so a missing denial test is a visible gap rather than silence.
