import { expect, test } from "@playwright/test";

const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

test.describe("budget", () => {
  test("shows planned vs actual by section and month comparison", async ({ page }) => {
    await page.goto("/budget");
    await expect(page.getByRole("navigation", { name: "Budget sections" })).toBeVisible();
    for (const h of ["Fixed expenses", "Variable spending", "Savings", "Debt payments"]) {
      await expect(page.getByRole("heading", { name: h })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: /^Compared with/ })).toBeVisible();
    await expect(page.getByText(/Days 1–\d+ of each month/)).toBeVisible();
  });

  test("plans a future month by copying and editing", async ({ page }) => {
    const future = `20${30 + Math.floor(Math.random() * 60)}-0${1 + Math.floor(Math.random() * 9)}`;
    await page.goto(`/budget?month=${future}`);
    await expect(page.getByText(/No plan for/)).toBeVisible();
    await page.getByLabel("Category").selectOption({ label: "Groceries" });
    await page.getByLabel("Amount", { exact: true }).fill("612.40");
    await page.getByRole("button", { name: "Add to plan" }).click();
    await expect(page.getByText("Plan updated.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("$612.40").first()).toBeVisible();
  });

  test("manages bills, income, goals and shows the paycheck plan", async ({ page }) => {
    const bill = `Streaming ${unique()}`;
    await page.goto("/budget/bills");
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add bill" }) });
    await form.getByLabel("Name").fill(bill);
    await form.getByLabel("Amount", { exact: true }).fill("9.99");
    await form.getByLabel("Next due date").fill("2026-12-05");
    await form.getByRole("button", { name: "Add bill" }).click();
    await expect(page.getByText("Bill added.")).toBeVisible();
    await expect(page.getByText(bill).first()).toBeVisible();

    await page.goto("/budget/income");
    await expect(page.getByText(/received/).first()).toBeVisible();
    await expect(page.getByText(/Not included in the expected total/)).toBeVisible();

    await page.goto("/budget/paycheck");
    for (const b of ["Bills due before next paycheck", "Everyday essentials", "Savings goals", "Flexible spending"]) {
      await expect(page.getByText(b, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText(/Unassigned|Shortfall/)).toBeVisible();

    await page.goto("/budget/goals");
    await expect(page.getByText(/saves .* in interest/)).toBeVisible();
    await expect(page.getByText("Emergency fund").first()).toBeVisible();
  });

  test("rejects an invalid APR on the server", async ({ page }) => {
    await page.goto("/budget/goals");
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add debt plan" }) });
    await form.getByLabel("Name").fill("Bad APR");
    await form.getByLabel("APR (%)").fill("23.999");
    await form.getByRole("button", { name: "Add debt plan" }).click();
    await expect(form.locator('p[role="alert"]')).toContainText("APR");
  });
});
