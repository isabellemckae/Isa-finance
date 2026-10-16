import { expect, test } from "@playwright/test";

const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

test.describe("transactions", () => {
  test("searches and filters, with filters kept in the URL", async ({ page }) => {
    await page.goto("/transactions");
    await page.getByRole("searchbox", { name: "Search transactions" }).fill("Pilates");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/q=Pilates/);
    await expect(page.getByText(/^\d+ results?$/)).toBeVisible();
    const rows = page.locator('a[href^="/transactions/demo-tx-"]');
    await expect(rows.first()).toContainText("Pilates");

    await page.goto("/transactions?type=transfer");
    await expect(page.getByText(/Card payment|Transfer/).first()).toBeVisible();
    await page.goto("/transactions?status=pending");
    await expect(page.getByText("Pending").first()).toBeVisible();
  });

  test("ignores malicious filter values", async ({ page }) => {
    const response = await page.goto("/transactions?type=<script>&from=2026-99-99&account=../../x&page=-5");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
  });

  test("recategorizes and annotates a transaction without touching the original", async ({ page }) => {
    await page.goto("/transactions?q=StreamBox");
    await page.locator('a[href^="/transactions/demo-tx-"]').first().click();
    await expect(page.getByRole("heading", { name: "Original record" })).toBeVisible();
    const original = await page.locator("dl").last().innerText();

    const note = `Shared plan ${unique()}`;
    await page.getByLabel("Category").selectOption({ label: "Entertainment" });
    await page.getByLabel("Note").fill(note);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Note")).toHaveValue(note);
    await expect(page.getByText("Entertainment").first()).toBeVisible();
    expect(await page.locator("dl").last().innerText()).toBe(original);
  });

  test("shows linked transfers and the review queue", async ({ page }) => {
    await page.goto("/transactions?q=thank%20you");
    await page.locator('a[href^="/transactions/demo-tx-"]').first().click();
    await expect(page.getByText(/Linked as a credit card payment/)).toBeVisible();
    await page.goto("/transactions?type=review");
    await expect(page).toHaveURL(/type=review/);
  });

  test("imports a CSV idempotently with a preview", async ({ page }) => {
    const tag = unique();
    const csv = [
      "Date,Description,Amount",
      `2026-10-02,Bookshop ${tag},-24.99`,
      `2026-10-03,Refund ${tag},5.00`,
      `2026-10-03,Refund ${tag},5.00`,
      "not-a-date,Broken,1",
    ].join("\n");

    for (const round of [1, 2]) {
      await page.goto("/transactions/import?account=demo-acct-cash");
      await page.getByLabel("CSV file").setInputFiles({ name: "export.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      await page.getByRole("button", { name: "Preview import" }).click();
      await expect(page.getByRole("heading", { name: "2. Review" })).toBeVisible();
      await expect(page.getByText("Line 5", { exact: false })).toBeVisible();
      if (round === 1) {
        await expect(page.getByText(`Bookshop ${tag}`)).toBeVisible();
        await page.getByRole("button", { name: "Import transactions" }).click();
        await expect(page).toHaveURL(/imported=3/);
        await expect(page.getByText(/Imported 3 transactions/)).toBeVisible();
      } else {
        await expect(page.getByText("Already imported")).toHaveCount(4); // 3 rows + stat label
        await expect(page.getByRole("button", { name: "Nothing new to import" })).toBeDisabled();
      }
    }
  });

  test("adds a manual cash transaction", async ({ page }) => {
    const desc = `Farmers market ${unique()}`;
    await page.goto("/transactions/new?account=demo-acct-cash");
    await page.getByLabel("Description").fill(desc);
    await page.getByLabel("Amount").fill("18.25");
    await page.getByRole("button", { name: "Add transaction" }).click();
    await expect(page).toHaveURL(/\/transactions\/demo-manual-tx-/);
    await expect(page.getByRole("heading", { level: 1, name: desc })).toBeVisible();
    await expect(page.getByText("-$18.25").first()).toBeVisible();
  });
});
