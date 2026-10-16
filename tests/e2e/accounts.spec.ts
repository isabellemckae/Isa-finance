import { expect, test } from "@playwright/test";

const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

test.describe("accounts", () => {
  test("lists grouped accounts with health and credit details", async ({ page }) => {
    await page.goto("/accounts");
    await expect(page.getByRole("heading", { level: 1, name: "Accounts" })).toBeVisible();
    for (const group of ["Checking & cash", "Savings", "Credit cards"]) {
      await expect(page.getByRole("heading", { name: group })).toBeVisible();
    }
    await expect(page.getByText("Reconnect needed").first()).toBeVisible();
    await expect(page.getByText(/% used/).first()).toBeVisible();
    await expect(page.getByText("never counted as cash", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Coming in Phase 4" })).toBeDisabled();
  });

  test("shows credit limits separately from cash on a card", async ({ page }) => {
    await page.goto("/accounts/demo-acct-meadowlark-card");
    await expect(page.getByRole("heading", { name: "Balance owed" })).toBeVisible();
    await expect(page.getByText("Available credit (not cash)")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reconnect" })).toBeDisabled();
  });

  test("creates, updates and deletes a manual account", async ({ page }) => {
    const name = `Wallet ${unique()}`;
    await page.goto("/accounts/new");
    await page.getByLabel("Account name").fill(name);
    await page.getByLabel("Type").selectOption("depository:cash");
    await page.getByLabel("Current balance").fill("120.50");
    await page.getByRole("button", { name: "Add account" }).click();

    await expect(page).toHaveURL(/\/accounts\/demo-manual-/);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText("$120.50").first()).toBeVisible();

    await page.getByLabel("Balance now").fill("99.99");
    await page.getByRole("button", { name: "Update balance" }).click();
    await expect(page.getByText("Balance updated.")).toBeVisible();
    await expect(page.getByText("$99.99").first()).toBeVisible();

    await page.getByLabel("Nickname").fill(`Fun money ${name}`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Account updated.")).toBeVisible();

    await page.getByLabel('Type "delete" to confirm').fill("delete");
    await page.getByRole("button", { name: "Delete account" }).click();
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test("rejects invalid amounts without saving", async ({ page }) => {
    await page.goto("/accounts/new");
    await page.getByLabel("Account name").fill("Bad amount");
    await page.getByLabel("Current balance").fill("10.005");
    // No client-side pattern: the server is the validator.
    await page.getByRole("button", { name: "Add account" }).click();
    await expect(page.locator('p[role="alert"]')).toContainText("valid amount");
    await expect(page).toHaveURL(/\/accounts\/new$/);
  });
});
