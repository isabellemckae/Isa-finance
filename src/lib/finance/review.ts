import { detectTransfers } from "./transfers";
import { needsReview } from "./filters";
import type { EnrichedTransaction } from "./classification";
import type { FinancialData } from "./types";

/**
 * Transactions that need the user's attention: uncategorized spending, uncategorized
 * money in, transfers with no matching leg, and transfers with several possible matches.
 */
export function reviewQueue(data: FinancialData, enriched: readonly EnrichedTransaction[]) {
  const { ambiguous } = detectTransfers({
    transactions: data.transactions,
    accounts: data.accounts,
    categories: data.categories,
    overrides: data.overrides,
    existingLinks: data.transferLinks,
  });
  const ambiguousIds = new Set(ambiguous.flatMap((a) => [a.transactionId, ...a.candidateIds]));
  const ids = new Set(enriched.filter((t) => needsReview(t, ambiguousIds)).map((t) => t.id));
  return { ids, ambiguousIds };
}
