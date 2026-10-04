import { defineConfig, devices } from "@playwright/test";

/**
 * Browser-level tests — backlog item 20.
 *
 * WHAT THIS IS FOR, AND WHAT IT IS NOT
 *
 * The two smoke suites already cover the API thoroughly and black-box: around
 * 200 assertions over every endpoint, including cross-tenant isolation. There
 * is no value in repeating them through a browser, and doing so would just be
 * slower and flakier.
 *
 * So these tests only cover things a browser is genuinely required for:
 * multi-page flows where each step depends on the last, server-rendered state
 * derived from several API calls at once, and client components whose
 * behaviour lives in React rather than in a response body.
 *
 * ⚠️ The QR scanner is deliberately NOT covered. `/dashboard/scan` is
 * camera-only — there is no manual token-entry fallback — so testing it would
 * mean feeding Chromium a fake video stream containing a generated QR code and
 * hoping html5-qrcode decodes it. That is a test of html5-qrcode, not of us,
 * and the scan *operation* is already covered through the card detail page,
 * which hits the same endpoints. Saying this out loud so nobody assumes the
 * scanner is tested.
 *
 * Expects an already-running stack, the same contract as `pnpm smoke`:
 *   E2E_WEB_BASE   default http://localhost:3001
 *   E2E_API_BASE   default http://localhost:4000
 */
export default defineConfig({
  testDir: "./tests",
  // Sequential. These tests create merchants and walk them through state
  // changes; running them in parallel against one database turns a failure
  // into a puzzle rather than a signal.
  workers: 1,
  fullyParallel: false,
  // Generous: a cold Next.js dev server compiles a route on first request, and
  // the first navigation to each page can genuinely take seconds.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // One retry locally, two in CI. Not to paper over flake — a retry that
  // changes the result is itself reported — but a cold compile on the very
  // first hit is a real and uninteresting failure mode.
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env.E2E_WEB_BASE ?? "http://localhost:3001",
    // Only on a failing retry. Traces are large and nobody opens the ones
    // from passing runs.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  // Chromium only. These are flow tests, not rendering tests — the dashboard
  // has no browser-specific code, and the two wallet surfaces that do are
  // native apps no browser engine can stand in for.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
