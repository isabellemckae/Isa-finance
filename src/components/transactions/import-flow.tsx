"use client";

import { useActionState } from "react";
import { AlertTriangle, CopyCheck, FileUp } from "lucide-react";
import { confirmImportAction, previewImportAction, type ImportState } from "@/lib/actions/transactions";
import { formatDate } from "@/lib/finance/dates";
import { formatMoney } from "@/lib/finance/money";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Field, Select, TextInput } from "@/components/ui/field";
import { FormStatusMessage, SubmitButton } from "@/components/forms/action-form";

const initial: ImportState = {
  ok: false,
  message: null,
  error: null,
  at: 0,
  preview: null,
  csvText: null,
  accountId: null,
  signConvention: "negative_is_outflow",
};

export function ImportFlow({
  accounts,
  categories,
  defaultAccountId,
}: {
  accounts: Array<{ id: string; label: string; currency: string }>;
  categories: Array<{ id: string; name: string }>;
  defaultAccountId: string | null;
}) {
  const [state, previewAction] = useActionState(previewImportAction, initial);
  const [confirmState, confirmAction] = useActionState(confirmImportAction, initial);
  const preview = state.preview;
  const currency = accounts.find((a) => a.id === state.accountId)?.currency ?? "USD";
  const fmt = (m: number) => formatMoney(m, currency, { signDisplay: "exceptZero" });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>1. Choose a file</CardTitle>
            <CardDescription>
              Export a CSV from your bank. It needs Date, Description and Amount (or Debit/Credit) columns. Max 1 MB.
            </CardDescription>
          </div>
          <FileUp className="size-5 text-accent-ink" aria-hidden />
        </CardHeader>
        <form action={previewAction} className="space-y-4">
          <Field label="Import into account" htmlFor="accountId">
            <Select id="accountId" name="accountId" required defaultValue={defaultAccountId ?? accounts[0]?.id}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="CSV file" htmlFor="file">
            <TextInput
              id="file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              required
              className="h-auto py-3 file:mr-3 file:rounded-full file:border-0 file:bg-blush file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blush-foreground"
            />
          </Field>
          <Field label="How does your bank show money going out?" htmlFor="signConvention">
            <Select id="signConvention" name="signConvention" defaultValue="negative_is_outflow">
              <option value="negative_is_outflow">As negative numbers (-45.00)</option>
              <option value="positive_is_outflow">As positive numbers (45.00)</option>
            </Select>
          </Field>
          <SubmitButton pendingLabel="Reading file…">Preview import</SubmitButton>
          <FormStatusMessage state={state.preview ? { ...state, message: null } : state} />
        </form>
      </Card>

      {preview && state.csvText && (
        <Card aria-labelledby="preview-title">
          <CardHeader>
            <div>
              <CardTitle id="preview-title">2. Review</CardTitle>
              <CardDescription>
                {preview.dateRange
                  ? `${formatDate(preview.dateRange.from)} – ${formatDate(preview.dateRange.to, { month: "short", day: "numeric", year: "numeric" })}`
                  : "No rows"}
              </CardDescription>
            </div>
          </CardHeader>

          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="New" value={String(preview.newCount)} />
            <Stat label="Already imported" value={String(preview.alreadyImportedCount)} />
            <Stat label="Possible duplicates" value={String(preview.possibleDuplicateCount)} />
            <Stat label="Net of new rows" value={fmt(preview.netMinor)} />
          </dl>

          {preview.errors.length > 0 && (
            <div className="mt-4 rounded-2xl bg-attention-soft px-4 py-3 text-sm text-attention">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="size-4" aria-hidden /> {preview.errors.length} row{preview.errors.length === 1 ? "" : "s"} couldn&apos;t be read and will be skipped
              </p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {preview.errors.slice(0, 5).map((e) => (
                  <li key={e.line}>
                    Line {e.line}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ul className="mt-4 max-h-96 divide-y divide-border overflow-y-auto rounded-2xl border border-border">
            {preview.rows.slice(0, 200).map((r) => (
              <li key={r.index} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{r.description}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {formatDate(r.date)}
                    {r.alreadyImported && <Badge variant="outline">Already imported</Badge>}
                    {r.possibleDuplicateOf && !r.alreadyImported && (
                      <Badge variant="attention">
                        <CopyCheck aria-hidden /> Possible duplicate
                      </Badge>
                    )}
                  </span>
                </span>
                <span className={r.alreadyImported ? "tabular text-subtle-foreground line-through" : "tabular"}>{fmt(r.amountMinor)}</span>
              </li>
            ))}
          </ul>
          {preview.rows.length > 200 && <p className="mt-2 text-xs text-muted-foreground">Showing the first 200 of {preview.rows.length} rows.</p>}

          <form action={confirmAction} className="mt-5 space-y-4">
            <input type="hidden" name="accountId" value={state.accountId ?? ""} />
            <input type="hidden" name="signConvention" value={state.signConvention} />
            <input type="hidden" name="csvText" value={state.csvText} />
            <Field label="Category for imported rows" htmlFor="categoryId" hint="Optional. You can recategorize individual transactions later.">
              <Select id="categoryId" name="categoryId" defaultValue="">
                <option value="">Leave uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            {preview.possibleDuplicateCount > 0 && (
              <Checkbox
                name="includePossibleDuplicates"
                label="Also import possible duplicates"
                description="They look like transactions already synced from your bank. Leave unchecked to skip them."
              />
            )}
            <SubmitButton disabled={preview.newCount === 0} pendingLabel="Importing…">
              {preview.newCount === 0 ? "Nothing new to import" : "Import transactions"}
            </SubmitButton>
            <FormStatusMessage state={confirmState} />
          </form>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-muted px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular font-medium">{value}</dd>
    </div>
  );
}
