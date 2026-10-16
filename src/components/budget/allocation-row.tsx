import { Pencil } from "lucide-react";
import type { BudgetLine } from "@/lib/finance/budget";
import { minorToDecimalString } from "@/lib/finance/money";
import { percentFromBps } from "@/lib/format";
import { removeAllocationAction, setAllocationAction } from "@/lib/actions/budget";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import { Progress } from "@/components/ui/progress";
import { Field, MoneyInput, Select } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";

const STATUS: Record<BudgetLine["status"], { label: string; variant: "attention" | "info" | "neutral" | "positive" }> = {
  over: { label: "Over", variant: "attention" },
  near_limit: { label: "Almost there", variant: "info" },
  at_plan: { label: "On plan", variant: "positive" },
  on_track: { label: "On track", variant: "positive" },
  not_started: { label: "Not started", variant: "neutral" },
};

export function AllocationRow({ line, month, currency }: { line: BudgetLine; month: string; currency: string }) {
  const isMovement = line.kind === "savings" || line.kind === "debt";
  const status = STATUS[line.status];
  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span className="truncate">{line.name}</span>
          <Badge variant={status.variant}>{status.label}</Badge>
        </p>
        <p className="shrink-0 text-sm text-muted-foreground">
          <Money minor={line.actualMinor} currency={currency} className="font-medium text-foreground" />
          {" / "}
          <Money minor={line.plannedMinor} currency={currency} />
        </p>
      </div>
      <Progress
        className="mt-2"
        valueBps={line.usedBps}
        label={`${line.name}: ${percentFromBps(line.usedBps)} of plan ${isMovement ? "moved" : "spent"}`}
        tone={line.status === "over" ? "over" : line.status === "near_limit" ? "near" : "default"}
      />
      <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {line.remainingMinor >= 0 ? (
            <>
              <Money minor={line.remainingMinor} currency={currency} /> {isMovement ? "still to move" : "left"}
            </>
          ) : (
            <span className="text-attention">
              <Money minor={-line.remainingMinor} currency={currency} /> over plan
            </span>
          )}
          {line.pendingMinor > 0 && (
            <>
              {" · includes "}
              <Money minor={line.pendingMinor} currency={currency} /> pending
            </>
          )}
        </span>
        <details className="group relative">
          <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1 rounded-full px-2 font-medium text-accent-ink">
            <Pencil className="size-3.5" aria-hidden /> Edit<span className="sr-only"> {line.name}</span>
          </summary>
          <div className="absolute right-0 z-10 mt-1 w-72 space-y-3 rounded-2xl border border-border bg-surface p-4 text-sm text-foreground shadow-card">
            <ActionForm action={setAllocationAction} className="space-y-3">
              <input type="hidden" name="month" value={month} />
              <input type="hidden" name="categoryId" value={line.categoryId} />
              <Field label="Planned amount" htmlFor={`planned-${line.categoryId}`}>
                <MoneyInput id={`planned-${line.categoryId}`} name="planned" required defaultValue={minorToDecimalString(line.plannedMinor, currency)} />
              </Field>
              <Field label="Type" htmlFor={`kind-${line.categoryId}`}>
                <Select id={`kind-${line.categoryId}`} name="kind" defaultValue={line.kind}>
                  <option value="fixed">Fixed expense</option>
                  <option value="variable">Variable expense</option>
                  <option value="savings">Savings</option>
                  <option value="debt">Debt payment</option>
                </Select>
              </Field>
              <SubmitButton size="sm">Save</SubmitButton>
            </ActionForm>
            <ActionForm action={removeAllocationAction}>
              <input type="hidden" name="month" value={month} />
              <input type="hidden" name="categoryId" value={line.categoryId} />
              <SubmitButton size="sm" variant="ghost" pendingLabel="Removing…">
                Remove from plan
              </SubmitButton>
            </ActionForm>
          </div>
        </details>
      </div>
    </li>
  );
}
