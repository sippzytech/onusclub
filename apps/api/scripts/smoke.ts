// End-to-end smoke test against a running api. Fails loud on any deviation.
// Run with: pnpm --filter @stampdeck/api run smoke
const BASE = process.env.SMOKE_BASE ?? "http://localhost:4000";

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

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

async function main(): Promise<void> {
  const ownerEmail = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const businessName = `Smoke Café ${new Date().toISOString()}`;

  console.log("→ health");
  const health = await call<{ ok: boolean; service: string }>("GET", "/health");
  assert(health.ok && health.service === "api", "health not ok");

  console.log("→ signup", ownerEmail);
  const signup = await call<{ merchant: { id: string }; user: { id: string } }>(
    "POST",
    "/v1/merchants",
    { businessName, ownerEmail, ownerName: "Smoke Tester" }
  );
  assert(signup.merchant.id, "no merchant id");
  assert(signup.user.id, "no user id");

  console.log("→ duplicate signup should 409");
  let conflict = false;
  try {
    await call("POST", "/v1/merchants", { businessName, ownerEmail });
  } catch (err) {
    conflict = String(err).includes("409") || String(err).includes("conflict");
  }
  assert(conflict, "duplicate signup did not 409");

  console.log("→ auth/request");
  const reqRes = await call<{ ok: boolean; devMagicLink?: string }>(
    "POST",
    "/v1/auth/request",
    { email: ownerEmail }
  );
  assert(reqRes.ok, "auth/request not ok");
  assert(reqRes.devMagicLink, "no dev magic link in response (set NODE_ENV != production)");
  const token = new URL(reqRes.devMagicLink!).searchParams.get("token");
  assert(token && token.length === 64, "token shape wrong");

  console.log("→ auth/verify");
  const verify = await call<{ jwt: string; user: { id: string }; merchant: { id: string } }>(
    "POST",
    "/v1/auth/verify",
    { token }
  );
  assert(verify.jwt.split(".").length === 3, "jwt shape wrong");
  assert(verify.user.id === signup.user.id, "user id mismatch");
  assert(verify.merchant.id === signup.merchant.id, "merchant id mismatch");
  const jwt = verify.jwt;

  console.log("→ token replay should 401");
  let replayBlocked = false;
  try {
    await call("POST", "/v1/auth/verify", { token });
  } catch (err) {
    replayBlocked = String(err).includes("401");
  }
  assert(replayBlocked, "token replay was not blocked");

  console.log("→ /me");
  const me = await call<{ user: { id: string }; merchant: { id: string } }>(
    "GET",
    "/v1/me",
    undefined,
    jwt
  );
  assert(me.user.id === signup.user.id, "/me user mismatch");

  console.log("→ /me without jwt should 401");
  let unauth = false;
  try {
    await call("GET", "/v1/me");
  } catch (err) {
    unauth = String(err).includes("401");
  }
  assert(unauth, "/me did not require auth");

  console.log("→ create program");
  const program = await call<{ id: string; name: string }>(
    "POST",
    "/v1/programs",
    { name: "Coffee card", stampsRequired: 10, rewardText: "A free coffee" },
    jwt
  );
  assert(program.id, "no program id");

  console.log("→ list programs");
  const list = await call<{ programs: Array<{ id: string }> }>(
    "GET",
    "/v1/programs",
    undefined,
    jwt
  );
  assert(
    list.programs.some((p) => p.id === program.id),
    "created program not in list"
  );

  console.log("✓ smoke test passed");
}

main().catch((err) => {
  console.error("✗ smoke test failed:", err);
  process.exit(1);
});
