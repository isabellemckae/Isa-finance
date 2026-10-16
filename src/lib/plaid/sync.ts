import { mapAccount, mapAll, mapBalance, mapTransaction, plaidRemovedSchema, type AccountRow, type BalanceRow, type TransactionRow } from "./mapping";
import { PlaidError, type PlaidGateway } from "./ports";

/**
 * `/transactions/sync` pagination (https://plaid.com/docs/transactions/sync-migration/).
 *
 * All pages are fetched into memory first and nothing is written until `has_more` is
 * false. If Plaid reports TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION, the buffer is
 * discarded and pagination restarts from the cursor we started with. The caller then
 * applies the whole result and the new cursor in one database transaction, so an
 * interrupted sync simply starts again from the last committed cursor.
 */

export const SYNC_PAGE_SIZE = 500;
export const MAX_SYNC_PAGES = 100;
export const MAX_SYNC_RESTARTS = 3;

export interface CollectedSync {
  cursorBefore: string | null;
  cursorAfter: string;
  accounts: AccountRow[];
  balances: BalanceRow[];
  added: TransactionRow[];
  modified: TransactionRow[];
  removed: string[];
  skipped: number;
  pages: number;
  restarts: number;
  updateStatus: string | null;
}

export async function collectTransactionsSync(input: {
  gateway: PlaidGateway;
  accessToken: string;
  cursor: string | null;
  now: Date;
  pageSize?: number;
  maxPages?: number;
  maxRestarts?: number;
}): Promise<CollectedSync> {
  const maxPages = input.maxPages ?? MAX_SYNC_PAGES;
  const maxRestarts = input.maxRestarts ?? MAX_SYNC_RESTARTS;

  for (let restarts = 0; ; restarts += 1) {
    // Latest operation per transaction id wins: a transaction added on page 1 and
    // removed on page 3 is removed; one added then modified keeps the modified version.
    const ops = new Map<string, { kind: "added" | "modified"; row: TransactionRow } | { kind: "removed" }>();
    let accountsRaw: unknown[] = [];
    let cursor = input.cursor;
    let skipped = 0;
    let pages = 0;
    let updateStatus: string | null = null;
    try {
      for (;;) {
        if (pages >= maxPages) throw new PlaidError("SYNC_PAGE_LIMIT", "INTERNAL");
        const page = await input.gateway.transactionsSync(input.accessToken, cursor, input.pageSize ?? SYNC_PAGE_SIZE);
        pages += 1;
        for (const kind of ["added", "modified"] as const) {
          const mapped = mapAll(page[kind], mapTransaction);
          skipped += mapped.skipped;
          for (const row of mapped.rows) ops.set(row.external_id, { kind, row });
        }
        for (const raw of page.removed) {
          const parsed = plaidRemovedSchema.safeParse(raw);
          if (parsed.success) ops.set(parsed.data.transaction_id, { kind: "removed" });
          else skipped += 1;
        }
        if (page.accounts.length) accountsRaw = page.accounts;
        updateStatus = page.updateStatus ?? updateStatus;
        cursor = page.nextCursor;
        if (!page.hasMore) break;
      }
    } catch (error) {
      if (error instanceof PlaidError && error.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && restarts < maxRestarts) {
        continue;
      }
      throw error;
    }

    const added: TransactionRow[] = [];
    const modified: TransactionRow[] = [];
    const removed: string[] = [];
    for (const [id, op] of ops) {
      if (op.kind === "removed") removed.push(id);
      else (op.kind === "added" ? added : modified).push(op.row);
    }
    const accounts = mapAll(accountsRaw, mapAccount);
    const balances = mapAll(accountsRaw, (raw) => mapBalance(raw, input.now));
    return {
      cursorBefore: input.cursor,
      cursorAfter: cursor ?? "",
      accounts: accounts.rows,
      balances: balances.rows,
      added,
      modified,
      removed,
      skipped: skipped + accounts.skipped,
      pages,
      restarts,
      updateStatus,
    };
  }
}
