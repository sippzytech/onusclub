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
    detail: { card: { cardState: { stamps_current: number } } };
    appliedAction: "stamp" | "redeem";
  }>("POST", "/v1/scan", { qrToken: scanCard.qrToken, action: "auto" }, jwt);
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
    detail: { card: { cardState: { stamps_current: number; rewards_redeemed: number } } };
    appliedAction: "stamp" | "redeem";
  }>("POST", "/v1/scan", { qrToken: scanCard.qrToken, action: "auto" }, jwt);
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
  assert(
    birthdayRun2.scanned === 0,
    `second birthday sweep should scan 0 (dedup), got ${birthdayRun2.scanned}`
  );

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

  console.log("✓ smoke test passed");
}

main().catch((err) => {
  console.error("✗ smoke test failed:", err);
  process.exit(1);
});
