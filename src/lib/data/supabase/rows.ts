import { z } from "zod";
import type {
  Account,
  BalanceSnapshot,
  Budget,
  Category,
  DebtGoal,
  IncomeSource,
  Profile,
  RecurringBill,
  SavingsGoal,
  Transaction,
  TransactionOverride,
  TransferLink,
} from "@/lib/finance/types";

/**
 * Zod schemas for rows returned by Supabase (PostgREST), plus mapping to domain
 * types. Rows are validated at the boundary, so a schema drift fails loudly
 * instead of producing wrong numbers. Money arrives as JSON numbers (bigint
 * columns) and must be safe integers.
 */

const minor = z.number().int().refine(Number.isSafeInteger, "unsafe integer");
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().min(10);
const currency = z.string().regex(/^[A-Z]{3}$/);

export const profileRow = z.object({
  display_name: z.string().nullable(),
  base_currency: currency,
  timezone: z.string(),
  safety_buffer_minor: minor,
  include_expected_income: z.boolean(),
});

export const accountRow = z.object({
  id: uuid,
  name: z.string(),
  nickname: z.string().nullable(),
  type: z.enum(["depository", "credit", "loan", "investment", "other"]),
  subtype: z.string().nullable(),
  mask: z.string().nullable(),
  currency,
  source: z.enum(["plaid", "manual", "csv"]),
  is_hidden: z.boolean(),
  connection: z
    .object({
      status: z.enum(["active", "login_required", "pending_expiration", "revoked", "error", "disconnected"]),
      last_successful_sync_at: timestamp.nullable(),
      institution: z.object({ name: z.string() }).nullable(),
    })
    .nullable(),
});

export const balanceRow = z.object({
  account_id: uuid,
  current_minor: minor.nullable(),
  available_minor: minor.nullable(),
  credit_limit_minor: minor.nullable(),
  currency,
  as_of: timestamp,
});

export const categoryRow = z.object({
  id: uuid,
  name: z.string(),
  kind: z.enum(["expense", "income", "transfer"]),
  is_essential: z.boolean(),
  color: z.string().nullable(),
});

export const transactionRow = z.object({
  id: uuid,
  account_id: uuid,
  source: z.enum(["plaid", "manual", "csv"]),
  external_id: z.string(),
  pending_external_id: z.string().nullable(),
  status: z.enum(["pending", "posted"]),
  amount_minor: minor,
  currency,
  transaction_date: isoDate,
  description: z.string(),
  merchant_name: z.string().nullable(),
  default_category_id: uuid.nullable(),
  dedupe_hash: z.string().nullable(),
  is_removed: z.boolean(),
  superseded_by: uuid.nullable(),
});

export const overrideRow = z.object({
  transaction_id: uuid,
  category_id: uuid.nullable(),
  merchant_name: z.string().nullable(),
  note: z.string().nullable(),
  exclude_from_budget: z.boolean(),
  transfer_override: z.enum(["is_transfer", "not_transfer"]).nullable(),
});

export const transferLinkRow = z.object({
  outflow_transaction_id: uuid,
  inflow_transaction_id: uuid,
  kind: z.enum(["transfer", "credit_card_payment"]),
  detected_by: z.enum(["rule", "user"]),
});

export const budgetRow = z.object({
  month: isoDate,
  currency,
  budget_allocations: z.array(
    z.object({ category_id: uuid, kind: z.enum(["fixed", "variable", "savings", "debt"]), planned_minor: minor }),
  ),
});

export const billRow = z.object({
  id: uuid,
  name: z.string(),
  amount_minor: minor,
  amount_is_estimate: z.boolean(),
  currency,
  cadence: z.enum(["weekly", "biweekly", "monthly", "quarterly", "annual"]),
  next_due_date: isoDate,
  pay_from_account_id: uuid.nullable(),
  category_id: uuid.nullable(),
  autopay: z.boolean(),
});

export const incomeRow = z.object({
  id: uuid,
  name: z.string(),
  kind: z.enum(["salary", "freelance", "benefits", "other"]),
  expected_amount_minor: minor.nullable(),
  currency,
  cadence: z.enum(["weekly", "biweekly", "semimonthly", "monthly", "irregular"]),
  next_expected_date: isoDate.nullable(),
});

export const savingsGoalRow = z.object({
  id: uuid,
  name: z.string(),
  target_minor: minor,
  saved_minor: minor,
  monthly_contribution_minor: minor,
  currency,
  target_date: isoDate.nullable(),
});

export const debtGoalRow = z.object({
  id: uuid,
  account_id: uuid.nullable(),
  name: z.string(),
  apr_bps: z.number().int(),
  minimum_payment_minor: minor,
  planned_payment_minor: minor,
  payment_due_day: z.number().int().nullable(),
});

export const conversationRow = z.object({ id: uuid, title: z.string().nullable(), updated_at: timestamp });

export const conversationWithMessagesRow = conversationRow.extend({
  ai_messages: z.array(
    z.object({
      id: uuid,
      role: z.enum(["user", "assistant", "tool"]),
      content: z.string(),
      metadata: z.record(z.string(), z.unknown()),
      created_at: timestamp,
    }),
  ),
});

export const connectionRow = z.object({
  id: uuid,
  status: z.enum(["active", "login_required", "pending_expiration", "revoked", "error", "disconnected"]),
  last_successful_sync_at: timestamp.nullable(),
  last_sync_attempt_at: timestamp.nullable(),
  last_error_code: z.string().nullable(),
  institution: z.object({ name: z.string() }).nullable(),
  accounts: z.array(z.object({ count: z.number().int() })),
});

export const usageRow = z.object({ request_count: z.number().int(), input_tokens: z.number().int(), output_tokens: z.number().int() });

