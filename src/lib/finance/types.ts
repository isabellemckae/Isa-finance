/**
 * Domain types shared by the finance services, the data repositories and the UI.
 *
 * Money is always an integer number of minor units (`*Minor`) plus a currency.
 * Sign convention: negative = money leaving the account, positive = money entering.
 * For credit accounts, a balance's `currentMinor` is the amount owed (positive = owed).
 */

/** ISO 4217 currency code, e.g. "USD". */
export type CurrencyCode = string;

/** Calendar date in `YYYY-MM-DD` form (no time zone). */
export type ISODate = string;

/** RFC 3339 timestamp, e.g. "2026-10-16T14:05:00.000Z". */
export type ISOTimestamp = string;

export type AccountType = "depository" | "credit" | "loan" | "investment" | "other";
export type DataSourceKind = "plaid" | "manual" | "csv";
export type ConnectionStatus =
  | "active"
  | "login_required"
  | "pending_expiration"
  | "revoked"
  | "error"
  | "disconnected";

export interface Account {
  id: string;
  name: string;
  nickname: string | null;
  institutionName: string;
  type: AccountType;
  subtype: string | null;
  /** Last 2–4 characters of the account number, never more. */
  mask: string | null;
  currency: CurrencyCode;
  source: DataSourceKind;
  connectionStatus: ConnectionStatus;
  lastSuccessfulSyncAt: ISOTimestamp | null;
  isHidden: boolean;
  isDemo: boolean;
}

export interface BalanceSnapshot {
  accountId: string;
  /** Ledger balance; for credit/loan accounts, the amount owed. Null = not provided. */
  currentMinor: number | null;
  /** Depository: spendable funds. Credit: available credit (never cash). Null = not provided. */
  availableMinor: number | null;
  creditLimitMinor: number | null;
  currency: CurrencyCode;
  asOf: ISOTimestamp;
}

export type CategoryKind = "expense" | "income" | "transfer";

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  isEssential: boolean;
  color: string | null;
}

export type TransactionStatus = "pending" | "posted";

/** Original transaction data as provided by the bank, import or manual entry. */
export interface Transaction {
  id: string;
  accountId: string;
  source: DataSourceKind;
  externalId: string;
  /** For posted transactions: the external id of the pending transaction it replaces. */
  pendingExternalId: string | null;
  status: TransactionStatus;
  amountMinor: number;
  currency: CurrencyCode;
  date: ISODate;
  description: string;
  merchantName: string | null;
  defaultCategoryId: string | null;
  /** CSV imports only: deterministic hash used to make re-imports idempotent. */
  dedupeHash: string | null;
  isRemoved: boolean;
  supersededBy: string | null;
}

/** User edits, stored separately from the original transaction. */
export interface TransactionOverride {
  transactionId: string;
  categoryId: string | null;
  merchantName: string | null;
  note: string | null;
  excludeFromBudget: boolean;
  transferOverride: "is_transfer" | "not_transfer" | null;
}

export type TransferKind = "transfer" | "credit_card_payment";

export interface TransferLink {
  outflowTransactionId: string;
  inflowTransactionId: string;
  kind: TransferKind;
  detectedBy: "rule" | "user";
}

export type BillCadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
export type IncomeCadence = "weekly" | "biweekly" | "semimonthly" | "monthly" | "irregular";

export interface RecurringBill {
  id: string;
  name: string;
  amountMinor: number;
  amountIsEstimate: boolean;
  currency: CurrencyCode;
  cadence: BillCadence;
  nextDueDate: ISODate;
  payFromAccountId: string | null;
  categoryId: string | null;
  autopay: boolean;
}

export interface IncomeSource {
  id: string;
  name: string;
  kind: "salary" | "freelance" | "benefits" | "other";
  /** Null when the amount is unknown (irregular income). */
  expectedAmountMinor: number | null;
  currency: CurrencyCode;
  cadence: IncomeCadence;
  nextExpectedDate: ISODate | null;
}

export type AllocationKind = "fixed" | "variable" | "savings" | "debt";

export interface BudgetAllocation {
  categoryId: string;
  kind: AllocationKind;
  plannedMinor: number;
}

export interface Budget {
  /** First day of the month. */
  month: ISODate;
  currency: CurrencyCode;
  allocations: BudgetAllocation[];
}

export interface SavingsGoal {
  id: string;
  name: string;
  targetMinor: number;
  savedMinor: number;
  monthlyContributionMinor: number;
  currency: CurrencyCode;
  targetDate: ISODate | null;
}

export interface DebtGoal {
  id: string;
  accountId: string | null;
  name: string;
  /** Annual percentage rate in basis points (22.99% = 2299). */
  aprBps: number;
  minimumPaymentMinor: number;
  plannedPaymentMinor: number;
  /** Day of month the payment is due, if known. */
  paymentDueDay: number | null;
}

export interface Profile {
  displayName: string | null;
  baseCurrency: CurrencyCode;
  timezone: string;
  safetyBufferMinor: number;
  includeExpectedIncome: boolean;
}

/** Everything the dashboard and finance services need for one user. */
export interface FinancialData {
  /** True when every record is fictional demonstration data. */
  isDemo: boolean;
  generatedAt: ISOTimestamp;
  profile: Profile;
  accounts: Account[];
  balances: BalanceSnapshot[];
  categories: Category[];
  transactions: Transaction[];
  overrides: TransactionOverride[];
  transferLinks: TransferLink[];
  budgets: Budget[];
  bills: RecurringBill[];
  incomeSources: IncomeSource[];
  savingsGoals: SavingsGoal[];
  debtGoals: DebtGoal[];
}
