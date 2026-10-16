import { expect, test } from "@playwright/test";

const PAGES = [
  "/",
  "/accounts",
  "/accounts/demo-acct-meadowlark-card",
  "/accounts/new",
  "/transactions",
  "/transactions/import",
  "/budget",
  "/budget/bills",
  "/budget/income",
  "/budget/paycheck",
  "/budget/goals",
  "/settings",
  "/cfo",
  "/cfo/briefing",
  "/cfo/briefing?period=month",
];

test.describe("responsive layout", () => {
  for (const path of PAGES) {
    test(`${path} has no horizontal overflow and no errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await expect(page.getByText("Something went wrong")).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test("form controls use 16px text so iOS Safari doesn't zoom", async ({ page, isMobile }) => {
    test.skip(!isMobile);
    await page.goto("/accounts/new");
    const sizes = await page.locator("input, select, textarea").evaluateAll((els) =>
      els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => parseFloat(getComputedStyle(e).fontSize)),
    );
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(16);
  });
});
