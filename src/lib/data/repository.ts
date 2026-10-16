import type {
  AccountType,
  AllocationKind,
  BalanceSnapshot,
  CategoryKind,
  DebtGoal,
  FinancialData,
  IncomeSource,
  ISODate,
  RecurringBill,
  SavingsGoal,
  TransactionOverride,
  TransferKind,
} from "@/lib/finance/types";

/**
 * Data access for ONE authenticated user. A repository instance is bound to a user
 * when it is created (see `getRepository`), so callers can never pass another user's
 * id. The Supabase implementation also relies on Row Level Security, and the demo
 * implementation only ever holds fictional data.
 *
 * Writes never modify bank-provided data: user edits go to overrides, links,
 * budgets, goals and manual records.
 */
export interface FinanceRepository {
  readonly kind: "demo" | "supabase";

  getFinancialData(now: Date): Promise<FinancialData>;
  getBalanceHistory(accountId: string): Promise<BalanceSnapshot[]>;

  // Accounts
  updateAccount(accountId: string, patch: { nickname?: string | null; isHidden?: boolean }): Promise<void>;
  createManualAccount(input: ManualAccountInput): Promise<string>;
  recordManualBalance(
    accountId: string,
    input: { currentMinor: number; creditLimitMinor: number | null },
    now: Date,
  ): Promise<void>;
  deleteManualAccount(accountId: string): Promise<void>;

  // Transactions
  saveOverride(override: TransactionOverride): Promise<void>;
  addManualTransaction(input: ManualTransactionInput): Promise<string>;
  importTransactions(accountId: string, rows: ImportRowInput[]): Promise<number>;
  linkTransfer(input: { outflowTransactionId: string; inflowTransactionId: string; kind: TransferKind }): Promise<void>;
  unlinkTransfer(transactionId: string): Promise<void>;
  createCategory(input: { name: string; kind: CategoryKind; isEssential: boolean }): Promise<string>;

  // Budget & planning
  setAllocation(month: ISODate, categoryId: string, kind: AllocationKind, plannedMinor: number): Promise<void>;
  removeAllocation(month: ISODate, categoryId: string): Promise<void>;
  copyBudget(fromMonth: ISODate, toMonth: ISODate): Promise<number>;
  saveBill(bill: Omit<RecurringBill, "id"> & { id?: string }): Promise<string>;
  deleteBill(id: string): Promise<void>;
  saveIncomeSource(source: Omit<IncomeSource, "id"> & { id?: string }): Promise<string>;
  deleteIncomeSource(id: string): Promise<void>;
  saveSavingsGoal(goal: Omit<SavingsGoal, "id"> & { id?: string }): Promise<string>;
  deleteSavingsGoal(id: string): Promise<void>;
  saveDebtGoal(goal: Omit<DebtGoal, "id"> & { id?: string }): Promise<string>;
  deleteDebtGoal(id: string): Promise<void>;
  updateProfile(patch: ProfilePatch): Promise<void>;

  /** Appends an audit event attributed to the user (no financial values in metadata). */
  audit(action: string, entityType: string, entityId: string | null): Promise<void>;
}

export interface ManualAccountInput {
  name: string;
  nickname: string | null;
  type: Extract<AccountType, "depository" | "credit" | "loan" | "investment">;
  subtype: string | null;
  currency: string;
  currentMinor: number;
  creditLimitMinor: number | null;
}

export interface ManualTransactionInput {
  accountId: string;
  date: ISODate;
  amountMinor: number;
  description: string;
  categoryId: string | null;
}

export interface ImportRowInput {
  date: ISODate;
  amountMinor: number;
  description: string;
  dedupeHash: string;
  categoryId: string | null;
}

export interface ProfilePatch {
  displayName?: string | null;
  timezone?: string;
  safetyBufferMinor?: number;
  includeExpectedIncome?: boolean;
}

/** Errors safe to show to the user. Never include financial data in messages. */
export class RepositoryError extends Error {
  constructor(
    public readonly code: "not_found" | "not_allowed" | "conflict" | "invalid" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}
