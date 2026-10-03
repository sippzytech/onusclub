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
