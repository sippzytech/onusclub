// Assertions on Sign in with Google, without calling Google.
//
// WHY THIS EXISTS, AND WHY IT IS NOT IN smoke.ts
//
// A real ID token can only be produced by a browser signing in to a Google
// account, so the happy path cannot be exercised in CI at all. What CAN be
// checked for free is the shape of the contract: which requests are even
// allowed through, and that the one rule the whole feature rests on — a Google
// token satisfies the identity requirement and nothing else does — holds.
//
// Same shape and reasoning as check-wallet-payload.ts and check-drafts.ts.
//
// Run with: pnpm --filter @onusclub/api run check:google

import { GoogleAuthInput, GoogleAuthResult, PublicEnrolInput } from "@onusclub/shared";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

const TOKEN = "eyJhbGciOiJSUzI1NiJ9.e30.sig"; // shape only — never verified here

function main(): void {
  // -------------------------------------------------------------------------
  // The owner endpoint's input
  // -------------------------------------------------------------------------
  console.log("→ a bare idToken is a valid request (the login case)");
  assert(GoogleAuthInput.safeParse({ idToken: TOKEN }).success, "login shape rejected");

  console.log("→ idToken + businessName is valid (the signup case)");
  assert(
    GoogleAuthInput.safeParse({ idToken: TOKEN, businessName: "Café De Klep" }).success,
    "signup shape rejected"
  );

  console.log("→ an empty or missing idToken is rejected");
  assert(!GoogleAuthInput.safeParse({}).success, "a request with no token was accepted");
  assert(
    !GoogleAuthInput.safeParse({ idToken: "" }).success,
    "an empty token string was accepted"
  );

  console.log("→ an absurdly long token is rejected before it reaches Google");
  // A real ID token is ~1KB. The cap stops an unbounded string being shipped
  // to Google's verifier on an unauthenticated endpoint.
  assert(
    !GoogleAuthInput.safeParse({ idToken: "x".repeat(4001) }).success,
    "an unbounded token was accepted"
  );

  console.log("→ an empty businessName is rejected, not silently accepted");
  // Would otherwise reach generateUniqueSlug and produce a café with a blank
  // name and a nonsense public slug.
  assert(
    !GoogleAuthInput.safeParse({ idToken: TOKEN, businessName: "" }).success,
    "a blank business name was accepted"
  );

  // -------------------------------------------------------------------------
  // The response union
  // -------------------------------------------------------------------------
  console.log("→ the result union discriminates on status");
  const authed = GoogleAuthResult.safeParse({
    status: "authenticated",
    jwt: "a.b.c",
    user: {
      id: "u1",
      email: "owner@example.com",
      name: "Owner",
      role: "owner",
      merchantId: "m1",
    },
    merchant: {
      id: "m1",
      businessName: "Café De Klep",
      ownerEmail: "owner@example.com",
      country: "NL",
      status: "trial",
    },
    publicSlug: "cafe-de-klep",
  });
  assert(authed.success, "a valid authenticated result was rejected");

  const needsName = GoogleAuthResult.safeParse({
    status: "needs_business_name",
    email: "owner@example.com",
    name: null,
  });
  assert(needsName.success, "a valid needs_business_name result was rejected");
  assert(
    needsName.success && needsName.data.status === "needs_business_name",
    "the union did not narrow on status"
  );

  console.log("→ needs_business_name carries no jwt (nobody is signed in yet)");
  // The guard against the signup step accidentally handing out a session
  // before a merchant row exists.
  assert(
    needsName.success && !("jwt" in needsName.data),
    "the needs_business_name branch has a jwt field"
  );

  console.log("→ an unknown status is rejected");
  assert(
    !GoogleAuthResult.safeParse({ status: "maybe", email: "a@b.com", name: null }).success,
    "an unknown status was accepted"
  );

  console.log("→ a null name is allowed (a bare Google account has none)");
  assert(needsName.success, "a null display name was rejected");

  // -------------------------------------------------------------------------
  // Customer enrolment — the rule the whole surface rests on
  // -------------------------------------------------------------------------
  console.log("→ a Google token alone is enough to enrol (no name, no contact)");
  // The point of the feature: the verified token carries both the name and the
  // email, so it satisfies the identity requirement on its own.
  assert(
    PublicEnrolInput.safeParse({ programId: "p1", googleIdToken: TOKEN }).success,
    "a Google-only enrolment was rejected"
  );

  console.log("→ the ORIGINAL rule is unchanged for everyone not using Google");
  assert(
    PublicEnrolInput.safeParse({ programId: "p1", name: "Jan", email: "jan@example.com" })
      .success,
    "a manual enrolment with name + email was rejected"
  );
  assert(
    PublicEnrolInput.safeParse({ programId: "p1", name: "Jan", phone: "+31612345678" })
      .success,
    "a manual enrolment with name + phone was rejected"
  );
  assert(
    !PublicEnrolInput.safeParse({ programId: "p1", name: "Jan" }).success,
    "a manual enrolment with no contact details was accepted"
  );
  assert(
    !PublicEnrolInput.safeParse({ programId: "p1", email: "jan@example.com" }).success,
    "a manual enrolment with no name was accepted"
  );
  assert(
    !PublicEnrolInput.safeParse({ programId: "p1" }).success,
    "an enrolment with neither a token nor any details was accepted"
  );

  console.log("→ a whitespace-only name does not pass as a name");
  assert(
    !PublicEnrolInput.safeParse({ programId: "p1", name: "   ", email: "a@b.com" })
      .success,
    "a blank name was accepted"
  );

  console.log("→ a whitespace-only token does not pass as a token");
  // Otherwise " " would satisfy the refine and then fail verification — a 401
  // where a 400 is the honest answer.
  assert(
    !PublicEnrolInput.safeParse({ programId: "p1", googleIdToken: "   " }).success,
    "a blank Google token satisfied the identity requirement"
  );

  console.log("→ programId is still required on the Google path");
  // Google says who; it cannot say which card.
  assert(
    !PublicEnrolInput.safeParse({ googleIdToken: TOKEN }).success,
    "an enrolment with no programId was accepted"
  );

  console.log("→ birthday is still accepted alongside a Google token");
  // Google returns no birthday, so the form field stays the only source and
  // must keep working on this path or the birthday sweep loses its audience.
  assert(
    PublicEnrolInput.safeParse({
      programId: "p1",
      googleIdToken: TOKEN,
      birthday: "1990-04-03",
    }).success,
    "a birthday was rejected on the Google path"
  );
  assert(
    !PublicEnrolInput.safeParse({
      programId: "p1",
      googleIdToken: TOKEN,
      birthday: "03/04/1990",
    }).success,
    "a non-ISO birthday was accepted"
  );

  console.log("\n✅ google auth checks passed");
}

try {
  main();
} catch (err) {
  console.error("\n❌ google auth check failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
