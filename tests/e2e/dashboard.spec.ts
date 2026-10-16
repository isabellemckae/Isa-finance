import { expect, test } from "@playwright/test";

test.describe("dashboard (demo mode)", () => {
  test("labels fictional data and shows the key figures", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("note")).toContainText("Fictional demo data");
    await expect(page.getByRole("heading", { level: 2, name: "Safe to spend" })).toBeVisible();
    for (const label of ["Total cash", "Available cash", "Card debt", "Net worth", "Income", "Spending", "Budget left"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText("is not cash", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();
  });

  test("discloses the safe-to-spend calculation", async ({ page }) => {
    await page.goto("/");
    await page.getByText("How this is calculated").click();
    await expect(page.getByText("Credit card available credit is never counted as spendable cash.")).toBeVisible();
    await expect(page.getByText("Data gaps")).toBeVisible();
  });

  test("shows connection problems and stale data honestly", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Reconnect needed")).toBeVisible();
    await expect(page.getByText("Available balance not reported by this institution")).toBeVisible();
  });

  test("sends security headers", async ({ page }) => {
    const response = await page.goto("/");
    const headers = response!.headers();
    expect(headers["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["cache-control"]).toContain("no-store");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("navigates between sections", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Primary" }).filter({ visible: true });
    await nav.getByRole("link", { name: "Budget" }).click();
    await expect(page).toHaveURL(/\/budget$/);
    await expect(page.getByRole("heading", { level: 1, name: "Budget" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Budget" })).toHaveAttribute("aria-current", "page");
    await nav.getByRole("link", { name: "CFO" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Personal CFO" })).toBeVisible();
  });

  test("has no horizontal overflow", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("supports dark mode", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("radio", { name: "Dark" }).first().click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
  });
});
