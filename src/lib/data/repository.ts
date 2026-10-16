import "server-only";
import type { SessionUser } from "@/lib/auth/dal";
import type { FinancialData } from "@/lib/finance/types";

/**
 * Data source for one authenticated user. Implementations must scope every query to
 * `user.id`. The Supabase implementation additionally relies on Row Level Security.
 */
export interface FinanceRepository {
  getFinancialData(user: SessionUser, now: Date): Promise<FinancialData>;
}
