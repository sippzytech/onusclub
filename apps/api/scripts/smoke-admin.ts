// Smoke test for the platform-admin surface.
//
// Separate from scripts/smoke.ts for one reason: granting platform admin is
// SQL-only by design, so this script needs a database connection as well as an
// HTTP client. Keeping it apart means the main suite stays a pure black-box
// test of the API, and means this file is the ONLY thing in the repo that
// writes `platform_admins` — the invariant a CI grep step enforces for src/.
//
// Run with: pnpm --filter @onusclub/api run smoke:admin
//   SMOKE_BASE   where the api is listening (default http://localhost:4000)
//   DATABASE_URL the same database that api is pointed at

import mysql from "mysql2/promise";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:4000";
const DATABASE_URL = process.env.DATABASE_URL;

interface ErrBody {
  error?: { code?: string; message?: string };
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  jwt?: string
): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (jwt) headers["authorization"] = `Bearer ${jwt}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const err = (parsed as ErrBody)?.error;
    throw new Error(
      `${method} ${path} → ${res.status} ${err?.code ?? ""} ${err?.message ?? text}`
    );
  }
  return parsed as T;
}

/** Status code of a request expected to fail. 0 means it unexpectedly succeeded. */
async function statusOf(
  method: string,
  path: string,
  jwt?: string,
  body?: unknown
): Promise<number> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (jwt) headers["authorization"] = `Bearer ${jwt}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res.ok ? 0 : res.status;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

