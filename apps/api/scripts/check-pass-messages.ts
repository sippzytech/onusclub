/**
 * Pure assertions on wallet notification copy. No env, no database, no wallet.
 *
 * These exist because the thing they guard cannot be tested any other way:
 * seeing a lock-screen notification needs a real phone, a real pass and a
 * real push, and by then the words are already in front of a customer. The
 * copy is pure, so the rules about it can be checked for free on every PR.
 *
 * Run: pnpm --filter @onusclub/api run check:messages
 */
import {
  appleChangeMessage,
  googleProgressMessage,
  redeemMessage,
  signupMessage,
  type ProgressCopyInput,
} from "@onusclub/shared";

let failures = 0;
function check(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const base: ProgressCopyInput = {
  businessName: "Café De Klep",
  current: 3,
  total: 6,
  unitLabel: "stamps",
  rewardText: "a free coffee",
};

console.log("\nApple: the %@ placeholder");
// 🚨 The reason this file exists. Apple substitutes %@ with the field's new
// value and IGNORES a changeMessage that lacks it, falling back to iOS's own
// flat "pass updated" wording — which is exactly the complaint that prompted
// this work. Every reachable branch must carry the token.
for (let current = 0; current <= 7; current += 1) {
  for (const unitLabel of ["stamps", "points"] as const) {
    const msg = appleChangeMessage({ ...base, current, unitLabel });
    check(
      `${unitLabel} ${current}/6 contains %@`,
      msg.includes("%@"),
      JSON.stringify(msg)
    );
  }
}

console.log("\nGoogle: never leaks Apple's placeholder");
// The mirror of the rule above. Google has no substitution, so a stray %@
// would be shown to the customer verbatim.
for (let current = 0; current <= 7; current += 1) {
  const { header, body } = googleProgressMessage({ ...base, current });
  check(
    `${current}/6 is placeholder-free`,
    !header.includes("%@") && !body.includes("%@"),
    `${header} / ${body}`
  );
}

console.log("\nMilestones say the right thing");
const done = googleProgressMessage({ ...base, current: 6 });
check(
  "a completed card names the reward",
  done.body.includes("a free coffee") && done.header.toLowerCase().includes("unlocked"),
  `${done.header} / ${done.body}`
);

const oneLeft = googleProgressMessage({ ...base, current: 5 });
check(
  "one to go says so explicitly",
  oneLeft.header.toLowerCase().includes("one"),
  oneLeft.header
);

const first = googleProgressMessage({ ...base, current: 1 });
check(
  "the first stamp explains the card",
  first.body.includes("a free coffee"),
  first.body
);

console.log("\nCopy hygiene");
// Variety was the explicit ask: a regular should not read one identical
// sentence every visit.
const midHeaders = new Set(
  [2, 3, 4].map((current) => googleProgressMessage({ ...base, current, total: 12 }).header)
);
check("mid-progress wording varies", midHeaders.size > 1, [...midHeaders].join(" | "));

// ...but it must be STABLE for a given balance. A pass can be rebuilt several
// times for one stamp (an APNs retry, a second device), and wording that
// changed between renders would read as two separate events.
const twice = [0, 1].map(() => googleProgressMessage({ ...base, current: 4 }).header);
check("the same balance always renders the same words", twice[0] === twice[1]);

for (let current = 0; current <= 12; current += 1) {
  const { header, body } = googleProgressMessage({ ...base, current, total: 12 });
  check(
    `${current}/12 names the café and is non-empty`,
    header.includes("Café De Klep") && body.trim().length > 0,
    `${header} / ${body}`
  );
}

console.log("\nSignup and redeem");
const hello = signupMessage({
  businessName: "Café De Klep",
  total: 6,
  unitLabel: "stamps",
  rewardText: "a free coffee",
});
check("signup states the goal", hello.body.includes("6") && hello.body.includes("a free coffee"));
const bye = redeemMessage({
  businessName: "Café De Klep",
  unitLabel: "stamps",
  rewardText: "a free coffee",
});
check("redeem confirms what they got", bye.header.includes("a free coffee"));
check(
  "neither leaks a placeholder",
  ![hello.header, hello.body, bye.header, bye.body].some((s) => s.includes("%@"))
);

if (failures > 0) {
  console.error(`\n❌ ${failures} pass-message check(s) failed\n`);
  process.exit(1);
}
console.log("\n✅ pass message checks passed\n");
