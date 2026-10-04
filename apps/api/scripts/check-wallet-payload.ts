// Assertions on the Google Wallet class payload, without calling Google.
//
// WHY THIS EXISTS, AND WHY IT IS NOT IN smoke.ts
//
// Local dev has Google Wallet deliberately disabled at the compose layer —
// after seven permanent LoyaltyClasses were created on the *production* issuer
// from a laptop, and the Wallet API has no delete. So the wallet integration
// cannot be exercised end-to-end anywhere except production, and the only
// honest local check is on the payload we would have sent.
//
// `buildLoyaltyClass` and `classBrandingDiffers` are pure, so that check is
// exact. Both guard a failure mode that is completely silent in production:
// the class is accepted, nothing errors, and no notification ever fires.
//
// Needs the api's env (config.ts validates at import time, and classId embeds
// the issuer), so it runs in CI's smoke job where those vars are already set.
//
// Run with: pnpm --filter @onusclub/api run check:wallet

import { buildLoyaltyClass } from "../src/wallet/state.js";
import { classBrandingDiffers } from "../src/wallet/loyalty.js";
import type { MerchantBranding, ProgramForWallet } from "../src/wallet/state.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

const PROGRAM: ProgramForWallet = {
  programType: "stamp",
  id: "prog-1",
  name: "Coffee card",
  rewardText: "Free coffee",
  stampsRequired: 10,
  design: null,
};

function merchant(locations?: MerchantBranding["locations"]): MerchantBranding {
  return {
    id: "merchant-1",
    businessName: "Test Café",
    brandColor: "#14271C",
    logoUrl: "https://example.com/logo.png",
    ...(locations !== undefined ? { locations } : {}),
  };
}

const AMSTERDAM = { name: "Centre", latitude: 52.3676, longitude: 4.9041 };
const ROTTERDAM = { name: "Second", latitude: 51.9244, longitude: 4.4777 };

function main(): void {
  console.log("→ merchantLocations is sent, and the deprecated `locations` is not");
  const withLocs = buildLoyaltyClass(merchant([AMSTERDAM, ROTTERDAM]), PROGRAM);
  const sent = withLocs.merchantLocations as Array<Record<string, unknown>> | undefined;
  assert(Array.isArray(sent), "merchantLocations missing from the class payload");
  assert(sent.length === 2, `expected 2 merchantLocations, got ${sent.length}`);
  assert(
    sent[0].latitude === 52.3676 && sent[0].longitude === 4.9041,
    "coordinates did not survive into the payload"
  );
  // Google takes coordinates only — no name, no address.
  assert(
    Object.keys(sent[0]).sort().join(",") === "latitude,longitude",
    `merchantLocations entries should carry only coordinates, got ${Object.keys(sent[0])}`
  );
  // ⚠️ The whole point. `LoyaltyClass.locations` is marked deprecated by
  // Google with "not supported to trigger geo notifications" — sending it
  // looks correct, stores fine, and silently never fires.
  assert(
    withLocs.locations === undefined,
    "the DEPRECATED `locations` field is being sent — it does not trigger geo notifications"
  );

  console.log("→ a merchant with no locations sends an empty list, not the field removed");
  const emptyLocs = buildLoyaltyClass(merchant([]), PROGRAM);
  assert(
    Array.isArray(emptyLocs.merchantLocations) &&
      (emptyLocs.merchantLocations as unknown[]).length === 0,
    "an empty list must be sent explicitly, so removing the last location clears the geofence"
  );

  console.log("→ a caller that knows nothing about locations leaves them alone");
  // resync-wallet-class-logos.ts builds a MerchantBranding without locations.
  // It must not wipe the geofence as a side effect of fixing a logo.
  const noOpinion = buildLoyaltyClass(merchant(undefined), PROGRAM);
  assert(
    !("merchantLocations" in noOpinion),
    "omitting locations must omit the field entirely, not send an empty list"
  );

  // ⚠️ THE TRAP. ensureLoyaltyClass only PATCHes when a field compared in
  // classBrandingDiffers differs. Without locations in that comparator, every
  // café whose class already existed keeps an empty geofence forever, with
  // nothing in the logs — exactly the bug the comparator was written to fix
  // for logos.
  console.log("→ changing only the locations counts as a difference");
  const remoteNone = buildLoyaltyClass(merchant([]), PROGRAM);
  const desiredOne = buildLoyaltyClass(merchant([AMSTERDAM]), PROGRAM);
  assert(
    classBrandingDiffers(remoteNone, desiredOne),
    "ADDING A LOCATION IS NOT DETECTED — existing cafés would never get a geofence"
  );
  assert(
    classBrandingDiffers(desiredOne, remoteNone),
    "REMOVING A LOCATION IS NOT DETECTED — a deleted shop would keep its geofence"
  );
  assert(
    classBrandingDiffers(desiredOne, buildLoyaltyClass(merchant([ROTTERDAM]), PROGRAM)),
    "moving a location is not detected"
  );

  console.log("→ an unchanged set does not PATCH on every stamp");
  assert(
    !classBrandingDiffers(desiredOne, buildLoyaltyClass(merchant([AMSTERDAM]), PROGRAM)),
    "an identical location set reported a difference — this would PATCH on every stamp"
  );

  console.log("→ Google echoing floats back does not look like a change");
  // ensureLoyaltyClass runs on every stamp and compares what Google returned
  // against what we want. Google's float round-trip is not bit-exact, so an
  // exact numeric compare would report a difference forever.
  const echoed = {
    ...desiredOne,
    merchantLocations: [{ latitude: 52.36760000000001, longitude: 4.904099999999 }],
  };
  assert(
    !classBrandingDiffers(echoed, desiredOne),
    "a float round-trip looked like a change — this would PATCH Google on every single stamp"
  );

  console.log("→ reordering is not a change");
  const twoWays = buildLoyaltyClass(merchant([AMSTERDAM, ROTTERDAM]), PROGRAM);
  const reordered = {
    ...twoWays,
    merchantLocations: [
      { latitude: ROTTERDAM.latitude, longitude: ROTTERDAM.longitude },
      { latitude: AMSTERDAM.latitude, longitude: AMSTERDAM.longitude },
    ],
  };
  assert(
    !classBrandingDiffers(reordered, twoWays),
    "a reordered location list looked like a change"
  );

  console.log("→ a caller with no opinion never triggers a locations-only PATCH");
  assert(
    !classBrandingDiffers(twoWays, buildLoyaltyClass(merchant(undefined), PROGRAM)),
    "the logo re-sync script would clear every café's geofence"
  );

  console.log("→ the branding fields still work (no regression)");
  const other = buildLoyaltyClass(
    { ...merchant([AMSTERDAM]), brandColor: "#FF0000" },
    PROGRAM
  );
  assert(classBrandingDiffers(desiredOne, other), "a colour change is no longer detected");

  console.log("\n✅ wallet payload checks passed");
}

try {
  main();
} catch (err) {
  console.error("\n❌ wallet payload check failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
