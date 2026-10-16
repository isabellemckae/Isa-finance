import { addMinor } from "./money";
import type { Account, BalanceSnapshot, CurrencyCode, ISOTimestamp } from "./types";

/**
 * Balance aggregation (ARCHITECTURE.md §6.2).
 *
 * - Cash only ever comes from depository accounts.
 * - Credit "available" is available credit, reported separately, never cash.
 * - Missing and stale balances are surfaced, never silently treated as zero.
 * - Hidden accounts are excluded from lists in the UI but still count in totals.
 */

export const DEFAULT_STALE_AFTER_HOURS = 24;

export type BalanceFreshness = "fresh" | "stale" | "unavailable";

export interface AccountBalanceView {
  account: Account;
  snapshot: BalanceSnapshot | null;
  freshness: BalanceFreshness;
}

export interface BalanceSummary {
  currency: CurrencyCode;
  /** Σ current balance of depository accounts with a known balance. */
  totalCashMinor: number;
  /** Σ available balance where the institution provides it. */
  availableCash: {
    amountMinor: number;
    /** True when at least one depository account did not report an available balance. */
    isPartial: boolean;
    accountsWithoutAvailable: string[];
  };
  /** Σ amount owed on credit accounts. */
  creditCardDebtMinor: number;
  /** Σ credit limits where reported. Informational, never added to cash. */
  creditLimitMinor: number;
  /** Σ available credit where reported. Informational, never added to cash. */
  availableCreditMinor: number;
  /** Σ amount owed on loans. */
  loanDebtMinor: number;
  assetsMinor: number;
  liabilitiesMinor: number;
  netWorthMinor: number;
  /** Accounts whose latest balance is older than the staleness threshold. */
  staleAccountIds: string[];
  /** Accounts with no balance at all; excluded from every total above. */
  unavailableAccountIds: string[];
  /** Accounts whose connection needs attention (login required, error, revoked…). */
  unhealthyAccountIds: string[];
  /** Oldest balance timestamp that contributed to the totals. */
  oldestBalanceAt: ISOTimestamp | null;
  /** Accounts skipped because their currency differs from the summary currency. */
  otherCurrencyAccountIds: string[];
}

export function latestSnapshots(snapshots: readonly BalanceSnapshot[]): Map<string, BalanceSnapshot> {
  const latest = new Map<string, BalanceSnapshot>();
  for (const s of snapshots) {
    const prev = latest.get(s.accountId);
    if (!prev || s.asOf > prev.asOf) latest.set(s.accountId, s);
  }
  return latest;
}

export function balanceFreshness(
  snapshot: BalanceSnapshot | null,
  now: Date,
  staleAfterHours = DEFAULT_STALE_AFTER_HOURS,
): BalanceFreshness {
  if (!snapshot || snapshot.currentMinor === null) return "unavailable";
  const ageMs = now.getTime() - new Date(snapshot.asOf).getTime();
  return ageMs > staleAfterHours * 3_600_000 ? "stale" : "fresh";
}

export function isConnectionHealthy(account: Account): boolean {
  return account.connectionStatus === "active" || account.connectionStatus === "pending_expiration";
}

export function accountBalanceViews(
  accounts: readonly Account[],
  snapshots: readonly BalanceSnapshot[],
  now: Date,
  staleAfterHours = DEFAULT_STALE_AFTER_HOURS,
): AccountBalanceView[] {
  const latest = latestSnapshots(snapshots);
  return accounts.map((account) => {
    const snapshot = latest.get(account.id) ?? null;
    return { account, snapshot, freshness: balanceFreshness(snapshot, now, staleAfterHours) };
  });
}

export function summarizeBalances(
  accounts: readonly Account[],
  snapshots: readonly BalanceSnapshot[],
  options: { now: Date; currency: CurrencyCode; staleAfterHours?: number },
): BalanceSummary {
  const { now, currency } = options;
  const views = accountBalanceViews(accounts, snapshots, now, options.staleAfterHours);

  let totalCash = 0;
  let availableCash = 0;
  let creditDebt = 0;
  let creditLimit = 0;
  let availableCredit = 0;
  let loanDebt = 0;
  let otherAssets = 0;
  const accountsWithoutAvailable: string[] = [];
  const stale: string[] = [];
  const unavailable: string[] = [];
  const unhealthy: string[] = [];
  const otherCurrency: string[] = [];
  let oldest: ISOTimestamp | null = null;

  for (const { account, snapshot, freshness } of views) {
    if (!isConnectionHealthy(account)) unhealthy.push(account.id);
    if (account.currency !== currency) {
      otherCurrency.push(account.id);
      continue;
    }
    if (freshness === "unavailable" || !snapshot || snapshot.currentMinor === null) {
      unavailable.push(account.id);
      continue;
    }
    if (snapshot.currency !== currency) {
      otherCurrency.push(account.id);
      continue;
    }
    if (freshness === "stale") stale.push(account.id);
    if (oldest === null || snapshot.asOf < oldest) oldest = snapshot.asOf;

    const current = snapshot.currentMinor;
    switch (account.type) {
      case "depository":
        totalCash = addMinor(totalCash, current);
        if (snapshot.availableMinor === null) {
          accountsWithoutAvailable.push(account.id);
        } else {
          availableCash = addMinor(availableCash, snapshot.availableMinor);
        }
        break;
      case "credit":
        creditDebt = addMinor(creditDebt, current);
        if (snapshot.creditLimitMinor !== null) creditLimit = addMinor(creditLimit, snapshot.creditLimitMinor);
        if (snapshot.availableMinor !== null) availableCredit = addMinor(availableCredit, snapshot.availableMinor);
        break;
      case "loan":
        loanDebt = addMinor(loanDebt, current);
        break;
      case "investment":
        otherAssets = addMinor(otherAssets, current);
        break;
      case "other":
        // Unknown semantics: shown in lists, excluded from totals.
        break;
    }
  }

  const assets = addMinor(totalCash, otherAssets);
  const liabilities = addMinor(creditDebt, loanDebt);

  return {
    currency,
    totalCashMinor: totalCash,
    availableCash: {
      amountMinor: availableCash,
      isPartial: accountsWithoutAvailable.length > 0,
      accountsWithoutAvailable,
    },
    creditCardDebtMinor: creditDebt,
    creditLimitMinor: creditLimit,
    availableCreditMinor: availableCredit,
    loanDebtMinor: loanDebt,
    assetsMinor: assets,
    liabilitiesMinor: liabilities,
    netWorthMinor: assets - liabilities,
    staleAccountIds: stale,
    unavailableAccountIds: unavailable,
    unhealthyAccountIds: unhealthy,
    oldestBalanceAt: oldest,
    otherCurrencyAccountIds: otherCurrency,
  };
}
