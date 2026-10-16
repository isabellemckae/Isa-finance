import { describe, expect, it } from "vitest";
import { buildDemoData } from "./dataset";
import { buildDashboard } from "@/lib/finance/dashboard";
import { enrichTransactions } from "@/lib/finance/classification";

const now = new Date("2026-10-16T18:00:00Z");

describe("demo dataset", () => {
  const data = buildDemoData(now);

  it("is deterministic and fully labeled as fictional", () => {
    expect(buildDemoData(now)).toEqual(data);
    expect(data.isDemo).toBe(true);
    expect(data.accounts.every((a) => a.isDemo)).toBe(true);
    // No real institution names in fictional data.
    for (const a of data.accounts) {
      expect(a.institutionName).toMatch(/\(fictional\)|Manual account/);
      expect(a.institutionName).not.toMatch(/discover|united heritage/i);
    }
  });

  it("has unique transaction ids and links every transfer leg", () => {
    const ids = data.transactions.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const enriched = enrichTransactions(data);
    const unmatched = enriched.filter((t) => t.flow === "unmatched_transfer");
    expect(unmatched).toEqual([]);
    expect(data.transferLinks.some((l) => l.kind === "credit_card_payment")).toBe(true);
    expect(data.transferLinks.some((l) => l.kind === "transfer")).toBe(true);
  });
});

describe("dashboard model from demo data", () => {
  const model = buildDashboard(buildDemoData(now), now);

  it("keeps credit availability and savings out of spendable cash", () => {
    const spendable = model.safeToSpend.components.find((c) => c.key === "spendable_cash")!.amountMinor;
    // Everyday checking (available) + cash envelope; savings, card and the disconnected account excluded.
    const checking = model.accounts.find((a) => a.account.id === "demo-acct-juniper-checking")!.snapshot!;
    expect(spendable).toBe(checking.availableMinor! + 14_000);
    expect(model.balances.availableCreditMinor).toBeGreaterThan(0);
    expect(model.balances.totalCashMinor).toBe(384_217 + 946_000 + 61_208 + 14_000);
  });

  it("discloses stale, unavailable and unhealthy data", () => {
    expect(model.balances.unhealthyAccountIds).toEqual(["demo-acct-cobblestone-checking"]);
    expect(model.balances.availableCash.isPartial).toBe(true);
    expect(model.safeToSpend.confidence).toBe("estimated");
    expect(model.safeToSpend.warnings.join(" ")).toMatch(/Bills account needs to be reconnected/);
  });

  it("produces consistent month figures", () => {
    const m = model.monthToDate;
    expect(m.spendingMinor).toBe(m.spendingPostedMinor + m.spendingPendingMinor);
    expect(m.byCategory.reduce((s, c) => s + c.spentMinor, 0)).toBe(m.spendingMinor);
    expect(model.cashFlow).toHaveLength(6);
    expect(model.cashFlow.at(-1)!.isPartial).toBe(true);
    expect(model.insights.length).toBeGreaterThan(0);
  });
});