// Column lists kept next to the schemas so selects and validation stay in sync.
export const SELECT = {
  connection:
    "id, status, last_successful_sync_at, last_sync_attempt_at, last_error_code, institution:institutions(name), accounts(count)",
  profile: "display_name, base_currency, timezone, safety_buffer_minor, include_expected_income",
  account:
    "id, name, nickname, type, subtype, mask, currency, source, is_hidden, connection:bank_connections(status, last_successful_sync_at, institution:institutions(name))",
  balance: "account_id, current_minor, available_minor, credit_limit_minor, currency, as_of",
  category: "id, name, kind, is_essential, color",
  transaction:
    "id, account_id, source, external_id, pending_external_id, status, amount_minor, currency, transaction_date, description, merchant_name, default_category_id, dedupe_hash, is_removed, superseded_by",
  override: "transaction_id, category_id, merchant_name, note, exclude_from_budget, transfer_override",
  transferLink: "outflow_transaction_id, inflow_transaction_id, kind, detected_by",
  budget: "month, currency, budget_allocations(category_id, kind, planned_minor)",
  bill: "id, name, amount_minor, amount_is_estimate, currency, cadence, next_due_date, pay_from_account_id, category_id, autopay",
  income: "id, name, kind, expected_amount_minor, currency, cadence, next_expected_date",
  savingsGoal: "id, name, target_minor, saved_minor, monthly_contribution_minor, currency, target_date",
  debtGoal: "id, account_id, name, apr_bps, minimum_payment_minor, planned_payment_minor, payment_due_day",
} as const;

export const toProfile = (r: z.infer<typeof profileRow>): Profile => ({
  displayName: r.display_name,
  baseCurrency: r.base_currency,
  timezone: r.timezone,
  safetyBufferMinor: r.safety_buffer_minor,
  includeExpectedIncome: r.include_expected_income,
});

export const toAccount = (r: z.infer<typeof accountRow>): Account => ({
  id: r.id,
  name: r.name,
  nickname: r.nickname,
  institutionName: r.connection?.institution?.name ?? (r.source === "manual" ? "Manual account" : "Imported account"),
  type: r.type,
  subtype: r.subtype,
  mask: r.mask,
  currency: r.currency,
  source: r.source,
  // Manual and CSV accounts have no live connection to break.
  connectionStatus: r.connection?.status ?? "active",
  lastSuccessfulSyncAt: r.connection?.last_successful_sync_at ?? null,
  isHidden: r.is_hidden,
  isDemo: false,
});

export const toBalance = (r: z.infer<typeof balanceRow>): BalanceSnapshot => ({
  accountId: r.account_id,
  currentMinor: r.current_minor,
  availableMinor: r.available_minor,
  creditLimitMinor: r.credit_limit_minor,
  currency: r.currency,
  asOf: r.as_of,
});

export const toCategory = (r: z.infer<typeof categoryRow>): Category => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  isEssential: r.is_essential,
  color: r.color,
});

export const toTransaction = (r: z.infer<typeof transactionRow>): Transaction => ({
  id: r.id,
  accountId: r.account_id,
  source: r.source,
  externalId: r.external_id,
  pendingExternalId: r.pending_external_id,
  status: r.status,
  amountMinor: r.amount_minor,
  currency: r.currency,
  date: r.transaction_date,
  description: r.description,
  merchantName: r.merchant_name,
  defaultCategoryId: r.default_category_id,
  dedupeHash: r.dedupe_hash,
  isRemoved: r.is_removed,
  supersededBy: r.superseded_by,
});

export const toOverride = (r: z.infer<typeof overrideRow>): TransactionOverride => ({
  transactionId: r.transaction_id,
  categoryId: r.category_id,
  merchantName: r.merchant_name,
  note: r.note,
  excludeFromBudget: r.exclude_from_budget,
  transferOverride: r.transfer_override,
});

export const toTransferLink = (r: z.infer<typeof transferLinkRow>): TransferLink => ({
  outflowTransactionId: r.outflow_transaction_id,
  inflowTransactionId: r.inflow_transaction_id,
  kind: r.kind,
  detectedBy: r.detected_by,
});

export const toBudget = (r: z.infer<typeof budgetRow>): Budget => ({
  month: r.month,
  currency: r.currency,
  allocations: r.budget_allocations.map((a) => ({ categoryId: a.category_id, kind: a.kind, plannedMinor: a.planned_minor })),
});

export const toBill = (r: z.infer<typeof billRow>): RecurringBill => ({
  id: r.id,
  name: r.name,
  amountMinor: r.amount_minor,
  amountIsEstimate: r.amount_is_estimate,
  currency: r.currency,
  cadence: r.cadence,
  nextDueDate: r.next_due_date,
  payFromAccountId: r.pay_from_account_id,
  categoryId: r.category_id,
  autopay: r.autopay,
});

export const toIncome = (r: z.infer<typeof incomeRow>): IncomeSource => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  expectedAmountMinor: r.expected_amount_minor,
  currency: r.currency,
  cadence: r.cadence,
  nextExpectedDate: r.next_expected_date,
});

export const toSavingsGoal = (r: z.infer<typeof savingsGoalRow>): SavingsGoal => ({
  id: r.id,
  name: r.name,
  targetMinor: r.target_minor,
  savedMinor: r.saved_minor,
  monthlyContributionMinor: r.monthly_contribution_minor,
  currency: r.currency,
  targetDate: r.target_date,
});

export const toDebtGoal = (r: z.infer<typeof debtGoalRow>): DebtGoal => ({
  id: r.id,
  accountId: r.account_id,
  name: r.name,
  aprBps: r.apr_bps,
  minimumPaymentMinor: r.minimum_payment_minor,
  plannedPaymentMinor: r.planned_payment_minor,
  paymentDueDay: r.payment_due_day,
});
