import { addMinor, MoneyError, parseDecimalToMinor } from "./money";
import { isISODate } from "./dates";
import { assignImportHashes, findPossibleDuplicates, type PossibleDuplicate } from "./dedupe";
import type { CurrencyCode, ISODate, Transaction } from "./types";

/**
 * CSV import for accounts that cannot be linked. Parsing is strict: rows that
 * cannot be read unambiguously are reported as errors, never guessed.
 */

export const MAX_CSV_BYTES = 1_000_000;
export const MAX_CSV_ROWS = 5_000;

/** RFC 4180-style parser: quoted fields, escaped quotes, CRLF/LF, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const input = text.replace(/^﻿/, "");

  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === "") {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (inQuotes) throw new CsvError("Unterminated quoted field.");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

export interface ColumnMapping {
  date: number;
  description: number;
  /** Single signed amount column… */
  amount: number | null;
  /** …or separate debit/credit columns. */
  debit: number | null;
  credit: number | null;
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z]/g, "");

export function detectColumns(headers: readonly string[]): ColumnMapping | null {
  const find = (...names: string[]) => {
    const idx = headers.findIndex((h) => names.includes(norm(h)));
    return idx === -1 ? null : idx;
  };
  const date = find("date", "transactiondate", "posteddate", "postingdate", "transdate");
  const description = find("description", "payee", "merchant", "name", "memo", "details", "transactiondescription");
  const amount = find("amount", "transactionamount", "amountusd");
  const debit = find("debit", "withdrawal", "withdrawals", "debitamount", "moneyout");
  const credit = find("credit", "deposit", "deposits", "creditamount", "moneyin");
  if (date === null || description === null) return null;
  if (amount === null && (debit === null || credit === null)) return null;
  return { date, description, amount, debit, credit };
}

/** "$1,234.56", "(12.34)", "-12.34", "12.34-", "1234" → minor units. */
export function parseCsvAmount(raw: string, currency: CurrencyCode): number | null {
  let s = raw.trim().replace(/\s/g, "");
  if (s === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  s = s.replace(/^[$€£]/, "");
  if (!/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/.test(s)) {
    throw new CsvError(`Unreadable amount "${raw}"`);
  }
  try {
    const minor = parseDecimalToMinor(s.replace(/,/g, ""), currency);
    return negative ? -minor : minor;
  } catch (e) {
    if (e instanceof MoneyError) throw new CsvError(`Unreadable amount "${raw}"`);
    throw e;
  }
}

/** Accepts YYYY-MM-DD, MM/DD/YYYY, M/D/YY (US formats only, to avoid day/month ambiguity). */
export function parseCsvDate(raw: string): ISODate {
  const s = raw.trim();
  let iso: string | null = null;
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  const usMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (isoMatch) {
    iso = `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
  } else if (usMatch) {
    const year = usMatch[3].length === 2 ? `20${usMatch[3]}` : usMatch[3];
    iso = `${year}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
  }
  if (!iso || !isISODate(iso)) throw new CsvError(`Unreadable date "${raw}" (use YYYY-MM-DD or MM/DD/YYYY)`);
  return iso;
}

export type SignConvention = "negative_is_outflow" | "positive_is_outflow";

export interface ImportPreviewRow {
  index: number;
  line: number;
  date: ISODate;
  description: string;
  amountMinor: number;
  dedupeHash: string;
  /** Already imported earlier (same hash): will be skipped automatically. */
  alreadyImported: boolean;
  /** Looks like an existing transaction from another source: user decides. */
  possibleDuplicateOf: string | null;
}

export interface ImportPreview {
  rows: ImportPreviewRow[];
  errors: Array<{ line: number; message: string }>;
  newCount: number;
  alreadyImportedCount: number;
  possibleDuplicateCount: number;
  /** Net of the rows that would be imported. */
  netMinor: number;
  dateRange: { from: ISODate; to: ISODate } | null;
}

export function buildImportPreview(input: {
  text: string;
  accountId: string;
  currency: CurrencyCode;
  signConvention: SignConvention;
  existing: readonly Transaction[];
}): ImportPreview {
  if (input.text.length > MAX_CSV_BYTES) throw new CsvError("File is larger than 1 MB.");
  const table = parseCsv(input.text);
  if (table.length < 2) throw new CsvError("The file needs a header row and at least one transaction.");
  if (table.length - 1 > MAX_CSV_ROWS) throw new CsvError(`At most ${MAX_CSV_ROWS} rows can be imported at once.`);
  const mapping = detectColumns(table[0]);
  if (!mapping) {
    throw new CsvError("Couldn't find Date, Description and Amount (or Debit/Credit) columns in the header row.");
  }

  const errors: ImportPreview["errors"] = [];
  const parsed: Array<{ line: number; accountId: string; date: ISODate; amountMinor: number; description: string }> = [];
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    try {
      const date = parseCsvDate(cells[mapping.date] ?? "");
      const description = (cells[mapping.description] ?? "").trim().slice(0, 500);
      if (!description) throw new CsvError("Missing description");
      let amount: number | null;
      if (mapping.amount !== null) {
        amount = parseCsvAmount(cells[mapping.amount] ?? "", input.currency);
        if (amount !== null && input.signConvention === "positive_is_outflow") amount = -amount || 0;
      } else {
        const debit = parseCsvAmount(cells[mapping.debit as number] ?? "", input.currency);
        const credit = parseCsvAmount(cells[mapping.credit as number] ?? "", input.currency);
        if (debit !== null && credit !== null && debit !== 0 && credit !== 0) {
          throw new CsvError("Row has both a debit and a credit");
        }
        amount = debit ? -Math.abs(debit) : credit !== null ? Math.abs(credit) : debit === 0 ? 0 : null;
      }
      if (amount === null) throw new CsvError("Missing amount");
      parsed.push({ line, accountId: input.accountId, date, amountMinor: amount, description });
    } catch (e) {
      if (e instanceof CsvError) errors.push({ line, message: e.message });
      else throw e;
    }
  });

  const hashed = assignImportHashes(parsed);
  const existingHashes = new Set(
    input.existing
      .filter((t) => t.source === "csv" && t.accountId === input.accountId && t.dedupeHash)
      .map((t) => t.dedupeHash as string),
  );
  const nonCsv = input.existing.filter((t) => t.source !== "csv");
  const possible = new Map<number, PossibleDuplicate>();
  for (const d of findPossibleDuplicates(hashed, nonCsv)) {
    if (!possible.has(d.candidate.index)) possible.set(d.candidate.index, d);
  }

  const rows: ImportPreviewRow[] = hashed.map((r, index) => ({
    index,
    line: r.line,
    date: r.date,
    description: r.description,
    amountMinor: r.amountMinor,
    dedupeHash: r.dedupeHash,
    alreadyImported: existingHashes.has(r.dedupeHash),
    possibleDuplicateOf: possible.get(index)?.existingTransactionId ?? null,
  }));

  const toImport = rows.filter((r) => !r.alreadyImported);
  const dates = rows.map((r) => r.date).sort();
  return {
    rows,
    errors,
    newCount: toImport.length,
    alreadyImportedCount: rows.length - toImport.length,
    possibleDuplicateCount: toImport.filter((r) => r.possibleDuplicateOf).length,
    netMinor: toImport.reduce((s, r) => addMinor(s, r.amountMinor), 0),
    dateRange: dates.length ? { from: dates[0], to: dates.at(-1) as ISODate } : null,
  };
}
