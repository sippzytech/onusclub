// Assertions on the customer block list, without a database.
//
// WHY THIS EXISTS
//
// Hashing and masking are pure, and both have failure modes that are silent
// and nasty. A normalisation bug means a café blocks someone who walks back in
// under the same address spelled differently — and nobody finds out, because
// the enrolment succeeds. A masking bug leaks a contact detail into a list
// that exists precisely so we are not holding contact details.
//
// Same shape as check-wallet-payload.ts and check-drafts.ts: the parts that
// can be checked for free, checked on every PR.
//
// Imports only block-hash.ts, which touches no config and no database, so this
// runs in the typecheck job and needs no environment at all.
//
// Run with: pnpm --filter @onusclub/api run check:blocks

import {
  hashWithPepper,
  maskForDisplay,
  normaliseEmail,
  normalisePhone,
} from "../src/customers/block-hash.js";

/** The checks below are about normalisation and masking, not the pepper. */
const hashIdentifier = (v: string): string => hashWithPepper(v, "test-pepper");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

function main(): void {
  // -------------------------------------------------------------------------
  // Normalisation — the silent-failure half
  // -------------------------------------------------------------------------
  console.log("→ the same email in different cases and spacing hashes identically");
  // The bug this catches: a café blocks "Jan@Gmail.com", the person enrols as
  // "jan@gmail.com", and the block quietly does nothing.
  const variants = [
    "jan@gmail.com",
    "Jan@Gmail.com",
    "  jan@gmail.com  ",
    "JAN@GMAIL.COM",
  ].map((e) => hashIdentifier(normaliseEmail(e)));
  assert(
    new Set(variants).size === 1,
    `case and whitespace variants produced ${new Set(variants).size} different hashes`
  );

  console.log("→ phone formats normalise to the same hash");
  const phones = ["+31612345678", "+31 6 1234 5678", "0031612345678".slice(2)].map((p) =>
    hashIdentifier(normalisePhone(p))
  );
  assert(new Set(phones).size === 1, "phone formatting changed the hash");

  console.log("→ different people do NOT collide");
  assert(
    hashIdentifier(normaliseEmail("jan@gmail.com")) !==
      hashIdentifier(normaliseEmail("jana@gmail.com")),
    "two different addresses produced the same hash"
  );

  console.log("→ Gmail dots and +tags are deliberately NOT stripped");
  // Treating jan.devries@ and jandevries@ as one person would make a block
  // broader than the café asked for, and it cannot be undone from a hash —
  // a false positive refuses a stranger with no way to see why.
  assert(
    hashIdentifier(normaliseEmail("jan.devries@gmail.com")) !==
      hashIdentifier(normaliseEmail("jandevries@gmail.com")),
    "dot-stripping has crept in; a block is now broader than intended"
  );
  assert(
    hashIdentifier(normaliseEmail("jan+cafe@gmail.com")) !==
      hashIdentifier(normaliseEmail("jan@gmail.com")),
    "+tag stripping has crept in"
  );

  console.log("→ the hash is a stable 64-char hex, pepper or no pepper");
  for (const pepper of ["", "test-pepper"]) {
    const h = hashWithPepper("anything", pepper);
    assert(/^[0-9a-f]{64}$/.test(h), `expected 64 hex chars, got ${h}`);
    assert(h === hashWithPepper("anything", pepper), "hashing is not deterministic");
  }

  console.log("→ ⚠️ changing the pepper changes every hash (blocks stop matching)");
  // Not a bug — the documented consequence. Asserted so the behaviour is
  // visible to whoever reads this next, rather than discovered in production
  // when a blocked customer walks back in.
  assert(
    hashWithPepper("jan@gmail.com", "pepper-a") !==
      hashWithPepper("jan@gmail.com", "pepper-b"),
    "the pepper is not actually keying the hash"
  );

  // -------------------------------------------------------------------------
  // Masking — the leak half
  // -------------------------------------------------------------------------
  console.log("→ a masked email is recognisable but not usable");
  const masked = maskForDisplay("jan.devries@gmail.com", null);
  assert(masked.includes("•"), `expected masking, got ${masked}`);
  assert(
    !masked.includes("devries"),
    `the local part leaked into the display hint: ${masked}`
  );
  assert(masked.endsWith("@gmail.com"), `the domain should be kept, got ${masked}`);

  console.log("→ a two-character local part still does not round-trip");
  // The edge case: keeping two characters of a two-character name is the
  // whole name.
  const tiny = maskForDisplay("jo@gmail.com", null);
  assert(!tiny.startsWith("jo•"), `the entire local part survived masking: ${tiny}`);

  console.log("→ a masked phone keeps only the last four digits");
  const mp = maskForDisplay(null, "+31 6 1234 5678");
  assert(mp === "•••• 5678", `expected "•••• 5678", got ${mp}`);
  assert(!mp.includes("31"), "the country code leaked");

  console.log("→ no identifiers at all still returns something renderable");
  assert(maskForDisplay(null, null) === "••••", "empty input should not crash the list");

  console.log("→ a short phone does not expose itself");
  assert(maskForDisplay(null, "12") === "••••", "a short number leaked in full");

  console.log("\n✅ block list checks passed");
}

try {
  main();
} catch (err) {
  console.error("\n❌ block list check failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
