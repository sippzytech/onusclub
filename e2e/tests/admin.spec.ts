import { expect, test } from "@playwright/test";
import {
  createCard,
  createMerchant,
  createProgram,
  grantPlatformAdmin,
  login,
  revokePlatformAdmin,
} from "./helpers";

/**
 * The platform-admin surface.
 *
 * The API tests already prove every /v1/admin path refuses a merchant token.
 * What they cannot reach is the *web* half: whether /admin renders not-found
 * rather than redirecting to /login (a redirect confirms the route exists),
 * and whether the two-step adjustment confirm actually requires both steps.
 */
test.describe("platform admin", () => {
  test("an ordinary café cannot see or reach it", async ({ page }) => {
    const m = await createMerchant("notadmin");
    await login(page, m);

    // No link in the sidebar.
    await expect(page.getByRole("link", { name: "Platform admin" })).toHaveCount(0);

    // And the route itself is not-found, NOT a redirect to /login — a redirect
    // would confirm the namespace exists and is worth attacking.
    const res = await page.goto("/admin");
    expect(res?.status()).toBe(404);
    expect(page.url()).not.toContain("/login");
  });

  test("a granted admin gets the link and the dashboard", async ({ page }) => {
    const m = await createMerchant("admin");
    await grantPlatformAdmin(m.userId);
    try {
      await login(page, m);
      await expect(page.getByRole("link", { name: "Platform admin" })).toBeVisible();

      await page.goto("/admin");
      await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
      // The decision not to show a profit figure is load-bearing, so assert
      // the word is absent rather than trusting it stays that way.
      await expect(page.getByText(/profit/i)).toHaveCount(0);
      await expect(page.getByText(/recorded mrr/i)).toBeVisible();
    } finally {
      await revokePlatformAdmin(m.userId);
    }
  });

  test("revoking locks the page immediately, on the same session", async ({ page }) => {
    // The property the whole design exists for: membership is a database row
    // checked per request, not a claim in a 7-day JWT. The API suite asserts
    // this over HTTP; this asserts the browser session goes with it.
    const m = await createMerchant("revoke");
    await grantPlatformAdmin(m.userId);
    await login(page, m);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

    await revokePlatformAdmin(m.userId);

    const res = await page.goto("/admin");
    expect(res?.status()).toBe(404);
  });

  test("a balance adjustment needs a reason and an explicit confirm", async ({ page }) => {
    const m = await createMerchant("adjust");
    const programId = await createProgram(m);
    const { cardId } = await createCard(m, programId);
    await grantPlatformAdmin(m.userId);

    try {
      await login(page, m);
      await page.goto(`/admin/cards/${cardId}`);
      await expect(page.getByRole("heading", { name: /correct the balance/i })).toBeVisible();

      const review = page.getByRole("button", { name: /review this change/i });

      // Disabled with nothing filled in.
      await expect(review).toBeDisabled();

      // Still disabled with a delta but no reason — the reason is required,
      // because an adjustment with none is indistinguishable from a mistake.
      await page.getByPlaceholder(/e\.g\. 1 or -2/).fill("2");
      await expect(review).toBeDisabled();

      await page.getByLabel(/why/i).fill("e2e: scan failed at the till");
      await expect(review).toBeEnabled();

      // The projection is shown before anything is written.
      await expect(page.getByText(/0 → 2 stamps/)).toBeVisible();

      // Reviewing does NOT apply it — that is the whole point of two steps.
      await review.click();
      await expect(page.getByText(/this will change the balance/i)).toBeVisible();
      await expect(
        page.getByText(/by OnUsClub support: e2e: scan failed at the till/)
      ).toBeVisible();

      await page.getByRole("button", { name: /yes, apply it/i }).click();
      await expect(page.getByText(/balance moved from/i)).toBeVisible();

      // ⚠️ And the café can see it on their OWN card page. An operator
      // changing a merchant's data invisibly is the real risk in this feature.
      await page.goto(`/dashboard/cards/${cardId}`);
      await expect(page.getByText(/adjusted by onusclub/i)).toBeVisible();
      await expect(page.getByText(/scan failed at the till/)).toBeVisible();
    } finally {
      await revokePlatformAdmin(m.userId);
    }
  });
});
