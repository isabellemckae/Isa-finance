import { describe, expect, it } from "vitest";
import { buildImportPreview, CsvError, detectColumns, parseCsv, parseCsvAmount, parseCsvDate } from "./csv";
import { assignImportHashes } from "./dedupe";
import { tx } from "@/test/factories";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, commas, CRLF and a BOM", () => {
    const text = '﻿Date,Description,Amount\r\n2026-10-01,"Coffee, ""large""",-4.50\r\n\r\n2026-10-02,Plain,10\n';
    expect(parseCsv(text)).toEqual([
      ["Date", "Description", "Amount"],
      ["2026-10-01", 'Coffee, "large"', "-4.50"],
      ["2026-10-02", "Plain", "10"],
    ]);
  });

  it("supports newlines inside quoted fields", () => {
    expect(parseCsv('a,b\n"line1\nline2",x')).toEqual([["a", "b"], ["line1\nline2", "x"]]);
  });

  it("rejects unterminated quotes", () => {
    expect(() => parseCsv('a,b\n"oops,1')).toThrow(CsvError);
  });
});

describe("column detection", () => {
  it("finds common bank export headers", () => {
    expect(detectColumns(["Posted Date", "Payee", "Amount"])).toEqual({ date: 0, description: 1, amount: 2, debit: null, credit: null });
    expect(detectColumns(["Date", "Description", "Debit", "Credit"])).toMatchObject({ amount: null, debit: 2, credit: 3 });
    expect(detectColumns(["When", "What", "How much"])).toBeNull();
  });
});

describe("amounts and dates", () => {
  it.each([
    ["$1,234.56", 123456],
    ["(12.34)", -1234],
    ["12.34-", -1234],
    ["-0.99", -99],
    ["+5", 500],
    ["", null],
  ])("parses amount %j", (raw, expected) => {
    expect(parseCsvAmount(raw, "USD")).toBe(expected);
  });

  it.each(["12,34", "1.2.3", "abc", "1.005", "$1,23.00"])("rejects ambiguous amount %j", (raw) => {
    expect(() => parseCsvAmount(raw, "USD")).toThrow(CsvError);
  });

  it("parses ISO and US dates only", () => {
    expect(parseCsvDate("2026-10-05")).toBe("2026-10-05");
    expect(parseCsvDate("10/5/2026")).toBe("2026-10-05");
    expect(parseCsvDate("1/2/26")).toBe("2026-01-02");
    expect(() => parseCsvDate("2026-02-30")).toThrow(CsvError);
    expect(() => parseCsvDate("05.10.2026")).toThrow(CsvError);
  });
});

describe("buildImportPreview", () => {
  const csv = [
    "Date,Description,Amount",
    "2026-10-01,COFFEE SHOP,-4.50",
    "2026-10-01,COFFEE SHOP,-4.50",
    "2026-10-02,PAYCHECK,1500.00",
    "2026-10-03,TARGET STORE,-67.89",
    "bad-date,Broken row,-1",
    "2026-10-04,No amount,",
  ].join("\n");

  it("parses rows, reports errors per line, and keeps same-day duplicates", () => {
    const preview = buildImportPreview({ text: csv, accountId: "a1", currency: "USD", signConvention: "negative_is_outflow", existing: [] });
    expect(preview.rows.map((r) => r.amountMinor)).toEqual([-450, -450, 150_000, -6_789]);
    expect(new Set(preview.rows.map((r) => r.dedupeHash)).size).toBe(4);
    expect(preview.errors).toEqual([
      { line: 6, message: expect.stringMatching(/Unreadable date/) },
      { line: 7, message: "Missing amount" },
    ]);
    expect(preview.newCount).toBe(4);
    expect(preview.netMinor).toBe(-450 - 450 + 150_000 - 6_789);
    expect(preview.dateRange).toEqual({ from: "2026-10-01", to: "2026-10-03" });
  });

  it("flips signs for banks that export outflows as positive", () => {
    const preview = buildImportPreview({
      text: "Date,Description,Amount\n2026-10-01,Groceries,45.00",
      accountId: "a1",
      currency: "USD",
      signConvention: "positive_is_outflow",
      existing: [],
    });
    expect(preview.rows[0].amountMinor).toBe(-4_500);
  });

  it("handles debit/credit columns", () => {
    const preview = buildImportPreview({
      text: "Date,Description,Debit,Credit\n2026-10-01,Rent,1650.00,\n2026-10-02,Refund,,25.00",
      accountId: "a1",
      currency: "USD",
      signConvention: "negative_is_outflow",
      existing: [],
    });
    expect(preview.rows.map((r) => r.amountMinor)).toEqual([-165_000, 2_500]);
  });

  it("marks rows imported before as already imported (idempotent re-import)", () => {
    const first = buildImportPreview({ text: csv, accountId: "a1", currency: "USD", signConvention: "negative_is_outflow", existing: [] });
    const existing = first.rows.slice(0, 2).map((r) =>
      tx("a1", { source: "csv", amountMinor: r.amountMinor, date: r.date, description: r.description, dedupeHash: r.dedupeHash }),
    );
    const second = buildImportPreview({ text: csv, accountId: "a1", currency: "USD", signConvention: "negative_is_outflow", existing });
    expect(second.alreadyImportedCount).toBe(2);
    expect(second.newCount).toBe(2);
    // Same hashes in a different account are not duplicates.
    const other = buildImportPreview({ text: csv, accountId: "a2", currency: "USD", signConvention: "negative_is_outflow", existing });
    expect(other.alreadyImportedCount).toBe(0);
  });

  it("flags likely duplicates of bank-synced transactions for review", () => {
    const synced = tx("a1", { id: "bank-1", source: "plaid", amountMinor: -6_789, date: "2026-10-02", description: "TARGET STORE 1234" });
    const preview = buildImportPreview({ text: csv, accountId: "a1", currency: "USD", signConvention: "negative_is_outflow", existing: [synced] });
    expect(preview.rows.find((r) => r.amountMinor === -6_789)?.possibleDuplicateOf).toBe("bank-1");
    expect(preview.possibleDuplicateCount).toBe(1);
  });

  it("rejects files without recognizable columns", () => {
    expect(() =>
      buildImportPreview({ text: "foo,bar\n1,2", accountId: "a1", currency: "USD", signConvention: "negative_is_outflow", existing: [] }),
    ).toThrow(/Couldn't find/);
  });

  it("hashes match the dedupe module (stable across releases)", () => {
    const preview = buildImportPreview({ text: csv, accountId: "a1", currency: "USD", signConvention: "negative_is_outflow", existing: [] });
    const direct = assignImportHashes(preview.rows.map((r) => ({ accountId: "a1", date: r.date, amountMinor: r.amountMinor, description: r.description })));
    expect(direct.map((r) => r.dedupeHash)).toEqual(preview.rows.map((r) => r.dedupeHash));
  });
});