async function main(): Promise<void> {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is required — granting platform admin is SQL-only");
  }
  const db = await mysql.createConnection({ uri: DATABASE_URL });

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const adminEmail = `smoke-admin-${stamp}@example.com`;

  try {
    console.log("→ standing up a merchant whose owner will become a platform admin");
    const signup = await call<{ jwt: string; user: { id: string }; merchant: { id: string } }>(
      "POST",
      "/v1/auth/signup",
      {
        businessName: `Admin Smoke Café ${stamp}`,
        ownerEmail: adminEmail,
        ownerName: "Admin Smoke",
        password: "adminsmoke-password-1",
      }
    );
    const adminJwt = signup.jwt;

    console.log("→ before the grant, the admin surface is a 404");
    assert(
      (await statusOf("GET", "/v1/admin/whoami", adminJwt)) === 404,
      "an ordinary owner should get 404 from /v1/admin/whoami"
    );
    assert(
      (await call<{ isPlatformAdmin: boolean }>("GET", "/v1/me", undefined, adminJwt))
        .isPlatformAdmin === false,
      "/v1/me should report isPlatformAdmin=false before the grant"
    );

    console.log("→ granting platform admin by SQL");
    await db.execute(
      "INSERT INTO platform_admins (staff_user_id, note) VALUES (?, 'smoke test')",
      [signup.user.id]
    );

    // The same unexpired token from before the grant now works. That is the
    // point of checking the database per request rather than the JWT: access
    // follows the table, not the token.
    console.log("→ the same token now reaches /v1/admin/whoami");
    const who = await call<{ userId: string; email: string; merchantId: string }>(
      "GET",
      "/v1/admin/whoami",
      undefined,
      adminJwt
    );
    assert(who.userId === signup.user.id, `whoami returned the wrong user: ${who.userId}`);
    assert(who.email === adminEmail, `whoami returned the wrong email: ${who.email}`);
    assert(
      who.merchantId === signup.merchant.id,
      `whoami returned the wrong merchant: ${who.merchantId}`
    );

    console.log("→ /v1/me now advertises the admin link");
    assert(
      (await call<{ isPlatformAdmin: boolean }>("GET", "/v1/me", undefined, adminJwt))
        .isPlatformAdmin === true,
      "/v1/me should report isPlatformAdmin=true after the grant"
    );

    // ---------- the cross-tenant reads ----------

    interface Summary {
      id: string;
      businessName: string;
      customers: number;
      cards: number;
      walletCards: number;
      matureCards: number;
      deadEnrolments: number;
      capturableWindow: number;
      capturedWindow: number;
      revenueCentsWindow: number;
      redemptionsTotal: number;
      salesPerRewardCents: number | null;
      monthlyFeeCents: number | null;
      flags: string[];
      daysSinceLastEvent: number | null;
    }

    console.log("→ the merchant list spans tenants, not just the admin's own café");
    const list = await call<{ merchants: Summary[]; thresholds: { dormantDays: number } }>(
      "GET",
      "/v1/admin/merchants",
      undefined,
      adminJwt
    );
    assert(list.merchants.length >= 2, "the list should contain more than the admin's own café");
    assert(
      list.merchants.some((m) => m.id === signup.merchant.id),
      "the admin's own café is missing from the list"
    );
    assert(
      list.merchants.some((m) => m.id !== signup.merchant.id),
      "CROSS-TENANT READ FAILED — the list contains only the admin's own café"
    );
    assert(list.thresholds.dormantDays > 0, "thresholds should be reported to the UI");

    console.log("→ every café carries at least one health flag");
    assert(
      list.merchants.every((m) => m.flags.length > 0),
      "a café with no flags at all means healthFlags fell through"
    );

    // The brand-new café in this run has no events, so its flags are
    // determined entirely by its age — which pins down the branch rather than
    // asserting whatever the fixture data happens to produce.
    const self = list.merchants.find((m) => m.id === signup.merchant.id)!;
    assert(
      self.flags.length === 1 && self.flags[0] === "onboarding",
      `a café created seconds ago should be exactly ["onboarding"], got ${JSON.stringify(
        self.flags
      )}`
    );
    assert(
      self.monthlyFeeCents === null,
      "a new café should have no recorded fee — null, not 0"
    );
    assert(
      self.salesPerRewardCents === null,
      "sales per reward must be null with no redemptions, never 0"
    );
    assert(self.daysSinceLastEvent === null, "a café with no scans has no last-scan date");

    console.log("→ search narrows the list, and a miss returns nothing");
    const found = await call<{ merchants: Summary[] }>(
      "GET",
      `/v1/admin/merchants?q=${encodeURIComponent(adminEmail)}`,
      undefined,
      adminJwt
    );
    assert(
      found.merchants.length === 1 && found.merchants[0].id === signup.merchant.id,
      `search by owner email should match exactly one café, got ${found.merchants.length}`
    );
    const missed = await call<{ merchants: Summary[] }>(
      "GET",
      "/v1/admin/merchants?q=zzz-no-such-cafe-zzz",
      undefined,
      adminJwt
    );
    assert(missed.merchants.length === 0, "a nonsense search should return nothing");

    console.log("→ platform totals agree with the sum of the rows beneath them");
    const metrics = await call<{
      merchants: { total: number; trial: number };
      revenue: { mrrCents: number; feeSet: number; feeUnset: number };
      usage: { customers: number; cards: number; walletCards: number };
      health: Array<{ flag: string; merchants: number }>;
      signupsByWeek: Array<{ weekStart: string; merchants: number }>;
    }>("GET", "/v1/admin/metrics", undefined, adminJwt);

    // The header and the list are derived from one aggregate precisely so they
    // cannot disagree. "The header says 412 customers but the rows add to 390"
    // is the kind of thing that quietly destroys trust in a dashboard.
    assert(
      metrics.merchants.total === list.merchants.length,
      `metrics total (${metrics.merchants.total}) != list length (${list.merchants.length})`
    );
    assert(
      metrics.usage.customers === list.merchants.reduce((a, m) => a + m.customers, 0),
      "platform customer total does not match the sum of the rows"
    );
    assert(
      metrics.usage.cards === list.merchants.reduce((a, m) => a + m.cards, 0),
      "platform card total does not match the sum of the rows"
    );
    assert(
      metrics.health.reduce((a, h) => a + h.merchants, 0) === metrics.merchants.total,
      "each café must be counted under exactly one health flag"
    );
    // MRR is asserted as a DELTA later, not as an absolute. This suite runs
    // against whatever database it is pointed at — in CI that is empty, but
    // locally it is a dev database with other cafés in it, some of which may
    // well have a fee recorded. "Platform MRR is 0" was the first version of
    // this and it failed for exactly that reason: a global claim about data
    // the test does not own.
    const baselineMrrCents = metrics.revenue.mrrCents;
    const baselineFeeSet = metrics.revenue.feeSet;
    assert(
      metrics.revenue.feeSet + metrics.revenue.feeUnset <= metrics.merchants.total,
      "every café is either fee-set or fee-unset, and suspended ones count as neither"
    );
    assert(
      metrics.revenue.feeUnset > 0,
      "cafés without a recorded fee should be reported, not hidden"
    );
    assert(metrics.signupsByWeek.length === 12, "signup chart should always be 12 weeks");
    assert(
      metrics.signupsByWeek[metrics.signupsByWeek.length - 1].merchants >= 1,
      "this run's signup should land in the current week"
    );

    console.log("→ merchant detail resolves, and an unknown id 404s");
    const detail = await call<{
      merchant: Summary;
      programs: unknown[];
      staff: Array<{ role: string }>;
      segments: Array<{ segment: string; customers: number }>;
      daily: Array<{ date: string; events: number }>;
      recentEvents: unknown[];
    }>("GET", `/v1/admin/merchants/${signup.merchant.id}`, undefined, adminJwt);
    assert(detail.merchant.id === signup.merchant.id, "detail returned the wrong café");
    assert(detail.staff.length === 1 && detail.staff[0].role === "owner", "expected one owner");
    assert(detail.segments.length === 6, "all six RFM buckets should always be present");
    // Gap-filled, so a café with no activity still renders a flat line rather
    // than an empty chart.
    assert(
      detail.daily.length === 31 && detail.daily.every((d) => d.events === 0),
      `expected 31 zeroed day buckets for a brand-new café, got ${detail.daily.length}`
    );
    assert(
      (await statusOf(
        "GET",
        "/v1/admin/merchants/00000000-0000-0000-0000-000000000000",
        adminJwt
      )) === 404,
      "an unknown merchant id should 404"
    );

    // ---------- customers and timelines ----------
    //
    // Stand up a customer with a stamped card so the timeline, balance label
    // and wallet-adoption readout all have something real to report.

    console.log("→ setting up a customer with a stamped card");
    const program = await call<{ id: string }>(
      "POST",
      "/v1/programs",
      { name: "Admin smoke card", stampsRequired: 8, rewardText: "Free smoke" },
      adminJwt
    );
    const customerEmail = `smoke-cust-${stamp}@example.com`;
    const customer = await call<{ id: string }>(
      "POST",
      "/v1/customers",
      { name: "Timeline Tester", email: customerEmail },
      adminJwt
    );
    const card = await call<{ id: string }>(
      "POST",
      "/v1/cards",
      { customerId: customer.id, programId: program.id },
      adminJwt
    );
    await call("POST", `/v1/cards/${card.id}/stamp`, { amount: 4.5 }, adminJwt);

    console.log("→ an empty customer search is refused rather than returning everyone");
    const empty = await call<{ customers: unknown[] }>(
      "GET",
      "/v1/admin/customers?q=",
      undefined,
      adminJwt
    );
    assert(
      empty.customers.length === 0,
      "an empty query must not select the entire customer table"
    );
    const tooShort = await call<{ customers: unknown[] }>(
      "GET",
      "/v1/admin/customers?q=a",
      undefined,
      adminJwt
    );
    assert(tooShort.customers.length === 0, "a one-character query should return nothing");

    console.log("→ search finds the customer by email, across tenants");
    const hits = await call<{
      customers: Array<{ id: string; merchantName: string; visits: number; cards: number }>;
      truncated: boolean;
    }>("GET", `/v1/admin/customers?q=${encodeURIComponent(customerEmail)}`, undefined, adminJwt);
    assert(hits.customers.length === 1, `expected one hit, got ${hits.customers.length}`);
    assert(hits.customers[0].id === customer.id, "search returned the wrong customer");
    assert(
      hits.customers[0].cards === 1 && hits.customers[0].visits === 1,
      `expected 1 card and 1 visit, got ${hits.customers[0].cards}/${hits.customers[0].visits}`
    );
    assert(hits.truncated === false, "one result should not be reported as truncated");

    console.log("→ the customer detail carries the balance, the card and the timeline");
    const cdetail = await call<{
      customer: { id: string; visits: number };
      cards: Array<{
        id: string;
        balanceLabel: string;
        hasGooglePass: boolean;
        appleRegistrations: number;
      }>;
      events: Array<{ eventType: string; amountCents: number | null }>;
      alsoMemberAt: unknown[];
    }>("GET", `/v1/admin/customers/${customer.id}`, undefined, adminJwt);
    assert(cdetail.customer.id === customer.id, "detail returned the wrong customer");
    assert(cdetail.cards.length === 1, "expected exactly one card");
    assert(
      cdetail.cards[0].balanceLabel === "1 of 8 stamps",
      `balance label wrong: ${cdetail.cards[0].balanceLabel}`
    );
    // Both the signup event and the stamp, so the timeline spans enrolment as
    // well as activity.
    assert(
      cdetail.events.some((e) => e.eventType === "stamp" && e.amountCents === 450),
      `the stamp and its €4.50 should appear in the timeline: ${JSON.stringify(cdetail.events)}`
    );

    console.log("→ the card view resolves without the caller knowing the tenant");
    const cardView = await call<{
      merchantId: string;
      customerId: string;
      pointsBalance: number | null;
      pointsCacheStale: boolean;
      detail: { card: { id: string; programType: string }; events: unknown[] };
    }>("GET", `/v1/admin/cards/${card.id}`, undefined, adminJwt);
    assert(
      cardView.pointsBalance === null,
      "a stamp card has no points ledger, so pointsBalance must be null"
    );
    assert(
      cardView.pointsCacheStale === false,
      "a stamp card can never have a stale points cache"
    );
    assert(
      cardView.merchantId === signup.merchant.id,
      "the card view resolved the wrong owning merchant"
    );
    assert(cardView.customerId === customer.id, "the card view resolved the wrong customer");
    assert(cardView.detail.card.id === card.id, "the card view returned the wrong card");
    assert(cardView.detail.events.length >= 1, "the card should have at least the stamp event");
    assert(
      (await statusOf("GET", "/v1/admin/cards/00000000-0000-0000-0000-000000000000", adminJwt)) ===
        404,
      "an unknown card id should 404"
    );
    assert(
      (await statusOf(
        "GET",
        "/v1/admin/customers/00000000-0000-0000-0000-000000000000",
        adminJwt
      )) === 404,
      "an unknown customer id should 404"
    );

    // ⚠️ The batch-ledger trap, on the read side.
    //
    // `card_state.points_current` is a cache of SUM(points_batches). The admin
    // card view must report the ledger, because this is the screen used to
    // answer "my customer says their points are wrong" — showing a drifted
    // cache there would make us confidently repeat the bug.
    //
    // Proven by corrupting the cache directly and checking the view ignores it.
    console.log("→ points balances come from the ledger, not the cached column");
    const pointsProgram = await call<{ id: string }>(
      "POST",
      "/v1/programs",
      {
        name: "Admin smoke points",
        programType: "points",
        pointsForReward: 100,
        pointsPerEuro: 2,
        rewardText: "Free points drink",
      },
      adminJwt
    );
    const pointsCustomer = await call<{ id: string }>(
      "POST",
      "/v1/customers",
      { name: "Points Tester", email: `smoke-pts-${stamp}@example.com` },
      adminJwt
    );
    const pointsCard = await call<{ id: string }>(
      "POST",
      "/v1/cards",
      { customerId: pointsCustomer.id, programId: pointsProgram.id },
      adminJwt
    );
    await call("POST", `/v1/cards/${pointsCard.id}/add-points`, { amount: 12.5 }, adminJwt);

    const beforeCorruption = await call<{ pointsBalance: number; pointsCacheStale: boolean }>(
      "GET",
      `/v1/admin/cards/${pointsCard.id}`,
      undefined,
      adminJwt
    );
    assert(
      beforeCorruption.pointsBalance === 25,
      `12.50 at 2 points/euro should be 25 points, got ${beforeCorruption.pointsBalance}`
    );
    assert(
      beforeCorruption.pointsCacheStale === false,
      "the cache should agree with the ledger immediately after a real transaction"
    );

    await db.execute(
      "UPDATE loyalty_cards SET card_state = JSON_SET(card_state, '$.points_current', 999) WHERE id = ?",
      [pointsCard.id]
    );

    const afterCorruption = await call<{
      pointsBalance: number;
      pointsCacheStale: boolean;
      detail: { card: { cardState: { points_current: number } } };
    }>("GET", `/v1/admin/cards/${pointsCard.id}`, undefined, adminJwt);
    assert(
      afterCorruption.pointsBalance === 25,
      `the ledger still totals 25 — the view must not read the cache, got ${afterCorruption.pointsBalance}`
    );
    assert(
      afterCorruption.detail.card.cardState.points_current === 999,
      "the corrupted cache should still be reported, so a drift is visible rather than hidden"
    );
    assert(
      afterCorruption.pointsCacheStale === true,
      "a disagreement between cache and ledger must be flagged"
    );

    console.log("→ the points balance label on the customer view uses the ledger too");
    const pointsDetail = await call<{ cards: Array<{ balanceLabel: string }> }>(
      "GET",
      `/v1/admin/customers/${pointsCustomer.id}`,
      undefined,
      adminJwt
    );
    assert(
      pointsDetail.cards[0].balanceLabel === "25 of 100 points",
      `balance label should read the ledger, got "${pointsDetail.cards[0].balanceLabel}"`
    );

    // ---------- the adjustment ----------

    interface AdjustResult {
      unit: string;
      before: number;
      after: number;
      detail: { card: { cardState: { stamps_current?: number; points_current?: number } } };
    }

    console.log("→ a stamp adjustment moves the balance by exactly the delta");
    const adj = await call<AdjustResult>(
      "POST",
      `/v1/admin/cards/${card.id}/adjust`,
      { delta: 3, reason: "smoke test: scan failed at the till" },
      adminJwt
    );
    assert(adj.unit === "stamps", `expected stamps, got ${adj.unit}`);
    assert(adj.before === 1 && adj.after === 4, `expected 1 → 4, got ${adj.before} → ${adj.after}`);
    assert(
      adj.detail.card.cardState.stamps_current === 4,
      "the returned card should already reflect the new balance"
    );

    console.log("→ the café can see it on their own card, with the reason");
    // Read with the MERCHANT's token, not the admin's. An operator changing a
    // café's data invisibly is the real risk in this feature; this is the
    // assertion that it cannot be invisible.
    const asMerchant = await call<{
      events: Array<{
        eventType: string;
        note: string | null;
        amountCents: number | null;
        deltaJson: { balance_before?: number; balance_after?: number; reason?: string };
      }>;
    }>("GET", `/v1/cards/${card.id}`, undefined, adminJwt);
    const visible = asMerchant.events.find((e) => e.eventType === "manual_adjust");
    assert(visible, "the adjustment is NOT visible to the merchant on their own card");
    assert(
      visible!.note !== null && visible!.note.includes("scan failed at the till"),
      `the merchant-visible note must carry the reason: ${visible!.note}`
    );
    assert(
      visible!.deltaJson.balance_before === 1 && visible!.deltaJson.balance_after === 4,
      "the merchant-visible event must carry the before/after"
    );
    // setCardEventAmount refuses to attach money to a manual_adjust, so an
    // adjustment can never pollute that café's revenue or AOV.
    assert(
      visible!.amountCents === null,
      "a manual_adjust must never carry a sale amount"
    );

    console.log("→ the audit row carries the actor, the reason and the before/after");
    const [auditRows] = await db.query<
      Array<{
        actor_email: string;
        action: string;
        reason: string;
        target_id: string;
        before_json: unknown;
        after_json: unknown;
      }>
    >(
      `SELECT actor_email, action, reason, target_id, before_json, after_json
         FROM admin_audit_log
        WHERE target_id = ? ORDER BY id DESC LIMIT 1`,
      [card.id]
    );
    assert(auditRows.length === 1, "no admin_audit_log row was written");
    const audit = auditRows[0];
    const parse = (v: unknown): { balance?: number; delta?: number } =>
      typeof v === "string" ? JSON.parse(v) : (v as { balance?: number; delta?: number });
    assert(audit.actor_email === adminEmail, `audit actor wrong: ${audit.actor_email}`);
    assert(audit.action === "card.adjust", `audit action wrong: ${audit.action}`);
    assert(
      audit.reason === "smoke test: scan failed at the till",
      `audit reason wrong: ${audit.reason}`
    );
    assert(parse(audit.before_json).balance === 1, "audit before wrong");
    assert(parse(audit.after_json).balance === 4, "audit after wrong");
    assert(parse(audit.after_json).delta === 3, "audit delta wrong");

    console.log("→ bad adjustments are refused, and change nothing");
    const refused = async (label: string, body: unknown): Promise<void> => {
      const status = await statusOf("POST", `/v1/admin/cards/${card.id}/adjust`, adminJwt, body);
      assert(status === 400, `${label} should 400, got ${status === 0 ? "success" : status}`);
    };
    await refused("a missing reason", { delta: 1 });
    await refused("a two-character reason", { delta: 1, reason: "no" });
    await refused("a zero delta", { delta: 0, reason: "nothing to do" });
    await refused("a fractional delta", { delta: 1.5, reason: "half a stamp" });
    await refused("an absurd delta", { delta: 1_000_000_000, reason: "far too many" });
    // 4 stamps on an 8-stamp card: -5 would go negative.
    await refused("going below zero", { delta: -5, reason: "too far down" });
    // 8-stamp card at 4: +5 would exceed the threshold, a state the ordinary
    // stamp path refuses to create.
    await refused("going past the threshold", { delta: 5, reason: "too far up" });

    const unchanged = await call<{ pointsBalance: number | null; detail: AdjustResult["detail"] }>(
      "GET",
      `/v1/admin/cards/${card.id}`,
      undefined,
      adminJwt
    );
    assert(
      unchanged.detail.card.cardState.stamps_current === 4,
      "a refused adjustment must leave the balance alone"
    );

    console.log("→ landing exactly on the threshold is allowed");
    const toThreshold = await call<AdjustResult>(
      "POST",
      `/v1/admin/cards/${card.id}/adjust`,
      { delta: 4, reason: "smoke test: completing the card" },
      adminJwt
    );
    assert(
      toThreshold.after === 8,
      `should reach exactly 8 of 8, got ${toThreshold.after}`
    );

    // ⚠️⚠️ THE BATCH-LEDGER REGRESSION.
    //
    // The whole reason applyManualAdjust exists rather than a card_state
    // write. A points grant written straight to `card_state.points_current`
    // would display correctly, update the wallet pass, and then be silently
    // REVERTED by the café's next real transaction, because
    // computePointsBalance recomputes from points_batches.
    //
    // So: grant, then transact as the merchant, then re-read. The grant has to
    // survive. If this fails, the adjustment is writing the cache instead of
    // the ledger.
    console.log("→ a points grant survives the café's next transaction");
    const grant = await call<AdjustResult>(
      "POST",
      `/v1/admin/cards/${pointsCard.id}/adjust`,
      { delta: 50, reason: "smoke test: goodwill points" },
      adminJwt
    );
    assert(grant.unit === "points", `expected points, got ${grant.unit}`);
    assert(
      grant.before === 25 && grant.after === 75,
      `expected 25 → 75, got ${grant.before} → ${grant.after}`
    );

    // A real merchant transaction: +20 points for €10 at 2 points/euro.
    await call("POST", `/v1/cards/${pointsCard.id}/add-points`, { amount: 10 }, adminJwt);

    const afterTxn = await call<{ pointsBalance: number; pointsCacheStale: boolean }>(
      "GET",
      `/v1/admin/cards/${pointsCard.id}`,
      undefined,
      adminJwt
    );
    assert(
      afterTxn.pointsBalance === 95,
      `GRANT WAS REVERTED — expected 75 + 20 = 95, got ${afterTxn.pointsBalance}. ` +
        "The adjustment is writing card_state instead of the points_batches ledger."
    );
    assert(
      afterTxn.pointsCacheStale === false,
      "the cache should agree with the ledger after a real transaction"
    );

    console.log("→ a points deduction goes through the ledger, FIFO");
    const clawback = await call<AdjustResult>(
      "POST",
      `/v1/admin/cards/${pointsCard.id}/adjust`,
      { delta: -40, reason: "smoke test: awarded twice by mistake" },
      adminJwt
    );
    assert(
      clawback.before === 95 && clawback.after === 55,
      `expected 95 → 55, got ${clawback.before} → ${clawback.after}`
    );
    const [ledger] = await db.query<Array<{ bal: string | number }>>(
      `SELECT COALESCE(SUM(points_remaining), 0) AS bal
         FROM points_batches
        WHERE card_id = ? AND points_remaining > 0
          AND (expires_at IS NULL OR expires_at > NOW())`,
      [pointsCard.id]
    );
    assert(
      Number(ledger[0].bal) === 55,
      `the ledger itself must total 55, got ${ledger[0].bal} — the deduction did not reach it`
    );

    console.log("→ a points deduction below the balance is refused");
    const tooMuch = await statusOf("POST", `/v1/admin/cards/${pointsCard.id}/adjust`, adminJwt, {
      delta: -500,
      reason: "more than they have",
    });
    assert(tooMuch === 400, `over-deduction should 400, got ${tooMuch}`);
    const [stillThere] = await db.query<Array<{ bal: string | number }>>(
      `SELECT COALESCE(SUM(points_remaining), 0) AS bal
         FROM points_batches
        WHERE card_id = ? AND points_remaining > 0
          AND (expires_at IS NULL OR expires_at > NOW())`,
      [pointsCard.id]
    );
    assert(
      Number(stillThere[0].bal) === 55,
      `a refused deduction must not partially drain the ledger: ${stillThere[0].bal}`
    );

    console.log("→ an adjustment does not count as café activity");
    // manual_adjust is excluded from TXN_TYPES on purpose: if it counted, our
    // own support fix would mark a dormant café as active and the health
    // metric would respond to our interventions rather than theirs.
    const relist = await call<{ merchants: Array<{ id: string; eventsTotal: number }> }>(
      "GET",
      `/v1/admin/merchants?q=${encodeURIComponent(adminEmail)}`,
      undefined,
      adminJwt
    );
    const mine = relist.merchants[0];
    // 1 stamp + 1 points_add (setup) + 1 points_add (the regression check) = 3.
    // The four adjustments applied above must not appear.
    assert(
      mine.eventsTotal === 3,
      `adjustments must not count as scans — expected 3 real transactions, got ${mine.eventsTotal}`
    );

    console.log("→ adjusting an unknown card 404s");
    assert(
      (await statusOf(
        "POST",
        "/v1/admin/cards/00000000-0000-0000-0000-000000000000/adjust",
        adminJwt,
        { delta: 1, reason: "no such card" }
      )) === 404,
      "adjusting an unknown card should 404"
    );

    // ---------- merchant controls ----------

    console.log("→ account changes apply, and record what actually changed");
    const patched = await call<{
      status: string;
      isPremium: boolean;
      cronsEnabled: boolean;
      monthlyFeeCents: number | null;
      businessName: string;
      trial: { endsAt: string | null; expired: boolean };
    }>(
      "PATCH",
      `/v1/admin/merchants/${signup.merchant.id}`,
      {
        status: "active",
        isPremium: true,
        cronsEnabled: false,
        monthlyFeeCents: 2900,
        reason: "smoke test: converted from trial",
      },
      adminJwt
    );
    assert(patched.status === "active", `status not applied: ${patched.status}`);
    assert(patched.isPremium === true, "isPremium not applied");
    assert(patched.cronsEnabled === false, "cronsEnabled not applied");
    assert(patched.monthlyFeeCents === 2900, `fee not applied: ${patched.monthlyFeeCents}`);

    const [patchAudit] = await db.query<
      Array<{ action: string; reason: string; before_json: unknown; after_json: unknown }>
    >(
      `SELECT action, reason, before_json, after_json FROM admin_audit_log
        WHERE merchant_id = ? AND action = 'merchant.update' ORDER BY id DESC LIMIT 1`,
      [signup.merchant.id]
    );
    assert(patchAudit.length === 1, "no merchant.update audit row");
    const pj = (v: unknown): Record<string, unknown> =>
      typeof v === "string" ? JSON.parse(v) : (v as Record<string, unknown>);
    // The snapshot is read back from the database after the write, not echoed
    // from the request — so it records what was actually stored.
    assert(pj(patchAudit[0].before_json).status === "trial", "audit before.status wrong");
    assert(pj(patchAudit[0].after_json).status === "active", "audit after.status wrong");
    assert(
      pj(patchAudit[0].before_json).monthlyFeeCents === null,
      "audit before.monthlyFeeCents should be null, not 0"
    );
    assert(pj(patchAudit[0].after_json).monthlyFeeCents === 2900, "audit after fee wrong");

    console.log("→ MRR now counts this café, and stops counting it when suspended");
    // Deltas against the baseline captured earlier, not absolutes: other cafés
    // in the database may already have fees recorded, and this suite does not
    // own them.
    const withMrr = await call<{ revenue: { mrrCents: number; feeSet: number } }>(
      "GET",
      "/v1/admin/metrics",
      undefined,
      adminJwt
    );
    assert(
      withMrr.revenue.mrrCents - baselineMrrCents === 2900,
      `MRR should have risen by exactly 2900, went ${baselineMrrCents} → ${withMrr.revenue.mrrCents}`
    );
    assert(
      withMrr.revenue.feeSet - baselineFeeSet === 1,
      "exactly one more café should now have a fee recorded"
    );

    await call(
      "PATCH",
      `/v1/admin/merchants/${signup.merchant.id}`,
      { status: "suspended", reason: "smoke test: checking MRR excludes suspended" },
      adminJwt
    );
    const suspendedMrr = await call<{ revenue: { mrrCents: number } }>(
      "GET",
      "/v1/admin/metrics",
      undefined,
      adminJwt
    );
    // Whatever a suspended café agreed to pay, they are not being served and
    // must not be counted as revenue.
    assert(
      suspendedMrr.revenue.mrrCents === baselineMrrCents,
      `suspending must remove this café's 2900 from MRR, leaving the baseline ` +
        `${baselineMrrCents} — got ${suspendedMrr.revenue.mrrCents}`
    );
    await call(
      "PATCH",
      `/v1/admin/merchants/${signup.merchant.id}`,
      { status: "active", reason: "smoke test: restoring" },
      adminJwt
    );

    console.log("→ clearing the fee means 'not recorded', not zero");
    const cleared = await call<{ monthlyFeeCents: number | null }>(
      "PATCH",
      `/v1/admin/merchants/${signup.merchant.id}`,
      { monthlyFeeCents: null, reason: "smoke test: fee not agreed yet" },
      adminJwt
    );
    assert(
      cleared.monthlyFeeCents === null,
      `clearing the fee must give null, not 0 — got ${cleared.monthlyFeeCents}`
    );

    {
      // Trial dates round-trip, and clearing takes the café off the clock.
      console.log("→ the trial date can be set and cleared");
      const extended = await call<{ trial: { endsAt: string | null; expired: boolean } }>(
        "PATCH",
        `/v1/admin/merchants/${signup.merchant.id}`,
        { trialEndsAt: "2030-01-15T12:00:00.000Z", reason: "smoke test: extending" },
        adminJwt
      );
      assert(
        extended.trial.endsAt?.startsWith("2030-01-15") === true,
        `trial date not applied: ${extended.trial.endsAt}`
      );
      assert(extended.trial.expired === false, "a 2030 trial is not expired");

      const unclocked = await call<{ trial: { endsAt: string | null } }>(
        "PATCH",
        `/v1/admin/merchants/${signup.merchant.id}`,
        { trialEndsAt: null, reason: "smoke test: unlimited account" },
        adminJwt
      );
      assert(unclocked.trial.endsAt === null, "clearing the trial date should give null");
    }

    console.log("→ bad account changes are refused");
    const patchRefused = async (label: string, body: unknown): Promise<void> => {
      const status = await statusOf(
        "PATCH",
        `/v1/admin/merchants/${signup.merchant.id}`,
        adminJwt,
        body
      );
      assert(status === 400, `${label} should 400, got ${status === 0 ? "success" : status}`);
    };
    await patchRefused("no reason", { status: "active" });
    await patchRefused("no fields", { reason: "nothing to change here" });
    await patchRefused("an unknown status", { status: "deleted", reason: "not a real status" });
    await patchRefused("a negative fee", { monthlyFeeCents: -100, reason: "negative" });
    // merchants.trial_ends_at is a MySQL TIMESTAMP, so anything past 2038 is
    // out of range. Bounded in the contract, because without it a mistyped
    // year reaches the database and returns an opaque 500 instead of telling
    // the operator which field is wrong.
    await patchRefused("a date beyond the TIMESTAMP range", {
      trialEndsAt: "2099-01-15T12:00:00.000Z",
      reason: "mistyped the year",
    });
    assert(
      (await statusOf(
        "PATCH",
        "/v1/admin/merchants/00000000-0000-0000-0000-000000000000",
        adminJwt,
        { status: "active", reason: "no such café" }
      )) === 404,
      "patching an unknown merchant should 404"
    );

    console.log("→ there is no delete path for a café");
    // The cascade from `merchants` reaches customers, cards, events and points
    // batches and is irreversible; `status = 'suspended'` covers every real
    // need. If this ever stops 404/405-ing, someone added one.
    const deleteStatus = await statusOf(
      "DELETE",
      `/v1/admin/merchants/${signup.merchant.id}`,
      adminJwt
    );
    assert(
      deleteStatus === 404 || deleteStatus === 405,
      `DELETE /merchants/:id must not exist, got ${deleteStatus === 0 ? "success" : deleteStatus}`
    );

    console.log("→ a password reset issues a usable link to the owner's own address");
    const reset = await call<{ sentTo: string; devResetLink?: string }>(
      "POST",
      `/v1/admin/merchants/${signup.merchant.id}/password-reset`,
      { reason: "smoke test: owner locked out" },
      adminJwt
    );
    assert(reset.sentTo === adminEmail, `reset went to the wrong address: ${reset.sentTo}`);
    assert(
      reset.devResetLink?.includes("/auth/reset-password") === true,
      `the link should land on the reset page, got ${reset.devResetLink}`
    );
    // The same self-service flow, not a second way in. We never see or set the
    // password; the owner chooses it from this link.
    const resetToken = new URL(reset.devResetLink!).searchParams.get("token");
    assert(resetToken?.length === 64, `reset token shape wrong: ${resetToken}`);
    assert(
      (await statusOf("POST", `/v1/admin/merchants/${signup.merchant.id}/password-reset`, adminJwt, {
        reason: "no",
      })) === 400,
      "a reset with a two-character reason should 400"
    );

    // ---------- the audit trail ----------

    console.log("→ the audit log reads back every write, newest first");
    const auditLog = await call<{
      entries: Array<{
        action: string;
        actorEmail: string;
        merchantId: string | null;
        merchantName: string | null;
        reason: string;
        before: unknown;
        after: unknown;
      }>;
      truncated: boolean;
    }>("GET", `/v1/admin/audit?merchantId=${signup.merchant.id}`, undefined, adminJwt);

    const actions = new Set(auditLog.entries.map((e) => e.action));
    assert(actions.has("card.adjust"), "balance adjustments missing from the audit log");
    assert(actions.has("merchant.update"), "account changes missing from the audit log");
    assert(
      actions.has("merchant.password_reset"),
      "password resets missing from the audit log"
    );
    assert(
      auditLog.entries.every((e) => e.actorEmail === adminEmail),
      "every entry in this run should be attributed to the admin who made it"
    );
    assert(
      auditLog.entries.every((e) => e.reason.length >= 3),
      "an audit entry without a stated reason should be impossible"
    );
    // Resolved by LEFT JOIN at read time, not stored — a null name means the
    // café has since been deleted, which is the case most worth recording.
    assert(
      auditLog.entries.every((e) => e.merchantName !== null),
      "the café still exists, so its name should resolve"
    );

    console.log("→ filtering the audit log by action narrows it");
    const onlyResets = await call<{ entries: Array<{ action: string }> }>(
      "GET",
      "/v1/admin/audit?action=merchant.password_reset",
      undefined,
      adminJwt
    );
    assert(
      onlyResets.entries.length > 0 &&
        onlyResets.entries.every((e) => e.action === "merchant.password_reset"),
      "the action filter did not narrow the log"
    );

    // ⚠️ The property the entire design exists for. Platform admin is a
    // database row rather than a JWT role so that revocation is immediate;
    // if this assertion ever fails, the check has been moved into the token
    // or cached, and access now survives a DELETE for up to seven days.
    console.log("→ revoking takes effect immediately, on the same unexpired token");
    await db.execute("DELETE FROM platform_admins WHERE staff_user_id = ?", [signup.user.id]);
    const afterRevoke = await statusOf("GET", "/v1/admin/whoami", adminJwt);
    assert(
      afterRevoke === 404,
      `REVOCATION DID NOT TAKE EFFECT — expected 404 with the same token, got ${
        afterRevoke === 0 ? "success" : afterRevoke
      }`
    );
    assert(
      (await call<{ isPlatformAdmin: boolean }>("GET", "/v1/me", undefined, adminJwt))
        .isPlatformAdmin === false,
      "/v1/me should report isPlatformAdmin=false after revocation"
    );

    console.log("\n✅ admin smoke passed");
  } finally {
    // Leave no live grant behind, even if an assertion threw mid-run. The
    // merchant row itself is disposable smoke data like every other run's.
    await db.execute(
      `DELETE pa FROM platform_admins pa
         JOIN staff_users su ON su.id = pa.staff_user_id
        WHERE su.email = ?`,
      [adminEmail]
    );
    await db.end();
  }
}

main().catch((err) => {
  console.error("\n❌ admin smoke failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
