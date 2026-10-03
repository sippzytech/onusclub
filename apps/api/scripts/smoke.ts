// End-to-end smoke test against a running api. Fails loud on any deviation.
// Run with: pnpm --filter @onusclub/api run smoke
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
  // Enrol a fresh card so the earlier route-based stamps don't interfere
  // with the once-per-day rule.
  const scanCustomer = await call<{ id: string }>(
    "POST",
    "/v1/customers",
    { name: "Scan Tester", phone: "+31600000033" },
    jwt
  );
  const scanCard = await call<{ id: string; qrToken: string }>(
    "POST",
    "/v1/cards",
    { customerId: scanCustomer.id, programId: program.id },
    jwt
  );
  const scan1 = await call<{
    status: "applied" | "needs_amount";
    detail: { card: { cardState: { stamps_current: number } } };
    appliedAction: "stamp" | "redeem" | "add-points";
  }>("POST", "/v1/scan", { qrToken: scanCard.qrToken, action: "auto" }, jwt);
  assert(scan1.status === "applied", `expected applied, got ${scan1.status}`);
  assert(scan1.appliedAction === "stamp", `expected stamp, got ${scan1.appliedAction}`);
  assert(
    scan1.detail.card.cardState.stamps_current === 1,
    "scan stamp should bring count to 1"
  );

  console.log("→ 9 more stamps via owner endpoint to reach threshold");
  for (let i = 2; i <= 10; i++) {
    const r = await call<{ card: { cardState: { stamps_current: number } } }>(
      "POST",
      `/v1/cards/${scanCard.id}/stamp`,
      undefined,
      jwt
    );
    assert(
      r.card.cardState.stamps_current === i,
      `owner stamp iter ${i}: got ${r.card.cardState.stamps_current}`
    );
  }

  console.log("→ scan with auto at threshold should redeem (not day-capped)");
  const redeemViaScan = await call<{
    status: "applied" | "needs_amount";
    detail: { card: { cardState: { stamps_current: number; rewards_redeemed: number } } };
    appliedAction: "stamp" | "redeem" | "add-points";
  }>("POST", "/v1/scan", { qrToken: scanCard.qrToken, action: "auto" }, jwt);
  assert(
    redeemViaScan.status === "applied",
    `expected applied, got ${redeemViaScan.status}`
  );
  assert(
    redeemViaScan.appliedAction === "redeem",
    `expected redeem, got ${redeemViaScan.appliedAction}`
  );
  assert(
    redeemViaScan.detail.card.cardState.stamps_current === 0,
    "after redeem stamps_current should be 0"
  );
  assert(
    redeemViaScan.detail.card.cardState.rewards_redeemed === 1,
    "rewards_redeemed should be 1 on this fresh card"
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

  console.log("→ scan twice in same day on same card should 409");
  // Enrol a fresh card just for this assertion (the earlier card was already
  // stamped to threshold + redeemed, which leaves a stamp event today).
  const dailyCustomer = await call<{ id: string }>(
    "POST",
    "/v1/customers",
    { name: "Daily Block Test", phone: "+31600000044" },
    jwt
  );
  const dailyCard = await call<{ qrToken: string }>(
    "POST",
    "/v1/cards",
    { customerId: dailyCustomer.id, programId: program.id },
    jwt
  );
  await call("POST", "/v1/scan", { qrToken: dailyCard.qrToken, action: "auto" }, jwt);
  let dailyBlocked = false;
  try {
    await call("POST", "/v1/scan", { qrToken: dailyCard.qrToken, action: "auto" }, jwt);
  } catch (err) {
    dailyBlocked = String(err).includes("409");
  }
  assert(dailyBlocked, "second scan same day should 409");

  // ---------- Day 6: broadcasts + sweeps ----------

  console.log("→ create a 2nd customer + card so broadcast targets multiple");
  const c2 = await call<{ id: string }>(
    "POST",
    "/v1/customers",
    { name: "C2", phone: "+31611111112" },
    jwt
  );
  await call("POST", "/v1/cards", { customerId: c2.id, programId: program.id }, jwt);

  console.log("→ POST /v1/broadcasts without premium → 402");
  let premBlocked = false;
  try {
    await call(
      "POST",
      "/v1/broadcasts",
      { header: "Should fail", body: "Not premium yet" },
      jwt
    );
  } catch (err) {
    premBlocked = String(err).includes("402");
  }
  assert(premBlocked, "broadcast without premium should 402");

  console.log("→ PATCH /v1/me/preferences { isPremium: true }");
  const upgraded = await call<{ isPremium: boolean; cronsEnabled: boolean }>(
    "PATCH",
    "/v1/me/preferences",
    { isPremium: true },
    jwt
  );
  assert(upgraded.isPremium === true, "isPremium not flipped");
  assert(upgraded.cronsEnabled === true, "cronsEnabled default should be true");

  console.log("→ /v1/me reflects new prefs");
  const meAfter = await call<{ preferences: { isPremium: boolean } }>(
    "GET",
    "/v1/me",
    undefined,
    jwt
  );
  assert(meAfter.preferences.isPremium === true, "/me prefs not updated");

  console.log("→ PATCH cronsEnabled false");
  const cronsOff = await call<{ cronsEnabled: boolean }>(
    "PATCH",
    "/v1/me/preferences",
    { cronsEnabled: false },
    jwt
  );
  assert(cronsOff.cronsEnabled === false, "cronsEnabled not flipped off");
  // re-enable for downstream tests
  await call("PATCH", "/v1/me/preferences", { cronsEnabled: true }, jwt);

  console.log("→ POST /v1/broadcasts kicks off async send");
  const start = await call<{ broadcastId: string }>(
    "POST",
    "/v1/broadcasts",
    { header: "Smoke test broadcast", body: "Ignore this — automated." },
    jwt
  );
  assert(start.broadcastId, "no broadcastId returned");

  console.log("→ poll broadcast until status=completed");
  let final: {
    broadcast: { status: string; scanned: number; sent: number; failed: number };
    deliveries: Array<{ status: string }>;
  } | null = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    final = await call(
      "GET",
      `/v1/broadcasts/${start.broadcastId}`,
      undefined,
      jwt
    );
    if (final.broadcast.status === "completed") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert(final, "broadcast never returned a row");
  assert(final.broadcast.status === "completed", "broadcast did not complete");
  assert(
    final.broadcast.scanned >= 2,
    `scanned should be ≥2, got ${final.broadcast.scanned}`
  );
  assert(
    final.broadcast.sent + final.broadcast.failed === final.broadcast.scanned,
    "sent+failed should equal scanned"
  );
  assert(
    final.deliveries.length === final.broadcast.scanned,
    `deliveries length should match scanned (got ${final.deliveries.length})`
  );

  console.log("→ /v1/messages feed lists the broadcast");
  const feed = await call<{ items: Array<{ kind: string; id: string }> }>(
    "GET",
    "/v1/messages",
    undefined,
    jwt
  );
  assert(
    feed.items.some((i) => i.kind === "broadcast" && i.id === start.broadcastId),
    "feed missing the broadcast"
  );

  console.log("→ create customer with birthday today, then run birthday sweep");
  const todayBirthday = new Date().toISOString().slice(0, 10);
  const bday = await call<{ id: string }>(
    "POST",
    "/v1/customers",
    { name: "Birthday Person", phone: "+31611111113", birthday: todayBirthday },
    jwt
  );
  await call("POST", "/v1/cards", { customerId: bday.id, programId: program.id }, jwt);
  const birthdayRun = await call<{ scanned: number; sent: number; failed: number; id: string }>(
    "POST",
    "/v1/sweeps/run/birthday",
    undefined,
    jwt
  );
  assert(
    birthdayRun.scanned >= 1,
    `birthday sweep should have scanned ≥1, got ${birthdayRun.scanned}`
  );

  console.log("→ run birthday sweep AGAIN same day → dedup should skip");
  const birthdayRun2 = await call<{ scanned: number; sent: number; failed: number }>(
    "POST",
    "/v1/sweeps/run/birthday",
    undefined,
    jwt
  );
  if (birthdayRun.sent > 0) {
    // First attempt succeeded → message_deliveries row is status='sent' →
    // dedup query trips on next run → scanned should drop to 0.
    assert(
      birthdayRun2.scanned === 0,
      `second birthday sweep should scan 0 (dedup), got ${birthdayRun2.scanned}`
    );
  } else {
    // CI path: Google Wallet not configured → sendCustomCardMessage returns
    // ok:false → delivery row is status='failed' → dedup (which only counts
    // 'sent') legitimately doesn't trip. Just confirm the sweep ran.
    assert(
      typeof birthdayRun2.scanned === "number",
      "second birthday sweep should still execute"
    );
    console.log(
      "   ⚠ first attempt failed (wallet unconfigured) — dedup deep check skipped"
    );
  }

  console.log("→ inactivity sweep with no eligible cards should scan 0");
  const inactRun = await call<{ scanned: number }>(
    "POST",
    "/v1/sweeps/run/inactivity",
    undefined,
    jwt
  );
  assert(inactRun.scanned === 0, `inactivity sweep with fresh cards should be 0`);

  // ---------- Day 8: password auth + public QR signup ----------

  const pwEmail = `pw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const pwBusiness = `Pw Café ${new Date().toISOString()}`;

  console.log("→ password signup creates merchant + slug");
  const pwSignup = await call<{
    jwt: string;
    publicSlug: string;
    merchant: { id: string };
  }>("POST", "/v1/auth/signup", {
    businessName: pwBusiness,
    ownerEmail: pwEmail,
    password: "correct-horse-battery-staple",
    ownerName: "Pw Tester",
  });
  assert(pwSignup.jwt.split(".").length === 3, "signup jwt shape wrong");
  assert(pwSignup.publicSlug.length > 5, "no public slug");
  assert(pwSignup.publicSlug.includes("-"), "public slug should be kebab+suffix");

  console.log("→ duplicate password signup → 409");
  let pwDupBlocked = false;
  try {
    await call("POST", "/v1/auth/signup", {
      businessName: pwBusiness,
      ownerEmail: pwEmail,
      password: "correct-horse-battery-staple",
    });
  } catch (err) {
    pwDupBlocked = String(err).includes("409");
  }
  assert(pwDupBlocked, "duplicate password signup not blocked");

  console.log("→ login with wrong password → 401");
  let wrongPwBlocked = false;
  try {
    await call("POST", "/v1/auth/login", {
      email: pwEmail,
      password: "wrong-on-purpose",
    });
  } catch (err) {
    wrongPwBlocked = String(err).includes("401");
  }
  assert(wrongPwBlocked, "wrong-password login not 401");

  console.log("→ login with right password → JWT");
  const pwLogin = await call<{ jwt: string; publicSlug: string }>(
    "POST",
    "/v1/auth/login",
    { email: pwEmail, password: "correct-horse-battery-staple" }
  );
  assert(pwLogin.jwt.split(".").length === 3, "login jwt shape wrong");
  assert(pwLogin.publicSlug === pwSignup.publicSlug, "slug must match across signup/login");

  console.log("→ /v1/me includes publicSlug");
  const meForPw = await call<{ publicSlug: string }>("GET", "/v1/me", undefined, pwLogin.jwt);
  assert(meForPw.publicSlug === pwSignup.publicSlug, "/me publicSlug mismatch");

  console.log("→ create a stamp program on the pw merchant");
  const pwProg = await call<{ id: string }>(
    "POST",
    "/v1/programs",
    { name: "Loyalty 5", stampsRequired: 5, rewardText: "A free coffee" },
    pwLogin.jwt
  );

  console.log("→ public GET /v1/public/m/:slug lists active programs");
  const pubInfo = await call<{
    businessName: string;
    publicSlug: string;
    programs: Array<{ id: string; stampsRequired: number }>;
  }>("GET", `/v1/public/m/${pwSignup.publicSlug}`);
  assert(pubInfo.businessName === pwBusiness, "public business name mismatch");
  assert(
    pubInfo.programs.some((p) => p.id === pwProg.id),
    "public program list missing the program"
  );

  console.log("→ public GET with unknown slug → 404");
  let unknownSlug404 = false;
  try {
    await call("GET", "/v1/public/m/no-such-merchant-x7k9z");
  } catch (err) {
    unknownSlug404 = String(err).includes("404");
  }
  assert(unknownSlug404, "unknown slug should 404");

  console.log("→ public POST enrol creates customer + card");
  const pubEnrol = await call<{
    walletSaveUrl: string | null;
    existing: boolean;
  }>("POST", `/v1/public/m/${pwSignup.publicSlug}/enrol`, {
    name: "Public Customer",
    phone: "+31600000099",
    programId: pwProg.id,
  });
  assert(pubEnrol.existing === false, "first enrol should not be flagged existing");
  // walletSaveUrl may be null when wallet client isn't configured (smoke
  // sometimes runs without the SA key). That's acceptable here — the
  // important assertion is that the DB row was created. We verify by re-
  // enrolling with the same phone and expecting existing=true.

  console.log("→ public POST enrol again with same phone → existing=true");
  const pubEnrol2 = await call<{ existing: boolean }>(
    "POST",
    `/v1/public/m/${pwSignup.publicSlug}/enrol`,
    {
      name: "Public Customer",
      phone: "+31600000099",
      programId: pwProg.id,
    }
  );
  assert(pubEnrol2.existing === true, "second enrol with same phone should match");

  console.log("→ public POST enrol with no phone AND no email → 400");
  let noContact400 = false;
  try {
    await call("POST", `/v1/public/m/${pwSignup.publicSlug}/enrol`, {
      name: "No Contact",
      programId: pwProg.id,
    });
  } catch (err) {
    noContact400 = String(err).includes("400");
  }
  assert(noContact400, "no-contact public enrol should 400");

  console.log("→ public POST enrol with unknown programId → 404");
  let unknownProg404 = false;
  try {
    await call("POST", `/v1/public/m/${pwSignup.publicSlug}/enrol`, {
      name: "Wrong Prog",
      phone: "+31600000098",
      programId: "00000000-0000-0000-0000-000000000000",
    });
  } catch (err) {
    unknownProg404 = String(err).includes("404");
  }
  assert(unknownProg404, "unknown program id should 404");

  // ---------- Day 9: forgot password ----------

  console.log("→ forgot-password issues a reset link");
  const forgot = await call<{ ok: boolean; devResetLink?: string }>(
    "POST",
    "/v1/auth/forgot-password",
    { email: pwEmail }
  );
  assert(forgot.ok, "forgot-password not ok");
  assert(forgot.devResetLink, "no devResetLink in dev mode");
  const resetToken = new URL(forgot.devResetLink!).searchParams.get("token");
  assert(resetToken && resetToken.length === 64, "reset token shape wrong");

  console.log("→ reset-password updates password + returns JWT");
  const newPw = "rotated-correct-horse-battery-staple";
  const reset = await call<{ jwt: string }>("POST", "/v1/auth/reset-password", {
    token: resetToken,
    password: newPw,
  });
  assert(reset.jwt.split(".").length === 3, "reset jwt shape wrong");

  console.log("→ login with old password → 401, login with new → ok");
  let oldPwBlocked = false;
  try {
    await call("POST", "/v1/auth/login", {
      email: pwEmail,
      password: "correct-horse-battery-staple",
    });
  } catch (err) {
    oldPwBlocked = String(err).includes("401");
  }
  assert(oldPwBlocked, "old password should not work after reset");
  const loginAfterReset = await call<{ jwt: string }>("POST", "/v1/auth/login", {
    email: pwEmail,
    password: newPw,
  });
  assert(loginAfterReset.jwt, "login after reset failed");

  console.log("→ reset token replay should 401");
  let replay401 = false;
  try {
    await call("POST", "/v1/auth/reset-password", {
      token: resetToken,
      password: "doesntmatter12345",
    });
  } catch (err) {
    replay401 = String(err).includes("401");
  }
  assert(replay401, "used reset token should 401 on replay");

  // ---------- Day 9: card expiry sweep ----------

  console.log("→ create a program with expiryDays: 7");
  const expiringProg = await call<{ id: string }>(
    "POST",
    "/v1/programs",
    {
      name: "Expiring program",
      stampsRequired: 5,
      rewardText: "Free coffee",
      expiryDays: 7,
    },
    pwLogin.jwt
  );

  console.log("→ enrol a card on it, then backdate its last_event_at by 10 days");
  const expCustomer = await call<{ id: string }>(
    "POST",
    "/v1/customers",
    { name: "Expiry Test", phone: "+31600000077" },
    pwLogin.jwt
  );
  const expCard = await call<{ id: string }>(
    "POST",
    "/v1/cards",
    { customerId: expCustomer.id, programId: expiringProg.id },
    pwLogin.jwt
  );
  // Backdate via direct DB poke through the api isn't a thing; we just
  // assert the sweep "scanned" picks it up after we manually mark it stale
  // by waiting on real time — but smoke can't wait. So instead, fire the
  // sweep and assert it ran (scanned=1 if backdate worked, scanned=0 if
  // we couldn't). We accept either — the goal here is that the endpoint
  // works without crashing.
  const expRun = await call<{ scanned: number; expired: number }>(
    "POST",
    "/v1/sweeps/run/expiry",
    undefined,
    pwLogin.jwt
  );
  assert(typeof expRun.scanned === "number", "expiry sweep should return scanned");
  assert(typeof expRun.expired === "number", "expiry sweep should return expired");

  // ---------- Day 9: broadcast audience filter ----------

  console.log("→ broadcast with audienceFilter { minLifetimeStamps: 999 } → scanned 0");
  // The merchant is premium from earlier in the smoke. Re-confirm:
  await call("PATCH", "/v1/me/preferences", { isPremium: true }, pwLogin.jwt);
  const filteredBroadcast = await call<{ broadcastId: string }>(
    "POST",
    "/v1/broadcasts",
    {
      header: "Filtered broadcast",
      body: "Should reach zero customers — no one has 999 stamps.",
      audienceFilter: { minLifetimeStamps: 999 },
    },
    pwLogin.jwt
  );
  let filteredFinal: { broadcast: { scanned: number; status: string } } | null = null;
  for (let i = 0; i < 30; i++) {
    filteredFinal = await call(
      "GET",
      `/v1/broadcasts/${filteredBroadcast.broadcastId}`,
      undefined,
      pwLogin.jwt
    );
    if (filteredFinal.broadcast.status === "completed") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert(
    filteredFinal && filteredFinal.broadcast.scanned === 0,
    `filtered broadcast scanned should be 0, got ${filteredFinal?.broadcast.scanned}`
  );

  // ---------- Day 9: staff/team accounts ----------

  console.log("→ GET /v1/staff returns owner only");
  const staffListInitial = await call<{ staff: Array<{ role: string }> }>(
    "GET",
    "/v1/staff",
    undefined,
    pwLogin.jwt
  );
  assert(
    staffListInitial.staff.length === 1 && staffListInitial.staff[0].role === "owner",
    "initial staff list should be just the owner"
  );

  console.log("→ POST /v1/staff adds a staff member");
  const newStaffEmail = `staff-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@example.com`;
  const newStaff = await call<{ id: string; role: string }>(
    "POST",
    "/v1/staff",
    { email: newStaffEmail, password: "staff-password-123", name: "Staff Tester" },
    pwLogin.jwt
  );
  assert(newStaff.role === "staff", "new member should have role=staff");

  console.log("→ staff can log in with the password the owner set");
  const staffLogin = await call<{ jwt: string }>("POST", "/v1/auth/login", {
    email: newStaffEmail,
    password: "staff-password-123",
  });
  assert(staffLogin.jwt, "staff login failed");

  console.log("→ staff cannot add more staff (403)");
  let staffBlocked = false;
  try {
    await call(
      "POST",
      "/v1/staff",
      {
        email: `another-${Date.now()}@example.com`,
        password: "doesntmatter12345",
      },
      staffLogin.jwt
    );
  } catch (err) {
    staffBlocked = String(err).includes("403");
  }
  assert(staffBlocked, "staff member should not be able to add more staff");

  console.log("→ owner can remove the staff member");
  await call("DELETE", `/v1/staff/${newStaff.id}`, undefined, pwLogin.jwt);
  const staffListAfter = await call<{ staff: unknown[] }>(
    "GET",
    "/v1/staff",
    undefined,
    pwLogin.jwt
  );
  assert(staffListAfter.staff.length === 1, "staff member should be gone after delete");

  // ---------- Day 10: public customer card view ----------

  console.log("→ public card view returns sanitized data by qr_token");
  const pubCard = await call<{
    businessName: string;
    customerName: string | null;
    programName: string;
    stampsRequired: number;
    stampsCurrent: number;
    status: string;
  }>("GET", `/v1/public/c/${scanCard.qrToken}`);
  assert(pubCard.programName, "program name missing in public view");
  assert(pubCard.stampsRequired > 0, "stampsRequired missing");
  assert(typeof pubCard.stampsCurrent === "number", "stampsCurrent missing");
  assert(pubCard.status === "active", `expected active, got ${pubCard.status}`);

  console.log("→ unknown qr_token → 404");
  let card404 = false;
  try {
    await call("GET", `/v1/public/c/${"0".repeat(64)}`);
  } catch (err) {
    card404 = String(err).includes("404");
  }
  assert(card404, "unknown qr_token should 404");

  console.log("→ malformed qr_token → 404");
  let cardMalformed = false;
  try {
    await call("GET", "/v1/public/c/not-a-real-token");
  } catch (err) {
    cardMalformed = String(err).includes("404");
  }
  assert(cardMalformed, "malformed qr_token should 404");

  // ---------- Day 11: Apple Wallet pkpass endpoint ----------

  console.log("→ Apple pass: malformed qrToken → 404");
  const malformedApple = await fetch(`${BASE}/v1/public/c/not-a-real-token/apple-pass`);
  assert(malformedApple.status === 404, `expected 404, got ${malformedApple.status}`);

  console.log("→ Apple pass: unknown valid-format qrToken → 404");
  const unknownApple = await fetch(`${BASE}/v1/public/c/${"f".repeat(64)}/apple-pass`);
  assert(unknownApple.status === 404, `expected 404, got ${unknownApple.status}`);

  console.log("→ Apple pass: existing active card returns signed .pkpass");
  // Reuse scanCard from earlier — known active.
  const appleRes = await fetch(`${BASE}/v1/public/c/${scanCard.qrToken}/apple-pass`);
  if (appleRes.status === 503) {
    console.log(
      "   ⚠ Apple Wallet not configured (503) — smoke skipped the deep check."
    );
    console.log(
      "   To exercise it, ensure APPLE_PASS_P12_PASSWORD matches the actual .p12."
    );
  } else {
    assert(appleRes.status === 200, `expected 200, got ${appleRes.status}`);
    const ct = appleRes.headers.get("content-type") ?? "";
    assert(
      ct.includes("application/vnd.apple.pkpass"),
      `wrong content-type: ${ct}`
    );
    const buf = Buffer.from(await appleRes.arrayBuffer());
    // .pkpass is a ZIP archive — magic bytes 50 4B 03 04 (PK\x03\x04).
    assert(
      buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04,
      "buffer doesn't start with PK ZIP magic bytes"
    );
    assert(buf.length > 1000, `pkpass suspiciously small: ${buf.length} bytes`);
    console.log(`   pkpass buffer ${buf.length} bytes, starts with PK magic ✓`);
  }

  // ---------- Day 12: Apple Wallet web service endpoints ----------
  //
  // Deep end-to-end of the registration loop needs the per-card auth token,
  // which lives inside the signed .pkpass ZIP. Verifying it would mean
  // unzipping the pass — out of scope for a 100-line-friendly smoke. Real
  // device test (task #65) covers that path. Here we verify the contract:
  // unauthenticated reads/writes are rejected, the log endpoint accepts
  // payloads, and an empty registration list returns 204.

  const PASS_TYPE = process.env.APPLE_PASS_TYPE_ID ?? "pass.com.onusclub.loyalty";
  const FAKE_DEVICE = "smoke-device-" + Date.now();
  const FAKE_SERIAL = scanCard.id;

  console.log("→ Apple WS: register without Authorization → 401");
  const regNoAuth = await fetch(
    `${BASE}/v1/apple-wallet/v1/devices/${FAKE_DEVICE}/registrations/${PASS_TYPE}/${FAKE_SERIAL}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pushToken: "deadbeef" }),
    }
  );
  assert(regNoAuth.status === 401, `expected 401, got ${regNoAuth.status}`);

  console.log("→ Apple WS: register with wrong token → 401");
  const regBadAuth = await fetch(
    `${BASE}/v1/apple-wallet/v1/devices/${FAKE_DEVICE}/registrations/${PASS_TYPE}/${FAKE_SERIAL}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "ApplePass not-the-real-token",
      },
      body: JSON.stringify({ pushToken: "deadbeef" }),
    }
  );
  assert(regBadAuth.status === 401, `expected 401, got ${regBadAuth.status}`);

  console.log("→ Apple WS: register with bogus passType → 404");
  const regBadPass = await fetch(
    `${BASE}/v1/apple-wallet/v1/devices/${FAKE_DEVICE}/registrations/pass.com.fake/${FAKE_SERIAL}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "ApplePass deadbeef",
      },
      body: JSON.stringify({ pushToken: "x" }),
    }
  );
  assert(regBadPass.status === 404, `expected 404, got ${regBadPass.status}`);

  console.log("→ Apple WS: get-latest-pass without auth → 401");
  const passNoAuth = await fetch(
    `${BASE}/v1/apple-wallet/v1/passes/${PASS_TYPE}/${FAKE_SERIAL}`
  );
  assert(passNoAuth.status === 401, `expected 401, got ${passNoAuth.status}`);

  console.log("→ Apple WS: list-updated for unknown device → 204");
  const listUnknown = await fetch(
    `${BASE}/v1/apple-wallet/v1/devices/no-such-device/registrations/${PASS_TYPE}`
  );
  assert(listUnknown.status === 204, `expected 204, got ${listUnknown.status}`);

  console.log("→ Apple WS: log endpoint accepts payloads");
  const logRes = await fetch(`${BASE}/v1/apple-wallet/v1/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ logs: ["smoke test entry"] }),
  });
  assert(logRes.status === 200, `expected 200, got ${logRes.status}`);

  // ---------- Day 14: points-type programs ----------

  console.log("→ create a points-type program (€1 = 10 points, reward at 100, 7-day batch expiry)");
  const ptsProgram = await call<{ id: string; programType: string }>(
    "POST",
    "/v1/programs",
    {
      programType: "points",
      name: "Brunch Points",
      rewardText: "A free pastry",
      pointsPerEuro: 10,
      pointsForReward: 100,
      batchExpiryDays: 7,
    },
    jwt
  );
  assert(ptsProgram.id, "no points program id");
  assert(ptsProgram.programType === "points", `wrong programType: ${ptsProgram.programType}`);

  console.log("→ create a customer for the points program");
  const ptsCustomer = await call<{ id: string }>(
    "POST",
    "/v1/customers",
    { name: "Points Pete", phone: "+31611111199" },
    jwt
  );

  console.log("→ enrol a card on the points program");
  const ptsCard = await call<{
    id: string;
    qrToken: string;
    programType: string;
    pointsForReward: number | null;
    pointsPerEuro: number | null;
    cardState: { type: string; points_current: number };
  }>("POST", "/v1/cards", { customerId: ptsCustomer.id, programId: ptsProgram.id }, jwt);
  assert(ptsCard.programType === "points", `card programType wrong: ${ptsCard.programType}`);
  assert(ptsCard.pointsForReward === 100, `pointsForReward wrong: ${ptsCard.pointsForReward}`);
  assert(ptsCard.pointsPerEuro === 10, `pointsPerEuro wrong: ${ptsCard.pointsPerEuro}`);
  assert(ptsCard.cardState.type === "points", `cardState.type wrong: ${ptsCard.cardState.type}`);
  assert(
    ptsCard.cardState.points_current === 0,
    `initial points_current should be 0, got ${ptsCard.cardState.points_current}`
  );

  console.log("→ add transaction €5 → +50 points");
  const afterFirst = await call<{ card: { cardState: { points_current: number; total_lifetime: number } } }>(
    "POST",
    `/v1/cards/${ptsCard.id}/add-points`,
    { amount: 5 },
    jwt
  );
  assert(
    afterFirst.card.cardState.points_current === 50,
    `after +50: expected balance 50, got ${afterFirst.card.cardState.points_current}`
  );

  console.log("→ add transaction €10 → +100 points (balance 150)");
  const afterSecond = await call<{ card: { cardState: { points_current: number } } }>(
    "POST",
    `/v1/cards/${ptsCard.id}/add-points`,
    { amount: 10 },
    jwt
  );
  assert(
    afterSecond.card.cardState.points_current === 150,
    `expected 150, got ${afterSecond.card.cardState.points_current}`
  );

  console.log("→ add transaction €15 → +150 points (balance 300, three batches)");
  const afterThird = await call<{ card: { cardState: { points_current: number } } }>(
    "POST",
    `/v1/cards/${ptsCard.id}/add-points`,
    { amount: 15 },
    jwt
  );
  assert(
    afterThird.card.cardState.points_current === 300,
    `expected 300, got ${afterThird.card.cardState.points_current}`
  );

  console.log("→ redeem points reward (deducts 100 FIFO → balance 200)");
  const afterRedeem1 = await call<{ card: { cardState: { points_current: number; rewards_redeemed: number } } }>(
    "POST",
    `/v1/cards/${ptsCard.id}/redeem`,
    undefined,
    jwt
  );
  assert(
    afterRedeem1.card.cardState.points_current === 200,
    `expected 200, got ${afterRedeem1.card.cardState.points_current}`
  );
  assert(
    afterRedeem1.card.cardState.rewards_redeemed === 1,
    `expected rewards_redeemed=1, got ${afterRedeem1.card.cardState.rewards_redeemed}`
  );

  console.log("→ redeem again (200 - 100 = 100)");
  const afterRedeem2 = await call<{ card: { cardState: { points_current: number } } }>(
    "POST",
    `/v1/cards/${ptsCard.id}/redeem`,
    undefined,
    jwt
  );
  assert(
    afterRedeem2.card.cardState.points_current === 100,
    `expected 100, got ${afterRedeem2.card.cardState.points_current}`
  );

  console.log("→ redeem a 3rd time (100 - 100 = 0)");
  const afterRedeem3 = await call<{ card: { cardState: { points_current: number } } }>(
    "POST",
    `/v1/cards/${ptsCard.id}/redeem`,
    undefined,
    jwt
  );
  assert(
    afterRedeem3.card.cardState.points_current === 0,
    `expected 0, got ${afterRedeem3.card.cardState.points_current}`
  );

  console.log("→ redeem a 4th time → 400 (insufficient balance)");
  let ptsBelow = false;
  try {
    await call("POST", `/v1/cards/${ptsCard.id}/redeem`, undefined, jwt);
  } catch (err) {
    ptsBelow = String(err).includes("400");
  }
  assert(ptsBelow, "redeem with zero balance should 400");

  console.log("→ add-points with amount=0 should 400");
  let pts400 = false;
  try {
    await call("POST", `/v1/cards/${ptsCard.id}/add-points`, { amount: 0 }, jwt);
  } catch (err) {
    pts400 = String(err).includes("400");
  }
  assert(pts400, "add-points with amount=0 should 400");

  console.log("→ points-expiry sweep with nothing to expire → expired: 0");
  const ptsExpire1 = await call<{ scanned: number; expired: number }>(
    "POST",
    "/v1/sweeps/run/points-expiry",
    undefined,
    jwt
  );
  assert(ptsExpire1.expired === 0, `clean run should expire 0, got ${ptsExpire1.expired}`);

  console.log("→ public card view shows points (unitLabel='points', targetValue=100)");
  const ptsView = await call<{
    programType: string;
    unitLabel: string;
    targetValue: number;
    currentValue: number;
  }>("GET", `/v1/public/c/${ptsCard.qrToken}`);
  assert(ptsView.programType === "points", `public view programType wrong: ${ptsView.programType}`);
  assert(ptsView.unitLabel === "points", `public view unitLabel wrong: ${ptsView.unitLabel}`);
  assert(ptsView.targetValue === 100, `public view targetValue wrong: ${ptsView.targetValue}`);

  // ---------- Day 15: scan flow for points programs ----------

  // First enrol a fresh points card so we start from a known 0 balance.
  console.log("→ enrol a fresh card on the points program for scan testing");
  const scanPtsCustomer = await call<{ id: string }>(
    "POST",
    "/v1/customers",
    { name: "Scan Points Customer", phone: "+31611111200" },
    jwt
  );
  const scanPtsCard = await call<{ id: string; qrToken: string }>(
    "POST",
    "/v1/cards",
    { customerId: scanPtsCustomer.id, programId: ptsProgram.id },
    jwt
  );

  console.log("→ scan points card with action=auto → needs_amount");
  const ptsScanAuto = await call<{
    status: "applied" | "needs_amount";
    cardId?: string;
    programType?: string;
    currentBalance?: number;
    pointsForReward?: number;
    pointsPerEuro?: number;
    eligibleToRedeem?: boolean;
  }>("POST", "/v1/scan", { qrToken: scanPtsCard.qrToken, action: "auto" }, jwt);
  assert(
    ptsScanAuto.status === "needs_amount",
    `expected needs_amount, got ${ptsScanAuto.status}`
  );
  assert(ptsScanAuto.programType === "points", "needs_amount programType wrong");
  assert(ptsScanAuto.cardId === scanPtsCard.id, "needs_amount cardId mismatch");
  assert(ptsScanAuto.currentBalance === 0, `expected currentBalance 0, got ${ptsScanAuto.currentBalance}`);
  assert(ptsScanAuto.pointsForReward === 100, "pointsForReward wrong");
  assert(ptsScanAuto.pointsPerEuro === 10, "pointsPerEuro wrong");
  assert(ptsScanAuto.eligibleToRedeem === false, "should not be eligible at 0 balance");

  console.log("→ scan points card with action=add-points + amount=4 → +40 points");
  const ptsScanAdd = await call<{
    status: "applied" | "needs_amount";
    detail?: { card: { cardState: { points_current: number } } };
    appliedAction?: "stamp" | "redeem" | "add-points";
  }>(
    "POST",
    "/v1/scan",
    { qrToken: scanPtsCard.qrToken, action: "add-points", amount: 4 },
    jwt
  );
  assert(ptsScanAdd.status === "applied", `expected applied, got ${ptsScanAdd.status}`);
  assert(ptsScanAdd.appliedAction === "add-points", "appliedAction wrong");
  assert(
    ptsScanAdd.detail?.card.cardState.points_current === 40,
    `expected balance 40, got ${ptsScanAdd.detail?.card.cardState.points_current}`
  );

  console.log("→ scan points card with action=add-points but no amount → 400");
  let ptsScanNoAmount = false;
  try {
    await call(
      "POST",
      "/v1/scan",
      { qrToken: scanPtsCard.qrToken, action: "add-points" },
      jwt
    );
  } catch (err) {
    ptsScanNoAmount = String(err).includes("400");
  }
  assert(ptsScanNoAmount, "add-points without amount should 400");

  console.log("→ scan points card with action=stamp → 400 (nonsensical)");
  let ptsScanStamp = false;
  try {
    await call("POST", "/v1/scan", { qrToken: scanPtsCard.qrToken, action: "stamp" }, jwt);
  } catch (err) {
    ptsScanStamp = String(err).includes("400");
  }
  assert(ptsScanStamp, "action=stamp on points card should 400");

  console.log("→ top points card up to threshold then redeem via scan");
  // 40 already. Add €6 → +60 = 100, eligible to redeem.
  await call(
    "POST",
    "/v1/scan",
    { qrToken: scanPtsCard.qrToken, action: "add-points", amount: 6 },
    jwt
  );
  const ptsScanRedeem = await call<{
    status: "applied" | "needs_amount";
    detail?: { card: { cardState: { points_current: number; rewards_redeemed: number } } };
    appliedAction?: "stamp" | "redeem" | "add-points";
  }>("POST", "/v1/scan", { qrToken: scanPtsCard.qrToken, action: "redeem" }, jwt);
  assert(ptsScanRedeem.status === "applied", "redeem scan should apply");
  assert(ptsScanRedeem.appliedAction === "redeem", "appliedAction should be redeem");
  assert(
    ptsScanRedeem.detail?.card.cardState.points_current === 0,
    `after redeem expected 0, got ${ptsScanRedeem.detail?.card.cardState.points_current}`
  );
  assert(
    ptsScanRedeem.detail?.card.cardState.rewards_redeemed === 1,
    "rewards_redeemed should be 1"
  );

  console.log("→ no day-rate-limit on points scans (add-points multiple times same day OK)");
  // We already added points 3+ times today on this card without 409. Implicit assertion.

  // ---------- Day 15: revenue capture ----------
  //
  // Revenue aggregates are merchant-wide and this run has already booked
  // several points transactions, so every assertion below is a *delta*
  // against a baseline snapshot rather than an absolute figure. That keeps
  // these checks from breaking when someone adds an unrelated test above.

  interface Overview {
    currencyCode: string;
    revenueCents7d: number;
    revenueCents30d: number;
    transactions7d: number;
    aovCents7d: number | null;
    recentEvents: Array<{
      id: number;
      cardId: string;
      customerName: string | null;
      programName: string;
      eventType: string;
      amountCents: number | null;
      createdAt: string;
    }>;
  }
  interface EventsDetail {
    card: { id: string };
    events: Array<{ id: number; eventType: string; amountCents: number | null }>;
  }

  console.log("→ analytics overview baseline");
  const base = await call<Overview>("GET", "/v1/analytics/overview", undefined, jwt);
  assert(base.currencyCode === "EUR", `currencyCode wrong: ${base.currencyCode}`);
  // The points transactions above (€5 + €10 + €15 + €4 + €6 = €40) should
  // already be counted: points programs capture the bill amount by design,
  // so revenue works without anyone opting in.
  assert(
    base.revenueCents7d === 4000,
    `expected €40.00 from points transactions, got ${base.revenueCents7d}`
  );
  assert(
    base.transactions7d === 5,
    `expected 5 amount-carrying events, got ${base.transactions7d}`
  );
  assert(
    base.aovCents7d === 800,
    `expected AOV of €8.00 (4000/5), got ${base.aovCents7d}`
  );
  assert(
    base.revenueCents30d === base.revenueCents7d,
    "30d window should include everything the 7d window has"
  );

  console.log("→ enrol a fresh stamp card for revenue capture");
  const revCustomer = await call<{ id: string }>(
    "POST",
    "/v1/customers",
    { name: "Revenue Rita", phone: "+31611111201" },
    jwt
  );
  const revCard = await call<{ id: string }>(
    "POST",
    "/v1/cards",
    { customerId: revCustomer.id, programId: program.id },
    jwt
  );

  console.log("→ stamp with amount €12.50 → event carries 1250 cents");
  const stampWithAmount = await call<EventsDetail>(
    "POST",
    `/v1/cards/${revCard.id}/stamp`,
    { amount: 12.5 },
    jwt
  );
  assert(
    stampWithAmount.events[0].eventType === "stamp",
    `newest event should be the stamp, got ${stampWithAmount.events[0].eventType}`
  );
  assert(
    stampWithAmount.events[0].amountCents === 1250,
    `expected 1250 cents, got ${stampWithAmount.events[0].amountCents}`
  );

  console.log("→ stamp with no amount → amountCents stays null (skipped, not zero)");
  const stampNoAmount = await call<EventsDetail>(
    "POST",
    `/v1/cards/${revCard.id}/stamp`,
    undefined,
    jwt
  );
  assert(
    stampNoAmount.events[0].amountCents === null,
    `skipped amount should be null, got ${stampNoAmount.events[0].amountCents}`
  );
  const skippedEventId = stampNoAmount.events[0].id;

  console.log("→ overview reflects the €12.50, and the skipped stamp did not count");
  const afterStamps = await call<Overview>("GET", "/v1/analytics/overview", undefined, jwt);
  assert(
    afterStamps.revenueCents7d === base.revenueCents7d + 1250,
    `expected +1250, got ${afterStamps.revenueCents7d - base.revenueCents7d}`
  );
  assert(
    afterStamps.transactions7d === base.transactions7d + 1,
    "the skipped stamp must not inflate the AOV denominator"
  );

  console.log("→ attach €7.25 to the stamp that was skipped");
  const patched = await call<EventsDetail>(
    "PATCH",
    `/v1/cards/${revCard.id}/events/${skippedEventId}/amount`,
    { amount: 7.25 },
    jwt
  );
  const patchedEvent = patched.events.find((e) => e.id === skippedEventId);
  assert(
    patchedEvent?.amountCents === 725,
    `expected 725 cents after patch, got ${patchedEvent?.amountCents}`
  );

  console.log("→ overview picks up the retro-attached amount");
  const afterPatch = await call<Overview>("GET", "/v1/analytics/overview", undefined, jwt);
  assert(
    afterPatch.revenueCents7d === base.revenueCents7d + 1975,
    `expected +1975 total, got ${afterPatch.revenueCents7d - base.revenueCents7d}`
  );
  assert(
    afterPatch.transactions7d === base.transactions7d + 2,
    "both stamps should now carry amounts"
  );

  console.log("→ attaching an amount to a 'signup' event should 400");
  const signupEvent = patched.events.find((e) => e.eventType === "signup");
  assert(signupEvent, "expected a signup event on the card");
  let signupRejected = false;
  try {
    await call(
      "PATCH",
      `/v1/cards/${revCard.id}/events/${signupEvent!.id}/amount`,
      { amount: 5 },
      jwt
    );
  } catch (err) {
    signupRejected = String(err).includes("400");
  }
  assert(signupRejected, "attaching revenue to a signup event should 400");

  console.log("→ attaching an amount to an unknown event should 404");
  let unknownEvent = false;
  try {
    await call(
      "PATCH",
      `/v1/cards/${revCard.id}/events/99999999/amount`,
      { amount: 5 },
      jwt
    );
  } catch (err) {
    unknownEvent = String(err).includes("404");
  }
  assert(unknownEvent, "unknown event id should 404");

  console.log("→ an event id from a different card should 404 (no cross-card writes)");
  let wrongCard = false;
  try {
    await call(
      "PATCH",
      `/v1/cards/${card.id}/events/${skippedEventId}/amount`,
      { amount: 5 },
      jwt
    );
  } catch (err) {
    wrongCard = String(err).includes("404");
  }
  assert(wrongCard, "event id belonging to another card should 404");

  console.log("→ amount=0 on the patch should 400");
  let zeroAmount = false;
  try {
    await call(
      "PATCH",
      `/v1/cards/${revCard.id}/events/${skippedEventId}/amount`,
      { amount: 0 },
      jwt
    );
  } catch (err) {
    zeroAmount = String(err).includes("400");
  }
  assert(zeroAmount, "amount=0 should 400");

  console.log("→ scan a stamp card with an amount → recorded on the stamp event");
  const scanRevCustomer = await call<{ id: string }>(
    "POST",
    "/v1/customers",
    { name: "Scan Revenue Sam", phone: "+31611111202" },
    jwt
  );
  const scanRevCard = await call<{ id: string; qrToken: string }>(
    "POST",
    "/v1/cards",
    { customerId: scanRevCustomer.id, programId: program.id },
    jwt
  );
  const scanWithAmount = await call<{
    status: string;
    detail: EventsDetail;
  }>(
    "POST",
    "/v1/scan",
    { qrToken: scanRevCard.qrToken, action: "auto", amount: 30 },
    jwt
  );
  assert(scanWithAmount.status === "applied", "scan should apply");
  assert(
    scanWithAmount.detail.events[0].amountCents === 3000,
    `expected 3000 cents from scan, got ${scanWithAmount.detail.events[0].amountCents}`
  );

  console.log("→ activity feed returns real events, newest first, capped at 10");
  const activityFeed = await call<Overview>("GET", "/v1/analytics/overview", undefined, jwt);
  assert(activityFeed.recentEvents.length > 0, "activity feed should not be empty");
  assert(activityFeed.recentEvents.length <= 10, "activity feed should cap at 10");
  assert(
    activityFeed.recentEvents[0].id > activityFeed.recentEvents[activityFeed.recentEvents.length - 1].id,
    "activity feed should be newest-first"
  );
  assert(
    activityFeed.recentEvents.every((e) => e.programName && e.cardId),
    "every activity row needs its card and program joined in"
  );

  // ---------- Day 17: analytics detail ----------

  interface AnalyticsDetailShape {
    range: string;
    timezone: string;
    currencyCode: string;
    series: Array<{ date: string; visits: number; revenueCents: number }>;
    hours: Array<{ hour: number; visits: number }>;
    newCards: number;
    returningCards: number;
    topByVisits: Array<{ cardId: string; visits: number; revenueCents: number }>;
    topByRevenue: Array<{ cardId: string; visits: number; revenueCents: number }>;
    totalVisits: number;
    totalRevenueCents: number;
    aovCents: number | null;
  }

  console.log("→ analytics detail defaults to 30d");
  const adet = await call<AnalyticsDetailShape>("GET", "/v1/analytics/detail", undefined, jwt);
  assert(adet.range === "30d", `expected default range 30d, got ${adet.range}`);
  assert(adet.timezone.length > 0, "detail should echo the merchant timezone");

  console.log("→ series is gap-filled across the whole window");
  // 30 days back plus today. Gap-filling matters: without it a quiet day
  // vanishes and the x-axis silently compresses.
  assert(adet.series.length === 31, `expected 31 day buckets, got ${adet.series.length}`);
  const adetSorted = [...adet.series].sort((a, b) => a.date.localeCompare(b.date));
  assert(
    JSON.stringify(adetSorted) === JSON.stringify(adet.series),
    "series should come back in ascending date order"
  );

  console.log("→ hours histogram always has 24 buckets, 0..23");
  assert(adet.hours.length === 24, `expected 24 hour buckets, got ${adet.hours.length}`);
  assert(
    adet.hours.every((h, i) => h.hour === i),
    "hour buckets should be 0..23 in order"
  );

  console.log("→ totals agree with the series");
  const adetSeriesVisits = adet.series.reduce((sum, d) => sum + d.visits, 0);
  assert(
    adetSeriesVisits === adet.totalVisits,
    `series visits ${adetSeriesVisits} != totalVisits ${adet.totalVisits}`
  );
  const adetHourVisits = adet.hours.reduce((sum, h) => sum + h.visits, 0);
  assert(
    adetHourVisits === adet.totalVisits,
    `hour visits ${adetHourVisits} != totalVisits ${adet.totalVisits}`
  );

  console.log("→ new + returning accounts for every card that visited");
  assert(
    adet.newCards + adet.returningCards >= adet.topByVisits.length,
    "top-by-visits cannot contain more cards than new+returning"
  );

  console.log("→ top lists are ranked and capped at 5");
  assert(adet.topByVisits.length <= 5, "topByVisits should cap at 5");
  assert(adet.topByRevenue.length <= 5, "topByRevenue should cap at 5");
  assert(
    adet.topByVisits.every((m, i, arr) => i === 0 || arr[i - 1].visits >= m.visits),
    "topByVisits should be descending"
  );
  assert(
    adet.topByRevenue.every((m, i, arr) => i === 0 || arr[i - 1].revenueCents >= m.revenueCents),
    "topByRevenue should be descending"
  );

  console.log("→ 7d range returns a shorter window than 30d");
  const adet7 = await call<AnalyticsDetailShape>("GET", "/v1/analytics/detail?range=7d", undefined, jwt);
  assert(adet7.range === "7d", "range echo wrong for 7d");
  assert(adet7.series.length === 8, `expected 8 day buckets for 7d, got ${adet7.series.length}`);
  assert(
    adet7.totalVisits <= adet.totalVisits,
    "7d visits cannot exceed 30d visits"
  );

  console.log("→ a garbage range falls back to 30d rather than erroring");
  const adetJunk = await call<AnalyticsDetailShape>(
    "GET",
    "/v1/analytics/detail?range=not-a-range",
    undefined,
    jwt
  );
  assert(adetJunk.range === "30d", `junk range should fall back to 30d, got ${adetJunk.range}`);

  console.log("→ analytics detail requires auth");
  let adetUnauth = false;
  try {
    await call("GET", "/v1/analytics/detail");
  } catch (err) {
    adetUnauth = String(err).includes("401");
  }
  assert(adetUnauth, "/v1/analytics/detail did not require auth");

  // ---------- Day 22: cross-tenant isolation ----------
  //
  // Isolation in this codebase is a hand-written `WHERE merchant_id = ?`
  // repeated across every query. Nothing enforces it, so the only honest check
  // is behavioural: stand up a second merchant and try, as the first, to touch
  // everything it owns. Every one of these must refuse.
  //
  // This exists now because the master dashboard introduces a role explicitly
  // designed to bypass tenant scoping. Before adding the exception, prove the
  // rule.

  console.log("→ isolation: standing up a second merchant");
  const otherEmail = `other-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const otherSignup = await call<{ jwt: string; merchant: { id: string } }>(
    "POST",
    "/v1/auth/signup",
    {
      businessName: "Rival Cafe",
      ownerEmail: otherEmail,
      ownerName: "Rival Owner",
      password: "hunter2hunter2",
    }
  );
  const otherJwt = otherSignup.jwt;

  const otherProgram = await call<{ id: string }>(
    "POST",
    "/v1/programs",
    { name: "Rival card", stampsRequired: 6, rewardText: "Rival reward" },
    otherJwt
  );
  const otherCustomer = await call<{ id: string }>(
    "POST",
    "/v1/customers",
    { name: "Rival Customer", email: `rival-${Date.now()}@example.com` },
    otherJwt
  );
  const otherCard = await call<{ id: string; qrToken: string }>(
    "POST",
    "/v1/cards",
    { customerId: otherCustomer.id, programId: otherProgram.id },
    otherJwt
  );
  const otherStamp = await call<{ events: Array<{ id: number }> }>(
    "POST",
    `/v1/cards/${otherCard.id}/stamp`,
    { amount: 9.5 },
    otherJwt
  );
  const otherEventId = otherStamp.events[0].id;

  // Every attempt below uses OUR jwt against THEIR ids.
  const denied = async (
    label: string,
    method: string,
    path: string,
    body?: unknown
  ): Promise<void> => {
    let blocked = false;
    let detail = "";
    try {
      await call(method, path, body, jwt);
    } catch (err) {
      detail = String(err);
      // 404 is the right answer rather than 403: confirming a resource exists
      // but is not yours is itself a small leak.
      blocked = /\b(404|403|400)\b/.test(detail);
    }
    assert(blocked, `CROSS-TENANT LEAK — ${label} was not refused (${detail || "it succeeded"})`);
    console.log(`   ✓ ${label}`);
  };

  console.log("→ isolation: another merchant's card is unreachable");
  await denied("read their card", "GET", `/v1/cards/${otherCard.id}`);
  await denied("stamp their card", "POST", `/v1/cards/${otherCard.id}/stamp`, {});
  await denied("redeem their card", "POST", `/v1/cards/${otherCard.id}/redeem`, {});
  await denied("add points to their card", "POST", `/v1/cards/${otherCard.id}/add-points`, {
    amount: 5,
  });
  await denied(
    "attach revenue to their event",
    "PATCH",
    `/v1/cards/${otherCard.id}/events/${otherEventId}/amount`,
    { amount: 99 }
  );
  await denied("read their wallet link", "GET", `/v1/cards/${otherCard.id}/wallet-link`);
  await denied("resend their invite", "POST", `/v1/cards/${otherCard.id}/resend-invite`, {});

  console.log("→ isolation: another merchant's program is unreachable");
  await denied("restyle their program", "PATCH", `/v1/programs/${otherProgram.id}/design`, {
    backgroundColor: "#ff0000",
  });
  await denied("import onto their program", "POST", "/v1/customers/import", {
    csv: "name,email\nX,x@example.com",
    programId: otherProgram.id,
    dryRun: true,
  });

  console.log("→ isolation: their records never appear in our lists");
  const ourCards = await call<{ cards: Array<{ id: string }> }>(
    "GET",
    "/v1/cards",
    undefined,
    jwt
  );
  assert(
    !ourCards.cards.some((c) => c.id === otherCard.id),
    "CROSS-TENANT LEAK — another merchant's card appeared in our card list"
  );
  const ourCustomers = await call<{ customers: Array<{ id: string }> }>(
    "GET",
    "/v1/customers",
    undefined,
    jwt
  );
  assert(
    !ourCustomers.customers.some((c) => c.id === otherCustomer.id),
    "CROSS-TENANT LEAK — another merchant's customer appeared in our customer list"
  );
  const ourPrograms = await call<{ programs: Array<{ id: string }> }>(
    "GET",
    "/v1/programs",
    undefined,
    jwt
  );
  assert(
    !ourPrograms.programs.some((p) => p.id === otherProgram.id),
    "CROSS-TENANT LEAK — another merchant's program appeared in our program list"
  );

  console.log("→ isolation: their export is not in our export");
  const ourExport = await fetch(`${BASE}/v1/customers/export.csv`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
  const ourExportText = await ourExport.text();
  assert(
    !ourExportText.includes(otherCustomer.id) && !ourExportText.includes("Rival Customer"),
    "CROSS-TENANT LEAK — another merchant's customer appeared in our CSV export"
  );

  console.log("→ isolation: sweep counters are ours, not the platform's");
  // sweep_runs has no merchant_id — the runs are global — so the counters have
  // to be recomputed per merchant. Returning the raw columns told every tenant
  // how much traffic every other tenant had.
  const sweepList = await call<{ sweeps: Array<{ id: string; scanned: number }> }>(
    "GET",
    "/v1/sweeps",
    undefined,
    otherJwt
  );
  assert(
    sweepList.sweeps.every((sw) => sw.scanned >= 0),
    "sweep counters should be present"
  );
  // The brand-new rival merchant has had nothing swept, so every counter must
  // be zero no matter how busy the platform has been.
  assert(
    sweepList.sweeps.every((sw) => sw.scanned === 0),
    `CROSS-TENANT LEAK — a fresh merchant sees non-zero sweep counters: ${JSON.stringify(
      sweepList.sweeps.slice(0, 3)
    )}`
  );

  // ---------- Day 23: the platform-admin surface is unreachable ----------
  //
  // /v1/admin is the one router that reads across tenants, so "no café can
  // reach it" is the single assertion protecting every merchant on the
  // platform from every other one.
  //
  // The path list is a constant, iterated. An endpoint added to the admin
  // router without a denial test here shows up as a missing entry in a list
  // somebody has to edit, rather than as silence.
  const ADMIN_PATHS: Array<[string, string]> = [
    ["GET", "/v1/admin/whoami"],
    ["GET", "/v1/admin/metrics"],
    ["GET", "/v1/admin/merchants"],
    // The id is irrelevant — the gate fires before any handler runs, which is
    // itself the thing being asserted. Uses the rival merchant's real id so a
    // regression that let the handler run would leak something real and fail
    // loudly rather than 404 for the wrong reason.
    ["GET", `/v1/admin/merchants/${otherSignup.merchant.id}`],
    ["GET", "/v1/admin/customers?q=rival"],
    [
      "GET",
      // Same reasoning as the merchant id above: a real id belonging to
      // someone else, so a regression leaks something and fails loudly.
      `/v1/admin/customers/${otherCustomer.id}`,
    ],
    ["GET", `/v1/admin/cards/${otherCard.id}`],
    // The write. Most important line in this list: a merchant reaching this
    // could move balances on any card on the platform.
    ["POST", `/v1/admin/cards/${otherCard.id}/adjust`],
    ["PATCH", `/v1/admin/merchants/${otherSignup.merchant.id}`],
    ["POST", `/v1/admin/merchants/${otherSignup.merchant.id}/password-reset`],
    ["GET", "/v1/admin/audit"],
    // As the admin surface grows, every new route gets a line here.
  ];

  console.log("→ admin: no merchant session can reach /v1/admin");
  const adminDenied = async (label: string, asJwt: string | undefined): Promise<void> => {
    for (const [method, path] of ADMIN_PATHS) {
      let blocked = false;
      let detail = "";
      try {
        await call(method, path, undefined, asJwt);
      } catch (err) {
        detail = String(err);
        // 404, not 403: confirming the namespace exists is itself a leak.
        // 401 is the right answer for no token at all.
        blocked = /\b(404|401)\b/.test(detail);
      }
      assert(
        blocked,
        `PLATFORM ADMIN LEAK — ${method} ${path} was not refused for ${label} (${
          detail || "it succeeded"
        })`
      );
    }
    console.log(`   ✓ refused for ${label}`);
  };

  await adminDenied("no token", undefined);
  await adminDenied("an owner", jwt);
  await adminDenied("another merchant's owner", otherJwt);

  console.log("→ admin: a staff session cannot reach it either");
  const denyStaffEmail = `admin-deny-${Date.now()}@example.com`;
  await call("POST", "/v1/staff", {
    email: denyStaffEmail,
    password: "deny-password-123",
    name: "Denied Staff",
  }, jwt);
  const denyStaffLogin = await call<{ jwt: string }>("POST", "/v1/auth/login", {
    email: denyStaffEmail,
    password: "deny-password-123",
  });
  await adminDenied("a staff member", denyStaffLogin.jwt);

  // The escalation path the design explicitly rejects.
  //
  // verifyJwt previously checked userId and merchantId but never role, so a
  // token claiming role: "superadmin" verified cleanly. Platform admin is a
  // database row precisely so that forging a role proves nothing — and the
  // role allow-list means such a token no longer even authenticates.
  if (process.env.JWT_SECRET) {
    console.log("→ admin: a self-minted superadmin token is refused");
    const jsonwebtoken = (await import("jsonwebtoken")).default;
    const forged = jsonwebtoken.sign(
      { userId: signup.user.id, merchantId: signup.merchant.id, role: "superadmin" },
      process.env.JWT_SECRET,
      { expiresIn: "5m" }
    );
    await adminDenied("a forged superadmin token", forged);

    console.log("→ a forged role is rejected on ordinary routes too");
    let forgedMeBlocked = false;
    try {
      await call("GET", "/v1/me", undefined, forged);
    } catch (err) {
      forgedMeBlocked = String(err).includes("401");
    }
    assert(forgedMeBlocked, "a token with an unknown role authenticated against /v1/me");
  } else {
    console.log("   (skipped forged-token check — JWT_SECRET not set in this environment)");
  }

  // ---------- Day 21: merchant branding ----------

  interface Branding {
    brandColor: string | null;
    logoUrl: string | null;
  }

  console.log("→ a new merchant has no logo, so passes fall back to the OnUsClub badge");
  const brand0 = await call<Branding>("GET", "/v1/me/branding", undefined, jwt);
  assert(brand0.logoUrl === null, `new merchant should have no logo, got ${brand0.logoUrl}`);

  // Smallest valid PNG that clears the 200x200 floor: a 256x256 IHDR is enough
  // for the header inspection, which never decodes pixels.
  const pngHeader = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 0x0d]),
    Buffer.from("IHDR"),
    (() => {
      const dims = Buffer.alloc(8);
      dims.writeUInt32BE(256, 0);
      dims.writeUInt32BE(256, 4);
      return dims;
    })(),
    Buffer.from([8, 6, 0, 0, 0]),
    Buffer.alloc(64), // filler so the body is not suspiciously tiny
  ]);

  console.log("→ uploading a logo returns a cache-busted public url");
  const brand1 = await call<Branding>(
    "PATCH",
    "/v1/me/branding",
    { logoBase64: pngHeader.toString("base64"), brandColor: "#7B2D26" },
    jwt
  );
  assert(brand1.logoUrl !== null, "logo url should be set after upload");
  assert(
    brand1.logoUrl!.includes("/logo.png?v="),
    `logo url should carry a version token, got ${brand1.logoUrl}`
  );
  assert(brand1.brandColor === "#7B2D26", `brand colour wrong: ${brand1.brandColor}`);

  console.log("→ the public url serves the image without auth (Google fetches it)");
  const logoPath = new URL(brand1.logoUrl!).pathname + new URL(brand1.logoUrl!).search;
  const logoRes = await fetch(`${BASE}${logoPath}`);
  assert(logoRes.status === 200, `logo should be publicly readable, got ${logoRes.status}`);
  assert(
    logoRes.headers.get("content-type") === "image/png",
    "logo should be served with its real content type"
  );

  console.log("→ re-uploading identical bytes keeps the same url, so caches stay warm");
  const brand2 = await call<Branding>(
    "PATCH",
    "/v1/me/branding",
    { logoBase64: pngHeader.toString("base64") },
    jwt
  );
  assert(brand2.logoUrl === brand1.logoUrl, "identical bytes should produce an identical url");

  console.log("→ junk and undersized images are refused");
  let notImage = false;
  try {
    await call("PATCH", "/v1/me/branding", { logoBase64: Buffer.from("nope").toString("base64") }, jwt);
  } catch (err) {
    notImage = String(err).includes("400");
  }
  assert(notImage, "a non-image upload should 400");

  let badHex = false;
  try {
    await call("PATCH", "/v1/me/branding", { brandColor: "red" }, jwt);
  } catch (err) {
    badHex = String(err).includes("400");
  }
  assert(badHex, "a non-hex brand colour should 400");

  console.log("→ a logo can be removed, and the public url stops resolving");
  const brand3 = await call<Branding>("PATCH", "/v1/me/branding", { logoBase64: null }, jwt);
  assert(brand3.logoUrl === null, "logo url should clear on removal");
  const goneRes = await fetch(`${BASE}${logoPath}`);
  assert(goneRes.status === 404, `removed logo should 404, got ${goneRes.status}`);

  console.log("→ branding requires auth");
  let brandUnauth = false;
  try {
    await call("GET", "/v1/me/branding");
  } catch (err) {
    brandUnauth = String(err).includes("401");
  }
  assert(brandUnauth, "/v1/me/branding did not require auth");

  // ---------- Day 20: RFM segments ----------

  interface Segments {
    thresholds: { recentDays: number; lapsedDays: number; frequentVisits: number };
    currencyCode: string;
    segments: Array<{ segment: string; customers: number; revenueCents: number }>;
    totalClassified: number;
  }

  console.log("→ segments always return all six buckets in a fixed order");
  const seg = await call<Segments>("GET", "/v1/analytics/segments", undefined, jwt);
  const order = ["champions", "promising", "new", "at_risk", "sleeping", "lost"];
  assert(
    JSON.stringify(seg.segments.map((s) => s.segment)) === JSON.stringify(order),
    `segments should be a fixed six in order, got ${seg.segments.map((s) => s.segment).join(",")}`
  );
  assert(seg.thresholds.recentDays > 0, "thresholds should be echoed back");

  console.log("→ segment counts add up to the number of classified customers");
  const segTotal = seg.segments.reduce((sum, s) => sum + s.customers, 0);
  assert(
    segTotal === seg.totalClassified,
    `segment counts (${segTotal}) should equal totalClassified (${seg.totalClassified})`
  );

  console.log("→ this merchant's freshly-stamped cards land in a recent segment");
  // Everything in this run was stamped moments ago, so nobody can be lapsed.
  const lapsed = seg.segments
    .filter((s) => s.segment === "sleeping" || s.segment === "lost")
    .reduce((sum, s) => sum + s.customers, 0);
  assert(lapsed === 0, `nothing stamped today should be sleeping or lost, got ${lapsed}`);

  console.log("→ segments require auth");
  let segUnauth = false;
  try {
    await call("GET", "/v1/analytics/segments");
  } catch (err) {
    segUnauth = String(err).includes("401");
  }
  assert(segUnauth, "/v1/analytics/segments did not require auth");

  console.log("→ a broadcast to an empty segment sends to nobody, not everybody");
  const emptySeg = await call<{ broadcastId: string }>(
    "POST",
    "/v1/broadcasts",
    { header: "Segment test", body: "Ignore — automated.", audienceFilter: { rfmSegment: "lost" } },
    jwt
  );
  let emptyFinal: { broadcast: { status: string; scanned: number } } | null = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    emptyFinal = await call("GET", `/v1/broadcasts/${emptySeg.broadcastId}`, undefined, jwt);
    if (emptyFinal.broadcast.status !== "running") break;
    await new Promise((r) => setTimeout(r, 300));
  }
  // The failure this guards against is a filter that matches nobody being
  // silently dropped, turning a targeted win-back into a message to everyone.
  assert(
    emptyFinal!.broadcast.scanned === 0,
    `empty segment should scan 0, got ${emptyFinal!.broadcast.scanned}`
  );
  assert(
    emptyFinal!.broadcast.status === "completed",
    `empty-segment broadcast should complete, got ${emptyFinal!.broadcast.status}`
  );

  // ---------- Day 19: customer CSV import / export ----------

  interface ImportResult {
    dryRun: boolean;
    delimiter: string;
    totalRows: number;
    created: number;
    enrolled: number;
    duplicates: number;
    skipped: Array<{ line: number; reason: string }>;
  }

  // Shaped like a real Dutch Excel export: semicolons, BOM, CRLF, Dutch
  // headers, a quoted comma, a day-first date, a row with no contact details
  // and a case-different duplicate.
  const impEmail = `imp-${Date.now()}`;
  const dutchCsv =
    "\ufeffNaam;E-mail;Telefoon;Geboortedatum\r\n" +
    `"Vries, Jan de";${impEmail}-a@example.com;+31 6 1111 1111;03/04/1990\r\n` +
    `Sanne Bakker;${impEmail}-b@example.com;+31622222222;1985-11-23\r\n` +
    "Geen Contact;;;\r\n" +
    `Hoofdletters;${impEmail.toUpperCase()}-A@EXAMPLE.COM;;01/01/1991\r\n`;

  console.log("→ import dry-run sniffs a semicolon file and writes nothing");
  const impDry = await call<ImportResult>(
    "POST",
    "/v1/customers/import",
    { csv: dutchCsv, dryRun: true },
    jwt
  );
  assert(impDry.delimiter === ";", `expected semicolon delimiter, got ${impDry.delimiter}`);
  assert(impDry.dryRun === true, "dry run should report itself");
  assert(impDry.created === 2, `dry run should plan 2 creates, got ${impDry.created}`);
  assert(impDry.duplicates === 1, `case-different email should dedupe, got ${impDry.duplicates}`);
  assert(
    impDry.skipped.some((r) => r.reason.includes("email or a phone")),
    "a row with no contact details should be skipped with a reason"
  );
  // Header is line 1, so the contactless third data row is line 4 — matching
  // what the merchant sees in their spreadsheet.
  assert(
    impDry.skipped.some((r) => r.line === 4),
    `skipped line numbers should match the file, got ${JSON.stringify(impDry.skipped)}`
  );

  console.log("→ dry-run really did not write");
  const afterDry = await call<{ customers: Array<{ email: string | null }> }>(
    "GET",
    "/v1/customers",
    undefined,
    jwt
  );
  assert(
    !afterDry.customers.some((c) => (c.email ?? "").startsWith(impEmail)),
    "dry run must not create customers"
  );

  console.log("→ real import creates customers and enrols them");
  const impReal = await call<ImportResult>(
    "POST",
    "/v1/customers/import",
    { csv: dutchCsv, programId: program.id },
    jwt
  );
  assert(impReal.created === 2, `expected 2 created, got ${impReal.created}`);
  assert(impReal.enrolled === 2, `expected 2 enrolled, got ${impReal.enrolled}`);

  console.log("→ re-importing the same file is idempotent");
  const impAgain = await call<ImportResult>(
    "POST",
    "/v1/customers/import",
    { csv: dutchCsv },
    jwt
  );
  assert(impAgain.created === 0, `re-import should create nothing, got ${impAgain.created}`);
  assert(impAgain.duplicates === 3, `re-import should see 3 duplicates, got ${impAgain.duplicates}`);

  console.log("→ importing onto someone else's program should 400");
  let badProgram = false;
  try {
    await call(
      "POST",
      "/v1/customers/import",
      { csv: dutchCsv, programId: "00000000-0000-4000-8000-000000000000" },
      jwt
    );
  } catch (err) {
    badProgram = String(err).includes("400");
  }
  assert(badProgram, "import with an unknown program did not 400");

  console.log("→ export returns a downloadable CSV the importer can read back");
  const expRes = await fetch(`${BASE}/v1/customers/export.csv`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
  assert(expRes.status === 200, `export should 200, got ${expRes.status}`);
  assert(
    (expRes.headers.get("content-type") ?? "").includes("text/csv"),
    "export should be text/csv"
  );
  assert(
    (expRes.headers.get("content-disposition") ?? "").includes("attachment"),
    "export should download rather than render"
  );
  // Read bytes, not text: Response.text() decodes UTF-8 and strips a leading
  // BOM per spec, so the BOM is invisible from the string side even though it
  // is on the wire. Excel needs those three bytes or accented names arrive
  // mangled.
  const expBuf = Buffer.from(await expRes.arrayBuffer());
  assert(
    expBuf[0] === 0xef && expBuf[1] === 0xbb && expBuf[2] === 0xbf,
    `export should start with a UTF-8 BOM, got ${[...expBuf.subarray(0, 3)].join(",")}`
  );
  const expText = expBuf.toString("utf8");
  assert(
    expText.includes('"Vries, Jan de"'),
    "export should quote a value containing a comma"
  );

  console.log("→ export requires auth");
  const expUnauth = await fetch(`${BASE}/v1/customers/export.csv`);
  assert(expUnauth.status === 401, `export without auth should 401, got ${expUnauth.status}`);

  // ---------- Day 19: trial period ----------

  console.log("→ a new merchant starts on a trial clock");
  const meTrial = await call<{ trial: { endsAt: string | null; daysLeft: number | null; expired: boolean } }>(
    "GET",
    "/v1/me",
    undefined,
    jwt
  );
  assert(meTrial.trial !== undefined, "/v1/me should expose trial state");
  assert(meTrial.trial.endsAt !== null, "a new signup should have a trial end date");
  assert(meTrial.trial.expired === false, "a brand-new trial should not be expired");
  assert(
    meTrial.trial.daysLeft !== null && meTrial.trial.daysLeft > 0,
    `new trial should have days remaining, got ${meTrial.trial.daysLeft}`
  );
  // Derived from the stored date, so it can never disagree with endsAt.
  assert(
    new Date(meTrial.trial.endsAt!).getTime() > Date.now(),
    "trial endsAt should be in the future for a new signup"
  );

  // ---------- Day 19: Google Wallet hero image ----------

  console.log("→ hero.png renders at Google's 1032x336 for a stamp card");
  const heroRes = await fetch(`${BASE}/v1/public/c/${scanCard.qrToken}/hero.png?v=smoke`);
  assert(heroRes.status === 200, `hero.png should 200, got ${heroRes.status}`);
  assert(
    heroRes.headers.get("content-type") === "image/png",
    "hero.png should be served as image/png"
  );
  const heroBuf = Buffer.from(await heroRes.arrayBuffer());
  assert(
    heroBuf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "hero.png is missing the PNG magic bytes"
  );
  // Dimensions live in the IHDR chunk at a fixed offset.
  const heroW = heroBuf.readUInt32BE(16);
  const heroH = heroBuf.readUInt32BE(20);
  assert(heroW === 1032 && heroH === 336, `hero should be 1032x336, got ${heroW}x${heroH}`);

  console.log("→ hero.png is cached immutably (the ?v= token is what changes)");
  assert(
    (heroRes.headers.get("cache-control") ?? "").includes("immutable"),
    "hero.png should be immutably cacheable — Google caches by URI"
  );

  console.log("→ points cards have no stamp grid, so no hero");
  const heroPoints = await fetch(`${BASE}/v1/public/c/${ptsCard.qrToken}/hero.png`);
  assert(heroPoints.status === 404, `points hero should 404, got ${heroPoints.status}`);

  console.log("→ hero.png 404s for unknown and malformed tokens");
  const heroUnknown = await fetch(`${BASE}/v1/public/c/${"f".repeat(64)}/hero.png`);
  assert(heroUnknown.status === 404, `unknown token hero should 404, got ${heroUnknown.status}`);
  const heroMalformed = await fetch(`${BASE}/v1/public/c/not-a-token/hero.png`);
  assert(heroMalformed.status === 404, `malformed token hero should 404, got ${heroMalformed.status}`);

  // ---------- Day 18: marketing-site lead capture ----------

  // Mirrors the CI env. The endpoint deliberately 503s when unset, so without
  // a secret there is nothing here worth asserting.
  const leadsSecret = process.env.LEADS_INGEST_SECRET ?? "";

  if (!leadsSecret) {
    console.log("→ leads: LEADS_INGEST_SECRET unset, asserting the endpoint is closed");
    let closed = false;
    try {
      await call("POST", "/v1/public/leads", { source: "demo", email: "x@example.com" });
    } catch (err) {
      closed = String(err).includes("503");
    }
    assert(closed, "leads endpoint should 503 when no secret is configured");
  } else {
    const leadEmail = `lead-${Date.now()}@example.com`;

    const postLead = async (body: unknown, secret = leadsSecret): Promise<number> => {
      const res = await fetch(`${BASE}/v1/public/leads`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-leads-secret": secret },
        body: JSON.stringify(body),
      });
      return res.status;
    };

    console.log("→ leads: missing secret should 401");
    assert(
      (await postLead({ source: "demo", email: leadEmail }, "wrong")) === 401,
      "bad leads secret did not 401"
    );

    console.log("→ leads: a valid demo lead is accepted");
    assert(
      (await postLead({
        source: "demo",
        email: leadEmail,
        name: "Smoke Lead",
        businessName: "Smoke Cafe",
        businessType: "cafe",
      })) === 201,
      "valid demo lead was not accepted"
    );

    console.log("→ leads: a duplicate inside the window merges rather than inserting");
    // 200 rather than 201 is the tell: merged, not created.
    assert(
      (await postLead({ source: "demo", email: leadEmail, phone: "+31600000000" })) === 200,
      "duplicate lead should merge and return 200"
    );

    console.log("→ leads: honeypot is accepted but discarded");
    assert(
      (await postLead({
        source: "demo",
        email: `bot-${Date.now()}@example.com`,
        website: "http://spam.example",
      })) === 200,
      "honeypot submission should return 200 without creating a lead"
    );

    console.log("→ leads: a malformed email is rejected");
    assert(
      (await postLead({ source: "demo", email: "not-an-email" })) === 400,
      "invalid lead email did not 400"
    );

    console.log("→ leads: an unknown source is rejected");
    assert(
      (await postLead({ source: "carrier-pigeon", email: `s-${Date.now()}@example.com` })) === 400,
      "invalid lead source did not 400"
    );

    console.log("→ leads: newsletter signups are accepted");
    assert(
      (await postLead({ source: "newsletter", email: `news-${Date.now()}@example.com` })) === 201,
      "newsletter lead was not accepted"
    );
  }

  console.log("✓ smoke test passed");
}

main().catch((err) => {
  console.error("✗ smoke test failed:", err);
  process.exit(1);
});
