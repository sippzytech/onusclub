import { expect, test } from "@playwright/test";
import { createMerchant, createProgram } from "./helpers";

/**
 * The public customer signup page — the single most important screen in the
 * product, and the one nothing was testing.
 *
 * 🚨 WHY THIS FILE EXISTS
 *
 * The day/month/year birthday control shipped completely non-functional. It
 * read its three parts from `fromIsoDate(value)` on every render, and
 * `toIsoDate` returns "" unless all three are set — so choosing a day emitted
 * "", the parent state never changed, and the dropdown snapped back to the
 * placeholder. It could not be partly filled, therefore it could not be
 * filled, therefore nobody could sign up at all.
 *
 * A typecheck passed it. A production build passed it. The API smoke suite
 * passed it, because the API was never the problem. The first thing to
 * actually click it was a café owner on his iPhone, in production.
 *
 * So: a browser test that clicks the control and completes a real signup.
 * That is the only kind of test that could have caught this.
 */
test.describe("public customer signup", () => {
  test("a customer can pick a birthday and get a card", async ({ page }) => {
    const m = await createMerchant();
    await createProgram(m, 6);

    await page.goto(`/m/${m.publicSlug}`);

    await expect(
      page.getByRole("heading", { name: new RegExp(m.businessName, "i") })
    ).toBeVisible();

    // 🚨 The regression that shipped: each selection must STICK. Asserted
    // one part at a time, because the bug was specifically that a partly
    // filled control reset itself — checking only the finished date would
    // have passed against the broken version if all three were set at once.
    const day = page.getByLabel("Day of birth");
    const month = page.getByLabel("Month of birth");
    const year = page.getByLabel("Year of birth");

    await day.selectOption("05");
    await expect(day).toHaveValue("05");

    await month.selectOption("12");
    await expect(month).toHaveValue("12");
    // ...and the day it was already holding survived the second choice.
    await expect(day).toHaveValue("05");

    await year.selectOption("1990");
    await expect(year).toHaveValue("1990");
    await expect(day).toHaveValue("05");
    await expect(month).toHaveValue("12");

    await page.getByLabel("Your name").fill("E2E Birthday Tester");
    await page.getByLabel("Email").fill(`e2e-enrol-${Date.now()}@example.com`);

    await page.getByRole("button", { name: /get my loyalty card/i }).click();

    // The card page, or the success state with a wallet link on it.
    await expect(
      page.getByText(/added|your card|wallet|you.re in/i).first()
    ).toBeVisible({ timeout: 30_000 });
  });

  test("skipping the birthday is refused where the customer can see it", async ({
    page,
  }) => {
    const m = await createMerchant();
    await createProgram(m, 6);

    await page.goto(`/m/${m.publicSlug}`);

    await page.getByLabel("Your name").fill("No Birthday");
    await page.getByLabel("Email").fill(`e2e-nodob-${Date.now()}@example.com`);
    await page.getByRole("button", { name: /get my loyalty card/i }).click();

    // ⚠️ The message must be AT the field. The general error block sits above
    // the submit button, which on a phone is off-screen from the top of the
    // form — a refused signup then looks like nothing happening, which is
    // how this was reported in the first place.
    const fieldError = page.getByText(/pick the day, month and year/i);
    await expect(fieldError).toBeVisible();

    const dayBox = await page.getByLabel("Day of birth").boundingBox();
    const errBox = await fieldError.boundingBox();
    expect(dayBox).not.toBeNull();
    expect(errBox).not.toBeNull();
    // Within a couple of hundred pixels of the control it refers to.
    expect(Math.abs((errBox?.y ?? 0) - (dayBox?.y ?? 0))).toBeLessThan(200);
  });
});
