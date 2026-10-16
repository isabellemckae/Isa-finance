import { describe, expect, it } from "vitest";
import { detectTransfers } from "./transfers";
import { enrichTransactions, summarizePeriod } from "./classification";
import { account, category, override, tx } from "@/test/factories";

const checking = account({ name: "Checking" });
const savings = account({ name: "Savings", subtype: "savings" });
const card = account({ name: "Card", type: "credit" });
const accounts = [checking, savings, card];
const transferCat = category({ name: "Transfer", kind: "transfer", isEssential: false });
const ccCat = category({ name: "Credit card payment", kind: "transfer", isEssential: false });
const groceries = category({ name: "Groceries" });
const paycheck = category({ name: "Paycheck", kind: "income", isEssential: false });
const categories = [transferCat, ccCat, groceries, paycheck];

function detect(transactions: ReturnType<typeof tx>[], extra: Partial<Parameters<typeof detectTransfers>[0]> = {}) {
  return detectTransfers({
    transactions,
    accounts,
    categories,
    overrides: [],
    existingLinks: [],
    ...extra,
  });
}

describe("detectTransfers", () => {
  it("links a transfer between own accounts", () => {
    const out = tx(checking.id, { amountMinor: -50_000, description: "Online transfer to savings", date: "2026-10-05" });
    const inn = tx(savings.id, { amountMinor: 50_000, description: "Transfer from checking", date: "2026-10-06" });
    const result = detect([out, inn]);
    expect(result.links).toEqual([
      { outflowTransactionId: out.id, inflowTransactionId: inn.id, kind: "transfer", detectedBy: "rule" },
    ]);
  });

  it("classifies payments into a credit account as credit card payments", () => {
    const out = tx(checking.id, { amountMinor: -32_150, description: "CARD AUTOPAY", date: "2026-10-12" });
    const inn = tx(card.id, { amountMinor: 32_150, description: "PAYMENT THANK YOU", date: "2026-10-13" });
    expect(detect([out, inn]).links[0].kind).toBe("credit_card_payment");
  });

  it("does not link a purchase and an unrelated refund of the same amount", () => {
    const purchase = tx(checking.id, { amountMinor: -4_999, description: "Bookshop", defaultCategoryId: groceries.id });
    const refund = tx(card.id, { amountMinor: 4_999, description: "Shoe store return", defaultCategoryId: groceries.id });
    expect(detect([purchase, refund]).links).toEqual([]);
  });

  it("requires different accounts, equal amounts and the date window", () => {
    const out = tx(checking.id, { amountMinor: -10_000, description: "Transfer", date: "2026-10-01" });
    const sameAccount = tx(checking.id, { amountMinor: 10_000, description: "Transfer", date: "2026-10-01" });
    const differentAmount = tx(savings.id, { amountMinor: 10_001, description: "Transfer", date: "2026-10-01" });
    const tooLate = tx(savings.id, { amountMinor: 10_000, description: "Transfer", date: "2026-10-05" });
    expect(detect([out, sameAccount, differentAmount, tooLate]).links).toEqual([]);
    expect(detect([out, tooLate], { windowDays: 4 }).links).toHaveLength(1);
  });

  it("reports ambiguous matches instead of guessing", () => {
    const out = tx(checking.id, { amountMinor: -20_000, description: "Transfer", date: "2026-10-01" });
    const a = tx(savings.id, { amountMinor: 20_000, description: "Transfer", date: "2026-10-01" });
    const b = tx(card.id, { amountMinor: 20_000, description: "Payment", date: "2026-10-02" });
    const result = detect([out, a, b]);
    expect(result.links).toEqual([]);
    expect(result.ambiguous).toEqual([{ transactionId: out.id, candidateIds: [a.id, b.id].sort() }]);
  });

  it("respects existing links and user 'not a transfer' overrides", () => {
    const out = tx(checking.id, { amountMinor: -7_500, description: "Transfer" });
    const inn = tx(savings.id, { amountMinor: 7_500, description: "Transfer" });
    expect(
      detect([out, inn], {
        existingLinks: [{ outflowTransactionId: out.id, inflowTransactionId: "other", kind: "transfer", detectedBy: "user" }],
      }).links,
    ).toEqual([]);
    expect(detect([out, inn], { overrides: [override(inn.id, { transferOverride: "not_transfer" })] }).links).toEqual([]);
  });

  it("ignores removed and superseded transactions", () => {
    const out = tx(checking.id, { amountMinor: -1_000, description: "Transfer", isRemoved: true });
    const inn = tx(savings.id, { amountMinor: 1_000, description: "Transfer" });
    expect(detect([out, inn]).links).toEqual([]);
  });
});

describe("transfers are not double counted", () => {
  it("excludes linked legs from income and spending", () => {
    const pay = tx(checking.id, { amountMinor: 300_000, description: "ACME PAYROLL", defaultCategoryId: paycheck.id });
    const groceriesTx = tx(card.id, { amountMinor: -12_000, description: "Market", defaultCategoryId: groceries.id });
    const ccOut = tx(checking.id, { amountMinor: -12_000, description: "Card payment", defaultCategoryId: ccCat.id });
    const ccIn = tx(card.id, { amountMinor: 12_000, description: "Payment thank you", defaultCategoryId: ccCat.id });
    const toSavings = tx(checking.id, { amountMinor: -50_000, description: "Transfer to savings", defaultCategoryId: transferCat.id });
    const inSavings = tx(savings.id, { amountMinor: 50_000, description: "Transfer from checking", defaultCategoryId: transferCat.id });
    const all = [pay, groceriesTx, ccOut, ccIn, toSavings, inSavings];

    const { links } = detect(all);
    expect(links).toHaveLength(2);

    const enriched = enrichTransactions({ transactions: all, overrides: [], categories, transferLinks: links });
    const summary = summarizePeriod(enriched, "2026-10-01", "2026-10-31");
    // Card purchase counted once; the payment from checking is not spending.
    expect(summary.spendingMinor).toBe(12_000);
    // Inflows to savings/card are not income.
    expect(summary.incomeMinor).toBe(300_000);
    expect(summary.unmatchedTransferCount).toBe(0);
  });

  it("flags unmatched transfer-category legs and excludes them", () => {
    const lonely = tx(checking.id, { amountMinor: -9_000, description: "Transfer to external", defaultCategoryId: transferCat.id });
    const enriched = enrichTransactions({ transactions: [lonely], overrides: [], categories, transferLinks: [] });
    expect(enriched[0].flow).toBe("unmatched_transfer");
    const summary = summarizePeriod(enriched, "2026-10-01", "2026-10-31");
    expect(summary.spendingMinor).toBe(0);
    expect(summary.unmatchedTransferCount).toBe(1);
  });
});
