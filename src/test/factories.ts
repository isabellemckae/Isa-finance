import type {
  Account,
  BalanceSnapshot,
  Category,
  RecurringBill,
  Transaction,
  TransactionOverride,
} from "@/lib/finance/types";

/** Small builders for unit tests. All data is fictional. */

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

export function account(overrides: Partial<Account> = {}): Account {
  return {
    id: nextId("acct"),
    name: "Test Checking",
    nickname: null,
    institutionName: "Fictional Bank",
    type: "depository",
    subtype: "checking",
    mask: "0001",
    currency: "USD",
    source: "plaid",
    connectionStatus: "active",
    lastSuccessfulSyncAt: "2026-10-16T12:00:00.000Z",
    isHidden: false,
    isDemo: true,
    ...overrides,
  };
}

export function balance(accountId: string, overrides: Partial<BalanceSnapshot> = {}): BalanceSnapshot {
  return {
    accountId,
    currentMinor: 0,
    availableMinor: null,
    creditLimitMinor: null,
    currency: "USD",
    asOf: "2026-10-16T12:00:00.000Z",
    ...overrides,
  };
}

export function category(overrides: Partial<Category> = {}): Category {
  return {
    id: nextId("cat"),
    name: "Groceries",
    kind: "expense",
    isEssential: true,
    color: null,
    ...overrides,
  };
}

export function tx(accountId: string, overrides: Partial<Transaction> = {}): Transaction {
  const id = overrides.id ?? nextId("tx");
  return {
    id,
    accountId,
    source: "plaid",
    externalId: `ext-${id}`,
    pendingExternalId: null,
    status: "posted",
    amountMinor: -1000,
    currency: "USD",
    date: "2026-10-10",
    description: "Purchase",
    merchantName: null,
    defaultCategoryId: null,
    dedupeHash: null,
    isRemoved: false,
    supersededBy: null,
    ...overrides,
  };
}

export function override(transactionId: string, overrides: Partial<TransactionOverride> = {}): TransactionOverride {
  return {
    transactionId,
    categoryId: null,
    merchantName: null,
    note: null,
    excludeFromBudget: false,
    transferOverride: null,
    ...overrides,
  };
}

export function bill(overrides: Partial<RecurringBill> = {}): RecurringBill {
  return {
    id: nextId("bill"),
    name: "Rent",
    amountMinor: 150_000,
    amountIsEstimate: false,
    currency: "USD",
    cadence: "monthly",
    nextDueDate: "2026-11-01",
    payFromAccountId: null,
    categoryId: null,
    autopay: false,
    ...overrides,
  };
}
