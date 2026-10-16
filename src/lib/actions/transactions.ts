"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { buildImportPreview, CsvError, MAX_CSV_BYTES, type ImportPreview, type SignConvention } from "@/lib/finance/csv";
import { validateTransferLink } from "@/lib/finance/transfers";
import { checkbox, formObject, idField, isoDateField, money, optionalId, optionalText, text } from "@/lib/forms";
import { firstError } from "@/lib/forms";
import { linkDetectedTransfers, rejectTransfer } from "@/lib/data/operations";
import { failure, runAction, success, type ActionState } from "./run";

const txPaths = (id?: string) => ["/transactions", ...(id ? [`/transactions/${id}`] : []), "/budget", "/accounts"];

// ---------------------------------------------------------------------------
// Edits (stored as overrides; bank data is never changed)
// ---------------------------------------------------------------------------

const editSchema = z.object({
  id: idField,
  categoryId: optionalId,
  merchantName: optionalText(200, "Merchant name"),
  note: optionalText(2000, "Note"),
  excludeFromBudget: checkbox,
  transferMode: z.enum(["auto", "is_transfer", "not_transfer"]),
});

export async function saveTransactionEditsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = editSchema.safeParse(formObject(formData, ["excludeFromBudget"]));
  if (!parsed.success) return failure(firstError(parsed.error));
  const v = parsed.data;
  return runAction(async ({ repo }) => {
    await repo.saveOverride({
      transactionId: v.id,
      categoryId: v.categoryId,
      merchantName: v.merchantName,
      note: v.note,
      excludeFromBudget: v.excludeFromBudget,
      transferOverride: v.transferMode === "auto" ? null : v.transferMode,
    });
    await repo.audit("transaction.edited", "transaction", v.id);
    return "Saved.";
  }, txPaths(v.id));
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

const linkSchema = z.object({ id: idField, partnerId: idField });

export async function linkTransferAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = linkSchema.safeParse(formObject(formData));
  if (!parsed.success) return failure("Choose a matching transaction.");
  return runAction(async ({ repo, now }) => {
    const data = await repo.getFinancialData(now);
    const self = data.transactions.find((t) => t.id === parsed.data.id);
    if (!self) return failure("Transaction not found.");
    const [outflowTransactionId, inflowTransactionId] =
      self.amountMinor < 0 ? [parsed.data.id, parsed.data.partnerId] : [parsed.data.partnerId, parsed.data.id];
    const result = validateTransferLink(
      { outflowTransactionId, inflowTransactionId },
      data.transactions,
      data.accounts,
      data.transferLinks,
    );
    if (!result.ok) return failure(result.reason);
    // Linking overrides any earlier "not a transfer" choice on both legs.
    for (const id of [outflowTransactionId, inflowTransactionId]) {
      const o = data.overrides.find((x) => x.transactionId === id);
      if (o?.transferOverride === "not_transfer") await repo.saveOverride({ ...o, transferOverride: null });
    }
    await repo.linkTransfer(result.link);
    await repo.audit("transaction.transfer_linked", "transaction", parsed.data.id);
    return result.link.kind === "credit_card_payment" ? "Linked as a card payment." : "Linked as a transfer.";
  }, txPaths(parsed.data.id));
}

export async function unlinkTransferAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = idField.safeParse(formData.get("id"));
  if (!id.success) return failure("Invalid transaction.");
  return runAction(async ({ repo, now }) => {
    await rejectTransfer(repo, id.data, now);
    await repo.audit("transaction.transfer_unlinked", "transaction", id.data);
    return "Marked as not a transfer. Both sides now count as income or spending.";
  }, txPaths(id.data));
}

// ---------------------------------------------------------------------------
// Manual entry
// ---------------------------------------------------------------------------

const manualSchema = z.object({
  accountId: idField,
  date: isoDateField,
  description: text(200, "Description"),
  amount: money(),
  direction: z.enum(["out", "in"]),
  categoryId: optionalId,
});

export async function addManualTransactionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = manualSchema.safeParse(formObject(formData));
  if (!parsed.success) return failure(firstError(parsed.error));
  const v = parsed.data;
  let id = "";
  const result = await runAction(async ({ repo }) => {
    id = await repo.addManualTransaction({
      accountId: v.accountId,
      date: v.date,
      description: v.description,
      amountMinor: v.direction === "out" ? -v.amount : v.amount,
      categoryId: v.categoryId,
    });
    await repo.audit("transaction.created_manual", "transaction", id);
    return "Transaction added.";
  }, txPaths());
  if (result.ok) redirect(`/transactions/${id}`);
  return result;
}

