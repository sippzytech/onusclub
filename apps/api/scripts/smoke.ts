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

  // ---------- Day 3: customers + cards ----------

  console.log("→ create customer");
  const customer = await call<{ id: string; name: string | null }>(
    "POST",
    "/v1/customers",
    { name: "Jane Smoke", phone: "+31600000000" },
    jwt
  );
  assert(customer.id, "no customer id");

  console.log("→ customer with neither phone nor email should 400");
  let validationBlocked = false;
  try {
    await call("POST", "/v1/customers", { name: "Bad" }, jwt);
  } catch (err) {
    validationBlocked = String(err).includes("400");
  }
  assert(validationBlocked, "phone-or-email validation did not 400");

  console.log("→ list customers");
  const customers = await call<{ customers: Array<{ id: string }> }>(
    "GET",
    "/v1/customers",
    undefined,
    jwt
  );
  assert(
    customers.customers.some((c) => c.id === customer.id),
    "created customer not in list"
  );

  console.log("→ enrol card");
  const card = await call<{
    id: string;
    qrToken: string;
    stampsRequired: number;
    cardState: { stamps_current: number; total_lifetime: number; rewards_redeemed: number };
  }>(
    "POST",
    "/v1/cards",
    { customerId: customer.id, programId: program.id },
    jwt
  );
  assert(card.id, "no card id");
  assert(card.qrToken.length === 64, "qr_token should be 64 hex chars");
  assert(card.stampsRequired === 10, `stampsRequired wrong: ${card.stampsRequired}`);
  assert(card.cardState.stamps_current === 0, "initial stamps_current should be 0");
  assert(card.cardState.total_lifetime === 0, "initial total_lifetime should be 0");

  console.log("→ duplicate enrol should 409");
  let dupBlocked = false;
  try {
    await call("POST", "/v1/cards", { customerId: customer.id, programId: program.id }, jwt);
  } catch (err) {
    dupBlocked = String(err).includes("409");
  }
  assert(dupBlocked, "duplicate card enrol was not blocked");

  console.log("→ stamp the card 10 times");
  for (let i = 1; i <= 10; i++) {
    const r = await call<{
      card: { cardState: { stamps_current: number; total_lifetime: number } };
      events: Array<{ eventType: string }>;
    }>("POST", `/v1/cards/${card.id}/stamp`, undefined, jwt);
    assert(r.card.cardState.stamps_current === i, `stamps_current should be ${i}`);
    assert(r.card.cardState.total_lifetime === i, `total_lifetime should be ${i}`);
    assert(r.events[0].eventType === "stamp", "latest event should be stamp");
  }

  console.log("→ stamping past the threshold should 400");
  let pastThresholdBlocked = false;
  try {
    await call("POST", `/v1/cards/${card.id}/stamp`, undefined, jwt);
  } catch (err) {
    pastThresholdBlocked = String(err).includes("400");
  }
  assert(pastThresholdBlocked, "stamping past threshold was not blocked");

  console.log("→ redeem");
  const afterRedeem = await call<{
    card: {
      cardState: { stamps_current: number; rewards_redeemed: number; total_lifetime: number };
    };
    events: Array<{ eventType: string }>;
  }>("POST", `/v1/cards/${card.id}/redeem`, undefined, jwt);
  assert(
    afterRedeem.card.cardState.stamps_current === 0,
    "stamps_current should reset to 0 after redeem"
  );
  assert(
    afterRedeem.card.cardState.rewards_redeemed === 1,
    "rewards_redeemed should be 1"
  );
  assert(
    afterRedeem.card.cardState.total_lifetime === 10,
    "total_lifetime should not reset on redeem"
  );
  assert(afterRedeem.events[0].eventType === "redeem", "latest event should be redeem");

  console.log("→ redeem when ineligible should 400");
  let redeemBlocked = false;
  try {
    await call("POST", `/v1/cards/${card.id}/redeem`, undefined, jwt);
  } catch (err) {
    redeemBlocked = String(err).includes("400");
  }
  assert(redeemBlocked, "redeem without enough stamps was not blocked");

  console.log("→ card detail has events");
  const detail = await call<{
    card: { id: string };
    events: Array<{ eventType: string }>;
  }>("GET", `/v1/cards/${card.id}`, undefined, jwt);
  assert(detail.card.id === card.id, "detail card id mismatch");
  assert(detail.events.length >= 12, `expected ≥12 events, got ${detail.events.length}`);
  const types = detail.events.map((e) => e.eventType);
  assert(types.includes("signup"), "no signup event");
  assert(types.filter((t) => t === "stamp").length === 10, "should be 10 stamp events");
  assert(types.filter((t) => t === "redeem").length === 1, "should be 1 redeem event");

  // ---------- Day 5: scan flow ----------

  console.log("→ scan with valid token (auto) should stamp");
  const scan1 = await call<{
    detail: { card: { cardState: { stamps_current: number } } };
    appliedAction: "stamp" | "redeem";
  }>("POST", "/v1/scan", { qrToken: card.qrToken, action: "auto" }, jwt);
  assert(scan1.appliedAction === "stamp", `expected stamp, got ${scan1.appliedAction}`);
  assert(
    scan1.detail.card.cardState.stamps_current === 1,
    "scan stamp should bring count to 1"
  );

  console.log("→ scan 9 more times to reach threshold via scan");
  for (let i = 2; i <= 10; i++) {
    const r = await call<{
      detail: { card: { cardState: { stamps_current: number } } };
      appliedAction: "stamp" | "redeem";
    }>("POST", "/v1/scan", { qrToken: card.qrToken, action: "auto" }, jwt);
    assert(r.appliedAction === "stamp", `iteration ${i}: expected stamp`);
    assert(
      r.detail.card.cardState.stamps_current === i,
      `iteration ${i}: stamps_current ${r.detail.card.cardState.stamps_current}`
    );
  }

  console.log("→ scan with auto at threshold should redeem");
  const redeemViaScan = await call<{
    detail: { card: { cardState: { stamps_current: number; rewards_redeemed: number } } };
    appliedAction: "stamp" | "redeem";
  }>("POST", "/v1/scan", { qrToken: card.qrToken, action: "auto" }, jwt);
  assert(
    redeemViaScan.appliedAction === "redeem",
    `expected redeem, got ${redeemViaScan.appliedAction}`
  );
  assert(
    redeemViaScan.detail.card.cardState.stamps_current === 0,
    "after redeem stamps_current should be 0"
  );
  assert(
    redeemViaScan.detail.card.cardState.rewards_redeemed === 2,
    "rewards_redeemed should be 2 (one from earlier route-based redeem)"
  );

  console.log("→ scan with junk token should 404");
  let scan404 = false;
  try {
    await call(
      "POST",
      "/v1/scan",
      { qrToken: "0".repeat(64), action: "auto" },
      jwt
    );
  } catch (err) {
    scan404 = String(err).includes("404");
  }
  assert(scan404, "unknown qr_token should 404");

  console.log("→ scan with malformed token should 400 (zod validation)");
  let scan400 = false;
  try {
    await call("POST", "/v1/scan", { qrToken: "short", action: "auto" }, jwt);
  } catch (err) {
    scan400 = String(err).includes("400");
  }
  assert(scan400, "malformed qr_token should 400");

  console.log("✓ smoke test passed");
}

main().catch((err) => {
  console.error("✗ smoke test failed:", err);
  process.exit(1);
});
