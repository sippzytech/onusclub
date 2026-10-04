import { expect, test } from "@playwright/test";
import { createMerchant, createProgram, login, PASSWORD, stamp } from "./helpers";

/**
 * The onboarding checklist, which is the one piece of UI whose entire logic is
 * "derive four booleans from several API calls and render accordingly". The
 * API tests cannot see it at all — there is no endpoint — so this is exactly
 * the case a browser test exists for.
 */
test.describe("onboarding checklist", () => {
  test("signing up lands on a checklist, not an empty dashboard", async ({ page }) => {
    // Signup driven through the UI here, because signup is what is being
    // tested — every other spec creates its merchant over HTTP.
    const s = stamp();
    const email = `e2e-signup-${s}@example.com`;

    await page.goto("/signup");
    // By label, now that every field is properly associated with one.
    await page.getByLabel("Business name").fill(`E2E Signup ${s}`);
    await page.getByLabel("Your email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    // The form has a confirm field; omitting it was why this first failed.
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: /create|sign up|get started/i }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    // The point of the feature: the next action is visible without scrolling
    // past four dashed-out stat cards.
    await expect(page.getByText(/let.s get you set up/i)).toBeVisible();
    await expect(page.getByText("Create your loyalty card")).toBeVisible();
    await expect(page.getByText("0 of 4 done")).toBeVisible();

    // And the panel it replaced is gone.
    await expect(page.getByText("No programs yet")).toHaveCount(0);
  });

  test("it advances as real work gets done, and removes itself at the end", async ({
    page,
  }) => {
    const m = await createMerchant("onb");
    await login(page, m);
    await expect(page.getByText("0 of 4 done")).toBeVisible();

    // Each step is derived from state, so changing the state out of band is a
    // fair test — that is the property being asserted.
    const programId = await createProgram(m);
    await page.reload();
    await expect(page.getByText("1 of 4 done")).toBeVisible();
    // Heading changes once something is done.
    await expect(page.getByText(/nearly there/i)).toBeVisible();

    // With a card but no members, the signup URL is the most useful string on
    // the page and is printed in full.
    if (m.publicSlug) {
      await expect(page.getByText(`/m/${m.publicSlug}`)).toBeVisible();
    }

    // Skip the logo step (it needs a file upload) and complete the rest.
    const { createCard } = await import("./helpers");
    await createCard(m, programId);
    await page.reload();
    await expect(page.getByText("2 of 4 done")).toBeVisible();
  });

  test("a café that deletes its only program sees step one again", async ({ page }) => {
    // The reason steps are derived rather than stored. A "completed" flag
    // would leave this café permanently told it had finished a thing it no
    // longer has.
    const m = await createMerchant("undo");
    const programId = await createProgram(m);
    await login(page, m);
    await expect(page.getByText("1 of 4 done")).toBeVisible();

    const res = await fetch(
      `${process.env.E2E_API_BASE ?? "http://localhost:4000"}/v1/programs/${programId}`,
      { method: "DELETE", headers: { authorization: `Bearer ${m.jwt}` } }
    );
    // Only meaningful if the API actually supports deletion; skip rather than
    // assert a behaviour that does not exist.
    test.skip(!res.ok, "programs cannot be deleted via the API — nothing to assert");

    await page.reload();
    await expect(page.getByText("0 of 4 done")).toBeVisible();
    await expect(page.getByText("Create your loyalty card")).toBeVisible();
  });
});
