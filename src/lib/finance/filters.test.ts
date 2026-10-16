import { describe, expect, it } from "vitest";
import { filterTransactions, filtersToQuery, groupByDay, paginate, parseTransactionFilters, UNCATEGORIZED } from "./filters";
import { enrichTransactions } from "./classification";
import { account, category, override, tx } from "@/test/factories";

const checking = account();
const card = account({ type: "credit" });
const groceries = category({ name: "Groceries" });
const pay = category({ name: "Paycheck", kind: "income" });
const transfer = category({ name: "Transfer", kind: "transfer" });
const categories = [groceries, pay, transfer];

const rows = [
  tx(checking.id, { id: "t1", date: "2026-10-01", amountMinor: 250_000, description: "ACME PAYROLL", defaultCategoryId: pay.id }),
  tx(card.id, { id: "t2", date: "2026-10-03", amountMinor: -4_512, description: "FERN & FIG MARKET", defaultCategoryId: groceries.id }),
  tx(card.id, { id: "t3", date: "2026-10-03", amountMinor: -1_250, description: "MYSTERY CHARGE", status: "pending" }),
  tx(checking.id, { id: "t4", date: "2026-10-05", amountMinor: -9_000, description: "Transfer out", defaultCategoryId: transfer.id }),
  tx(checking.id, { id: "t5", date: "2026-10-06", amountMinor: 3_000, description: "Venmo cashout" }),
];
const enriched = enrichTransactions({
  transactions: rows,
  overrides: [override("t2", { note: "Weekly shop with Maya" })],
  categories,
  transferLinks: [],
});
const all = parseTransactionFilters({});

describe("parseTransactionFilters", () => {
  it("drops invalid values instead of trusting them", () => {
    const f = parseTransactionFilters({ from: "2026-13-01", type: "drop table", page: "-4", account: "../../etc", q: "  coffee  " });
    expect(f).toMatchObject({ from: null, type: "all", page: 1, accountId: null, q: "coffee" });
  });

  it("swaps inverted date ranges and round-trips to a query string", () => {
    const f = parseTransactionFilters({ from: "2026-10-31", to: "2026-10-01", type: "expense" });
    expect([f.from, f.to]).toEqual(["2026-10-01", "2026-10-31"]);
    expect(filtersToQuery(f)).toBe("?from=2026-10-01&to=2026-10-31&type=expense");
  });
});

describe("filterTransactions", () => {
  const ids = (f: Partial<typeof all>) => filterTransactions(enriched, { ...all, ...f }).map((t) => t.id);

  it("sorts newest first, pending before posted on the same day", () => {
    expect(ids({})).toEqual(["t5", "t4", "t3", "t2", "t1"]);
  });

  it("searches merchant, description, notes, category and amount", () => {
    expect(ids({ q: "fern" })).toEqual(["t2"]);
    expect(ids({ q: "maya" })).toEqual(["t2"]);
    expect(ids({ q: "groceries" })).toEqual(["t2"]);
    expect(ids({ q: "45.12" })).toEqual(["t2"]);
  });

  it("filters by type, status, account, category and dates", () => {
    expect(ids({ type: "income" })).toEqual(["t1"]);
    expect(ids({ type: "expense" })).toEqual(["t3", "t2"]);
    expect(ids({ type: "transfer" })).toEqual(["t4"]);
    expect(ids({ status: "pending" })).toEqual(["t3"]);
    expect(ids({ accountId: card.id })).toEqual(["t3", "t2"]);
    expect(ids({ categoryId: UNCATEGORIZED })).toEqual(["t5", "t3"]);
    expect(ids({ from: "2026-10-03", to: "2026-10-05" })).toEqual(["t4", "t3", "t2"]);
  });

  it("builds a review queue of uncategorized, unclassified and unmatched items", () => {
    expect(ids({ type: "review" })).toEqual(["t5", "t4", "t3"]);
    expect(filterTransactions(enriched, { ...all, type: "review" }, new Set(["t1"])).map((t) => t.id)).toContain("t1");
  });
});

describe("grouping and paging", () => {
  it("groups by day with signed daily net", () => {
    const groups = groupByDay(filterTransactions(enriched, all));
    expect(groups.find((g) => g.date === "2026-10-03")).toMatchObject({ netMinor: -5_762 });
    expect(groups.map((g) => g.date)).toEqual(["2026-10-06", "2026-10-05", "2026-10-03", "2026-10-01"]);
  });

  it("paginates cumulatively (load more)", () => {
    const items = Array.from({ length: 120 }, (_, i) => i);
    expect(paginate(items, 1, 50)).toMatchObject({ page: 1, pageCount: 3, hasMore: true, total: 120 });
    expect(paginate(items, 2, 50).items).toHaveLength(100);
    expect(paginate(items, 99, 50)).toMatchObject({ page: 3, hasMore: false });
  });
});
