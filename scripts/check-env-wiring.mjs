#!/usr/bin/env node
/**
 * Fail if a variable declared in the api's zod env schema is not passed
 * through docker-compose.prod.yml.
 *
 * This exists because the mistake has now been made twice, and both times the
 * symptom pointed somewhere else. The prod compose file lists every variable
 * explicitly, so adding one to config.ts and .env.example is not enough — the
 * container simply never receives it. The feature then behaves exactly as
 * though it were deliberately switched off, which is the hardest kind of
 * failure to attribute: nothing errors, nothing logs, and .env looks correct.
 *
 * Run: node scripts/check-env-wiring.mjs
 */
import { readFileSync } from "node:fs";

const CONFIG = "apps/api/src/config.ts";
const COMPOSE = "docker-compose.prod.yml";

const config = readFileSync(CONFIG, "utf8");
const compose = readFileSync(COMPOSE, "utf8");

// Keys of the EnvSchema object literal: two-space indented SCREAMING_CASE.
const declared = [...config.matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]);

if (declared.length === 0) {
  console.error(`✗ parsed no env keys from ${CONFIG} — has the schema been reformatted?`);
  process.exit(1);
}

const missing = declared.filter((key) => !compose.includes(key));

if (missing.length > 0) {
  console.error(`✗ declared in ${CONFIG} but not passed through ${COMPOSE}:\n`);
  for (const key of missing) console.error(`    ${key}`);
  console.error(
    `\n  Add each to the api service's \`environment:\` block, e.g.\n` +
      `    ${missing[0]}: \${${missing[0]}:-}\n\n` +
      `  Without it the container never sees the value, and the feature behaves\n` +
      `  as if it were switched off no matter what .env says.\n`
  );
  process.exit(1);
}

console.log(`✓ all ${declared.length} api env vars are wired through ${COMPOSE}`);
