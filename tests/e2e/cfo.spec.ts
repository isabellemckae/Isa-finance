import { expect, test } from "@playwright/test";

test.describe("personal CFO (demo mode, AI off)", () => {
  test("answers a suggested question with calculated, labeled numbers", async ({ page }) => {
    await page.goto("/cfo");
    await expect(page.getByText("Calculated answers (AI off)")).toBeVisible();
    await page.getByRole("list", { name: "Suggested questions" }).getByRole("button", { name: "What bills are coming up?" }).click();
    const convo = page.getByRole("list", { name: "Conversation" });
    await expect(convo.getByText("You said:", { exact: false })).toBeVisible();
    await expect(convo.getByText(/bills? (is|are) due in the next 30 days/)).toBeVisible();
    await expect(convo.getByText("Calculated answer")).toBeVisible();
    await expect(convo.getByText("Fictional data")).toBeVisible();
    await expect(convo.getByText(/Based on: Bills/)).toBeVisible();
    await expect(page).toHaveURL(/\/cfo\?c=/);
  });

  test("keeps the conversation for follow-up questions and history", async ({ page }) => {
    await page.goto("/cfo");
    const input = page.getByLabel("Ask a question");
    await input.fill("What's my safe to spend?");
    await page.getByRole("button", { name: "Send" }).click();
    const answers = page.getByRole("list", { name: "Conversation" }).getByText("Personal CFO");
    await expect(answers).toHaveCount(1);
    await input.fill("Can I afford $200?");
    await input.press("Enter");
    await expect(answers).toHaveCount(2);
    await expect(page.getByText(/fits|tight|doesn't fit|does not fit/i).first()).toBeVisible();

    const url = page.url();
    await page.goto(url);
    await expect(page.getByRole("list", { name: "Conversation" }).getByText("Personal CFO")).toHaveCount(2);
  });

  test("states plainly that it cannot move money", async ({ page }) => {
    await page.goto("/cfo");
    await expect(page.getByText("the CFO can't move money", { exact: false })).toBeVisible();
  });

  test("weekly and monthly briefings", async ({ page }) => {
    await page.goto("/cfo/briefing");
    await expect(page.getByRole("heading", { level: 1, name: "Weekly briefing" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Where it went" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What stands out" })).toBeVisible();
    await expect(page.getByText("Fictional demo data.", { exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "Briefing period" }).getByRole("link", { name: "Month" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Monthly briefing" })).toBeVisible();
  });

  test("rejects cross-site API requests", async ({ request }) => {
    const res = await request.post("/api/cfo/chat", {
      headers: { Origin: "https://evil.example" },
      data: { message: "hi" },
    });
    expect(res.status()).toBe(403);
  });
});
