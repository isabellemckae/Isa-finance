import { addDays, addMonths, compareDates, diffDays, startOfMonth, todayInTimeZone } from "@/lib/finance/dates";
import { occurrences } from "@/lib/finance/schedule";
import { detectTransfers } from "@/lib/finance/transfers";
import type {
  Account,
  BalanceSnapshot,
  Budget,
  Category,
  FinancialData,
  ISODate,
  RecurringBill,
  Transaction,
} from "@/lib/finance/types";

/**
 * FICTIONAL DEMONSTRATION DATA.
 *
 * Every institution, merchant, account and amount here is invented. Nothing is
 * derived from real accounts. The dataset is deterministic for a given date so
 * tests and screenshots are stable. Institutions are deliberately NOT real banks
 * (Discover and United Heritage Credit Union are only used once Plaid sandbox is wired).
 */

export const DEMO_TIMEZONE = "America/Chicago";

// ---------------------------------------------------------------------------
// Deterministic pseudo-random numbers (mulberry32 seeded from a string)
// ---------------------------------------------------------------------------

function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: string) {
  let a = seedFrom(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer cents in [min, max]. */
function cents(rand: () => number, min: number, max: number): number {
  return Math.round(min + rand() * (max - min));
}

// ---------------------------------------------------------------------------
// Static reference data
// ---------------------------------------------------------------------------

const CATEGORY_DEFS: Array<[string, Category["kind"], boolean]> = [
  ["Paycheck", "income", false],
  ["Other income", "income", false],
  ["Interest", "income", false],
  ["Refunds", "income", false],
  ["Transfer", "transfer", false],
  ["Credit card payment", "transfer", false],
  ["Savings", "transfer", false],
  ["Housing", "expense", true],
  ["Utilities", "expense", true],
  ["Groceries", "expense", true],
  ["Transportation", "expense", true],
  ["Insurance", "expense", true],
  ["Health", "expense", true],
  ["Dining", "expense", false],
  ["Shopping", "expense", false],
  ["Subscriptions", "expense", false],
  ["Personal care", "expense", false],
  ["Entertainment", "expense", false],
  ["Travel", "expense", false],
  ["Gifts & donations", "expense", false],
  ["Fees", "expense", false],
  ["Education", "expense", false],
  ["Uncategorized", "expense", false],
];

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const cat = (name: string) => `demo-cat-${slug(name)}`;

const CATEGORIES: Category[] = CATEGORY_DEFS.map(([name, kind, isEssential]) => ({
  id: cat(name),
  name,
  kind,
  isEssential,
  color: null,
}));

const ACCT = {
  checking: "demo-acct-juniper-checking",
  savings: "demo-acct-juniper-savings",
  card: "demo-acct-meadowlark-card",
  cuChecking: "demo-acct-cobblestone-checking",
  cash: "demo-acct-cash",
} as const;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildDemoData(now: Date): FinancialData {
  const today = todayInTimeZone(DEMO_TIMEZONE, now);
  const nowIso = now.toISOString();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

  const accounts: Account[] = [
    {
      id: ACCT.checking,
      name: "Everyday Checking",
      nickname: "Everyday",
      institutionName: "Juniper Federal Credit Union (fictional)",
      type: "depository",
      subtype: "checking",
      mask: "4821",
      currency: "USD",
      source: "plaid",
      connectionStatus: "active",
      lastSuccessfulSyncAt: hoursAgo(2),
      isHidden: false,
      isDemo: true,
    },
    {
      id: ACCT.savings,
      name: "High-Yield Savings",
      nickname: "Emergency fund",
      institutionName: "Juniper Federal Credit Union (fictional)",
      type: "depository",
      subtype: "savings",
      mask: "4839",
      currency: "USD",
      source: "plaid",
      connectionStatus: "active",
      lastSuccessfulSyncAt: hoursAgo(2),
      isHidden: false,
      isDemo: true,
    },
    {
      id: ACCT.card,
      name: "Rewards Visa",
      nickname: null,
      institutionName: "Meadowlark Card Services (fictional)",
      type: "credit",
      subtype: "credit card",
      mask: "7703",
      currency: "USD",
      source: "plaid",
      connectionStatus: "active",
      lastSuccessfulSyncAt: hoursAgo(3),
      isHidden: false,
      isDemo: true,
    },
    {
      id: ACCT.cuChecking,
      name: "Share Draft Checking",
      nickname: "Bills account",
      institutionName: "Cobblestone Community CU (fictional)",
      type: "depository",
      subtype: "checking",
      mask: "1190",
      currency: "USD",
      source: "plaid",
      // Demonstrates connection-health and stale-data handling.
      connectionStatus: "login_required",
      lastSuccessfulSyncAt: hoursAgo(52),
      isHidden: false,
      isDemo: true,
    },
    {
      id: ACCT.cash,
      name: "Cash envelope",
      nickname: null,
      institutionName: "Manual account",
      type: "depository",
      subtype: "cash",
      mask: null,
      currency: "USD",
      source: "manual",
      connectionStatus: "active",
      lastSuccessfulSyncAt: null,
      isHidden: false,
      isDemo: true,
    },
  ];

  const transactions = buildTransactions(today);

  const pendingCheckingOut = transactions
    .filter((t) => t.accountId === ACCT.checking && t.status === "pending")
    .reduce((s, t) => s + t.amountMinor, 0);
  const pendingCard = transactions
    .filter((t) => t.accountId === ACCT.card && t.status === "pending")
    .reduce((s, t) => s - t.amountMinor, 0);

  const balances: BalanceSnapshot[] = [
    { accountId: ACCT.checking, currentMinor: 384_217, availableMinor: 384_217 + pendingCheckingOut, creditLimitMinor: null, currency: "USD", asOf: hoursAgo(2) },
    { accountId: ACCT.savings, currentMinor: 946_000, availableMinor: 946_000, creditLimitMinor: null, currency: "USD", asOf: hoursAgo(2) },
    { accountId: ACCT.card, currentMinor: 128_654, availableMinor: 800_000 - 128_654 - pendingCard, creditLimitMinor: 800_000, currency: "USD", asOf: hoursAgo(3) },
    // This institution does not report an available balance, and the data is stale.
    { accountId: ACCT.cuChecking, currentMinor: 61_208, availableMinor: null, creditLimitMinor: null, currency: "USD", asOf: hoursAgo(52) },
    { accountId: ACCT.cash, currentMinor: 14_000, availableMinor: 14_000, creditLimitMinor: null, currency: "USD", asOf: hoursAgo(30 * 24) },
  ];

  const month = startOfMonth(today);
  const budgets: Budget[] = [-1, 0].map((offset) => ({
    month: addMonths(month, offset),
    currency: "USD",
    allocations: [
      { categoryId: cat("Housing"), kind: "fixed" as const, plannedMinor: 165_000 },
      { categoryId: cat("Utilities"), kind: "fixed" as const, plannedMinor: 16_000 },
      { categoryId: cat("Subscriptions"), kind: "fixed" as const, plannedMinor: 7_000 },
      { categoryId: cat("Insurance"), kind: "fixed" as const, plannedMinor: 1_800 },
      { categoryId: cat("Groceries"), kind: "variable" as const, plannedMinor: 55_000 },
      { categoryId: cat("Dining"), kind: "variable" as const, plannedMinor: 30_000 },
      { categoryId: cat("Transportation"), kind: "variable" as const, plannedMinor: 18_000 },
      { categoryId: cat("Shopping"), kind: "variable" as const, plannedMinor: 20_000 },
      { categoryId: cat("Entertainment"), kind: "variable" as const, plannedMinor: 10_000 },
      { categoryId: cat("Personal care"), kind: "variable" as const, plannedMinor: 8_000 },
      { categoryId: cat("Health"), kind: "variable" as const, plannedMinor: 6_000 },
      { categoryId: cat("Savings"), kind: "savings" as const, plannedMinor: 60_000 },
      { categoryId: cat("Credit card payment"), kind: "debt" as const, plannedMinor: 120_000 },
    ],
  }));

  const nextOn = (day: number): ISODate => {
    const thisMonth = `${today.slice(0, 8)}${String(day).padStart(2, "0")}`;
    return compareDates(thisMonth, today) >= 0 ? thisMonth : addMonths(thisMonth, 1, day);
  };

  const bills: RecurringBill[] = [
    bill("demo-bill-rent", "Rent: Larkspur Apartments", 165_000, false, nextOn(1), "Housing", false),
    bill("demo-bill-gym", "Pilates studio membership", 3_900, false, nextOn(3), "Subscriptions", true),
    bill("demo-bill-stream", "StreamBox", 1_599, false, nextOn(7), "Subscriptions", true),
    bill("demo-bill-power", "Prairie Light & Power", 12_000, true, nextOn(12), "Utilities", true),
    bill("demo-bill-phone", "Kestrel Mobile", 6_500, false, nextOn(18), "Utilities", true),
    bill("demo-bill-music", "Tunewell Music", 1_099, false, nextOn(22), "Subscriptions", true),
    bill("demo-bill-insurance", "Hearthstone renters insurance", 1_800, false, nextOn(27), "Insurance", true),
  ];

  return {
    isDemo: true,
    generatedAt: nowIso,
    profile: {
      displayName: "Isa",
      baseCurrency: "USD",
      timezone: DEMO_TIMEZONE,
      safetyBufferMinor: 25_000,
      includeExpectedIncome: false,
    },
    accounts,
    balances,
    categories: CATEGORIES,
    transactions,
    overrides: [
      {
        transactionId: transactions.find((t) => t.merchantName === "Saffron Table")?.id ?? "",
        categoryId: null,
        merchantName: null,
        note: "Birthday dinner with Maya",
        excludeFromBudget: false,
        transferOverride: null,
      },
    ].filter((o) => o.transactionId),
    transferLinks: detectTransfers({
      transactions,
      accounts,
      categories: CATEGORIES,
      overrides: [],
      existingLinks: [],
    }).links,
    budgets,
    bills,
    incomeSources: [
      {
        id: "demo-income-salary",
        name: "Lumen Studio salary",
        kind: "salary",
        expectedAmountMinor: 245_000,
        currency: "USD",
        cadence: "biweekly",
        nextExpectedDate: nextPayday(today),
      },
      {
        id: "demo-income-freelance",
        name: "Freelance design",
        kind: "freelance",
        expectedAmountMinor: null,
        currency: "USD",
        cadence: "irregular",
        nextExpectedDate: null,
      },
    ],
    savingsGoals: [
      {
        id: "demo-goal-emergency",
        name: "Emergency fund",
        targetMinor: 1_500_000,
        savedMinor: 946_000,
        monthlyContributionMinor: 60_000,
        currency: "USD",
        targetDate: addMonths(month, 12),
      },
      {
        id: "demo-goal-paris",
        name: "Paris in the spring",
        targetMinor: 400_000,
        savedMinor: 135_000,
        monthlyContributionMinor: 25_000,
        currency: "USD",
        targetDate: addMonths(month, 7),
      },
    ],
    debtGoals: [
      {
        id: "demo-debt-card",
        accountId: ACCT.card,
        name: "Rewards Visa",
        aprBps: 2399,
        minimumPaymentMinor: 4_000,
        plannedPaymentMinor: 60_000,
        paymentDueDay: 25,
      },
    ],
  };
}

function bill(
  id: string,
  name: string,
  amountMinor: number,
  amountIsEstimate: boolean,
  nextDueDate: ISODate,
  category: string,
  autopay: boolean,
): RecurringBill {
  return {
    id,
    name,
    amountMinor,
    amountIsEstimate,
    currency: "USD",
    cadence: "monthly",
    nextDueDate,
    payFromAccountId: ACCT.checking,
    categoryId: cat(category),
    autopay,
  };
}

/** Paydays are every other Friday, anchored to a fixed fictional Friday. */
const PAYDAY_ANCHOR = "2026-01-02";

function paydaysBetween(start: ISODate, end: ISODate): ISODate[] {
  return occurrences(PAYDAY_ANCHOR, "biweekly", start, end);
}

function nextPayday(today: ISODate): ISODate {
  return paydaysBetween(addDays(today, 1), addDays(today, 15))[0];
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

const GROCERS = ["Fern & Fig Market", "Bluebird Grocery Co.", "Harvest Lane Co-op"];
const DINING = ["Little Owl Coffee", "Saffron Table", "Northside Noodle Bar", "Copper Kettle Bakery", "Marigold Taqueria"];
const SHOPPING = ["Linen & Lace Boutique", "Paper Moon Stationery", "Hollow Oak Home"];
const TRANSPORT = ["Fuel Stop 24", "Metro Transit", "Wren Rideshare"];
const CARE = ["Willow Street Pharmacy", "Gilded Petal Salon"];
const FUN = ["Velvet Hour Cinema", "Starling Bookshop"];

function buildTransactions(today: ISODate): Transaction[] {
  const start = addMonths(startOfMonth(today), -5);
  const txs: Transaction[] = [];
  let seq = 0;

  const add = (
    accountId: string,
    date: ISODate,
    amountMinor: number,
    description: string,
    category: string | null,
    merchantName: string | null = description,
  ) => {
    seq += 1;
    const id = `demo-tx-${date}-${String(seq).padStart(4, "0")}`;
    // Card and checking activity from the last two days is still pending.
    const pending = diffDays(date, today) <= 1 && (accountId === ACCT.card || accountId === ACCT.checking) && amountMinor < 0 && category !== "Savings" && category !== "Credit card payment" && category !== "Housing";
    txs.push({
      id,
      accountId,
      source: accountId === ACCT.cash ? "manual" : "plaid",
      externalId: `demo-ext-${id}`,
      pendingExternalId: null,
      status: pending ? "pending" : "posted",
      amountMinor,
      currency: "USD",
      date,
      description,
      merchantName,
      defaultCategoryId: category ? cat(category) : null,
      isRemoved: false,
      supersededBy: null,
    });
  };

  for (let date = start; compareDates(date, today) <= 0; date = addDays(date, 1)) {
    const r = rng(`isa-demo-${date}`);
    const day = Number(date.slice(8, 10));
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();

    // Income
    if (paydaysBetween(date, date).length) {
      add(ACCT.checking, date, 245_000, "LUMEN STUDIO PAYROLL", "Paycheck", "Lumen Studio");
      add(ACCT.checking, date, -30_000, "Online transfer to savings 4839", "Savings", null);
      add(ACCT.savings, date, 30_000, "Transfer from checking 4821", "Savings", null);
    }
    if (day === 9) add(ACCT.checking, date, cents(r, 28_000, 52_000), "ODD BIRD DESIGN CO", "Other income", "Odd Bird Design Co.");
    if (day === 28) add(ACCT.savings, date, cents(r, 3_000, 3_400), "Dividend earned", "Interest", null);

    // Fixed bills
    if (day === 1) add(ACCT.checking, date, -165_000, "LARKSPUR APTS RENT", "Housing", "Larkspur Apartments");
    if (day === 3) add(ACCT.card, date, -3_900, "PILATES LOFT", "Subscriptions", "Pilates studio");
    if (day === 7) add(ACCT.card, date, -1_599, "STREAMBOX.TV", "Subscriptions", "StreamBox");
    if (day === 12) add(ACCT.checking, date, -cents(r, 9_800, 14_500), "PRAIRIE LIGHT POWER", "Utilities", "Prairie Light & Power");
    if (day === 18) add(ACCT.checking, date, -6_500, "KESTREL MOBILE", "Utilities", "Kestrel Mobile");
    if (day === 22) add(ACCT.card, date, -1_099, "TUNEWELL", "Subscriptions", "Tunewell Music");
    if (day === 27) add(ACCT.checking, date, -1_800, "HEARTHSTONE INS", "Insurance", "Hearthstone Insurance");

    // Credit card payment on the 25th
    if (day === 25) {
      const amount = 120_000;
      add(ACCT.checking, date, -amount, "MEADOWLARK CARD ONLINE PMT", "Credit card payment", null);
      add(ACCT.card, addDays(date, 1) <= today ? addDays(date, 1) : date, amount, "PAYMENT - THANK YOU", "Credit card payment", null);
    }

    // Everyday spending
    if (weekday === 0 || weekday === 3 || (weekday === 5 && r() < 0.5)) {
      add(ACCT.card, date, -cents(r, 3_800, 14_500), GROCERS[Math.floor(r() * GROCERS.length)], "Groceries");
    }
    if (r() < 0.45) {
      add(ACCT.card, date, -cents(r, 450, 6_800), DINING[Math.floor(r() * DINING.length)], "Dining");
    }
    if (r() < 0.18) add(ACCT.card, date, -cents(r, 1_800, 6_500), TRANSPORT[Math.floor(r() * TRANSPORT.length)], "Transportation");
    if (r() < 0.08) add(ACCT.card, date, -cents(r, 2_500, 11_000), SHOPPING[Math.floor(r() * SHOPPING.length)], "Shopping");
    if (r() < 0.06) add(ACCT.card, date, -cents(r, 1_200, 6_500), CARE[Math.floor(r() * CARE.length)], "Personal care");
    if (r() < 0.05) add(ACCT.card, date, -cents(r, 1_400, 4_200), FUN[Math.floor(r() * FUN.length)], "Entertainment");
    if (r() < 0.02) add(ACCT.card, date, cents(r, 1_500, 4_000), "Linen & Lace Boutique return", "Shopping", "Linen & Lace Boutique");
    if (day === 15 && r() < 0.7) add(ACCT.cash, date, -cents(r, 1_000, 3_000), "Farmers market", "Groceries", "Farmers market");
  }

  return txs;
}
