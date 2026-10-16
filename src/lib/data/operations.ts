import { detectTransfers } from "@/lib/finance/transfers";
import { RepositoryError, type FinanceRepository } from "./repository";

/**
 * Multi-step operations shared by both repositories. They contain no storage logic
 * of their own; they combine repository calls with the deterministic services.
 */

/**
 * Runs transfer detection over current data and stores any new, unambiguous links.
 * Used after imports (and, in Phase 4, after each sync). Returns the number linked.
 */
export async function linkDetectedTransfers(repo: FinanceRepository, now: Date): Promise<number> {
  const data = await repo.getFinancialData(now);
  const { links } = detectTransfers({
    transactions: data.transactions,
    accounts: data.accounts,
    categories: data.categories,
    overrides: data.overrides,
    existingLinks: data.transferLinks,
  });
  let linked = 0;
  for (const link of links) {
    try {
      await repo.linkTransfer(link);
      linked += 1;
    } catch (e) {
      // A concurrent edit may have linked one side already; skip, don't fail the import.
      if (!(e instanceof RepositoryError && e.code === "conflict")) throw e;
    }
  }
  return linked;
}

/**
 * Marks a linked pair as "not a transfer" on both legs and removes the link, so the
 * rule-based detector will not re-link them.
 */
export async function rejectTransfer(repo: FinanceRepository, transactionId: string, now: Date): Promise<void> {
  const data = await repo.getFinancialData(now);
  const link = data.transferLinks.find(
    (l) => l.outflowTransactionId === transactionId || l.inflowTransactionId === transactionId,
  );
  if (!link) return;
  await repo.unlinkTransfer(transactionId);
  for (const id of [link.outflowTransactionId, link.inflowTransactionId]) {
    const existing = data.overrides.find((o) => o.transactionId === id);
    await repo.saveOverride({
      transactionId: id,
      categoryId: existing?.categoryId ?? null,
      merchantName: existing?.merchantName ?? null,
      note: existing?.note ?? null,
      excludeFromBudget: existing?.excludeFromBudget ?? false,
      transferOverride: "not_transfer",
    });
  }
}
