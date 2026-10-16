import "server-only";
import { cache } from "react";
import { requireUser } from "@/lib/auth/dal";
import { enrichTransactions } from "@/lib/finance/classification";
import { todayInTimeZone } from "@/lib/finance/dates";
import { getRepository } from "./index";

/**
 * Loads everything a page needs for the signed-in user, once per request.
 * Authorization happens here (requireUser) before any data is read.
 */
export const loadPageData = cache(async () => {
  const user = await requireUser();
  const repo = await getRepository(user);
  const now = new Date();
  const data = await repo.getFinancialData(now);
  const transactions = enrichTransactions(data);
  return {
    user,
    repo,
    now,
    data,
    transactions,
    asOf: todayInTimeZone(data.profile.timezone, now),
    currency: data.profile.baseCurrency,
    isDemo: data.isDemo,
  };
});
