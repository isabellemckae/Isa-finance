import Link from "next/link";
import { ArrowLeftRight, CircleAlert, EyeOff, StickyNote } from "lucide-react";
import type { EnrichedTransaction } from "@/lib/finance/classification";
import { formatDate } from "@/lib/finance/dates";
import type { Account } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { DataStatus } from "@/components/ui/data-status";
import { Money } from "@/components/ui/money";

export function flowLabel(tx: EnrichedTransaction): string {
  switch (tx.flow) {
    case "credit_card_payment":
      return "Card payment";
    case "transfer":
      return "Transfer";
    case "unmatched_transfer":
      return "Transfer (unmatched)";
    case "unclassified_inflow":
      return "Money in · uncategorized";
    default:
      return tx.category?.name ?? "Uncategorized";
  }
}

export function TransactionRow({
  tx,
  accountName,
  showDate = true,
  needsReview = false,
}: {
  tx: EnrichedTransaction;
  accountName?: string;
  showDate?: boolean;
  needsReview?: boolean;
}) {
  const isMovement = tx.flow === "transfer" || tx.flow === "credit_card_payment";
  return (
    <li>
      <Link
        href={`/transactions/${tx.id}`}
        className="flex items-center justify-between gap-3 rounded-2xl px-2 py-3 transition-colors hover:bg-surface-muted sm:px-3"
      >
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium">
            <span className="truncate">{tx.displayMerchant}</span>
            {tx.note && <StickyNote className="size-3.5 shrink-0 text-subtle-foreground" aria-label="Has a note" />}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {flowLabel(tx)}
            {accountName && ` · ${accountName}`}
            {showDate && ` · ${formatDate(tx.date)}`}
          </p>
          {(needsReview || tx.flow === "excluded") && (
            <div className="mt-1 flex gap-1.5">
              {needsReview && (
                <Badge variant="attention">
                  <CircleAlert aria-hidden /> Review
                </Badge>
              )}
              {tx.flow === "excluded" && (
                <Badge variant="outline">
                  <EyeOff aria-hidden /> Not in budget
                </Badge>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn("flex items-center gap-1 text-sm font-medium", isMovement && "text-muted-foreground")}>
            {isMovement && <ArrowLeftRight className="size-3.5" aria-hidden />}
            <Money minor={tx.amountMinor} currency={tx.currency} options={{ signDisplay: "exceptZero" }} colorize={!isMovement} />
          </span>
          {tx.status === "pending" && <DataStatus kind="pending" />}
        </div>
      </Link>
    </li>
  );
}

export function TransactionList({
  transactions,
  accounts,
  showAccount = true,
  emptyLabel = "No transactions.",
  reviewIds,
}: {
  transactions: readonly EnrichedTransaction[];
  accounts: readonly Account[];
  showAccount?: boolean;
  emptyLabel?: string;
  reviewIds?: ReadonlySet<string>;
}) {
  if (transactions.length === 0) return <p className="px-1 text-sm text-muted-foreground">{emptyLabel}</p>;
  const names = new Map(accounts.map((a) => [a.id, a.nickname ?? a.name]));
  return (
    <ul className="divide-y divide-border">
      {transactions.map((tx) => (
        <TransactionRow
          key={tx.id}
          tx={tx}
          accountName={showAccount ? names.get(tx.accountId) : undefined}
          needsReview={reviewIds?.has(tx.id)}
        />
      ))}
    </ul>
  );
}