const categorySchema = z.object({
  name: text(60, "Category name"),
  kind: z.enum(["expense", "income"]),
  isEssential: checkbox,
});

export async function createCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = categorySchema.safeParse(formObject(formData, ["isEssential"]));
  if (!parsed.success) return failure(firstError(parsed.error));
  return runAction(async ({ repo }) => {
    await repo.createCategory(parsed.data);
    return `Category "${parsed.data.name}" created.`;
  }, ["/transactions", "/budget"]);
}

// ---------------------------------------------------------------------------
// CSV import (preview, then confirm; the server re-parses on confirm)
// ---------------------------------------------------------------------------

export interface ImportState extends ActionState {
  preview: (Omit<ImportPreview, "rows"> & { rows: ImportPreview["rows"] }) | null;
  csvText: string | null;
  accountId: string | null;
  signConvention: SignConvention;
}

const importSchema = z.object({
  accountId: idField,
  signConvention: z.enum(["negative_is_outflow", "positive_is_outflow"]),
});

async function readCsv(formData: FormData): Promise<string> {
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_CSV_BYTES) throw new CsvError("File is larger than 1 MB.");
    return file.text();
  }
  const pasted = formData.get("csvText");
  if (typeof pasted === "string" && pasted.trim()) {
    if (pasted.length > MAX_CSV_BYTES) throw new CsvError("File is larger than 1 MB.");
    return pasted;
  }
  throw new CsvError("Choose a CSV file to import.");
}

export async function previewImportAction(prev: ImportState, formData: FormData): Promise<ImportState> {
  const parsed = importSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ...prev, ...failure("Choose an account and sign convention."), preview: null };
  let csvText = "";
  try {
    csvText = await readCsv(formData);
  } catch (e) {
    return { ...prev, ...failure(e instanceof CsvError ? e.message : "Couldn't read that file."), preview: null };
  }
  let preview: ImportState["preview"] = null;
  const result = await runAction(async ({ repo, now }) => {
    const data = await repo.getFinancialData(now);
    const account = data.accounts.find((a) => a.id === parsed.data.accountId);
    if (!account) return failure("Account not found.");
    try {
      preview = buildImportPreview({
        text: csvText,
        accountId: account.id,
        currency: account.currency,
        signConvention: parsed.data.signConvention,
        existing: data.transactions,
      });
    } catch (e) {
      if (e instanceof CsvError) return failure(e.message);
      throw e;
    }
    return success("Preview ready.");
  });
  return {
    ...result,
    preview,
    csvText: preview ? csvText : null,
    accountId: parsed.data.accountId,
    signConvention: parsed.data.signConvention,
  };
}

const confirmSchema = importSchema.extend({
  csvText: z.string().min(1).max(MAX_CSV_BYTES),
  includePossibleDuplicates: checkbox,
  categoryId: optionalId,
});

export async function confirmImportAction(prev: ImportState, formData: FormData): Promise<ImportState> {
  const parsed = confirmSchema.safeParse(formObject(formData, ["includePossibleDuplicates"]));
  if (!parsed.success) return { ...prev, ...failure("The import expired. Upload the file again.") };
  const v = parsed.data;
  let imported = 0;
  let linked = 0;
  const result = await runAction(async ({ repo, now }) => {
    const data = await repo.getFinancialData(now);
    const account = data.accounts.find((a) => a.id === v.accountId);
    if (!account) return failure("Account not found.");
    // Never trust rows from the browser: rebuild the preview from the file text.
    let preview: ImportPreview;
    try {
      preview = buildImportPreview({
        text: v.csvText,
        accountId: account.id,
        currency: account.currency,
        signConvention: v.signConvention,
        existing: data.transactions,
      });
    } catch (e) {
      if (e instanceof CsvError) return failure(e.message);
      throw e;
    }
    const rows = preview.rows
      .filter((r) => !r.alreadyImported && (v.includePossibleDuplicates || !r.possibleDuplicateOf))
      .map((r) => ({ date: r.date, amountMinor: r.amountMinor, description: r.description, dedupeHash: r.dedupeHash, categoryId: v.categoryId }));
    imported = rows.length ? await repo.importTransactions(account.id, rows) : 0;
    linked = imported ? await linkDetectedTransfers(repo, now) : 0;
    await repo.audit("transaction.csv_imported", "account", account.id);
    return "Imported.";
  }, txPaths());
  if (result.ok) {
    redirect(`/transactions?account=${encodeURIComponent(v.accountId)}&imported=${imported}&linked=${linked}`);
  }
  return { ...prev, ...result };
}
