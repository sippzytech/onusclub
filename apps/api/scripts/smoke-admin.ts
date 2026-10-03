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
    assert(
      metrics.revenue.mrrCents === 0 && metrics.revenue.feeSet === 0,
      "no fee has been recorded for anyone yet, so MRR must be exactly 0"
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
