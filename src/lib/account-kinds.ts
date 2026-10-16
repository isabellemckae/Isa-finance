import type { Account } from "./finance/types";

/** Account kinds a user can create manually (type + subtype in one choice). */
export const MANUAL_ACCOUNT_KINDS = [
  { value: "depository:checking", label: "Checking", type: "depository", subtype: "checking" },
  { value: "depository:savings", label: "Savings", type: "depository", subtype: "savings" },
  { value: "depository:cash", label: "Cash", type: "depository", subtype: "cash" },
  { value: "credit:credit card", label: "Credit card", type: "credit", subtype: "credit card" },
  { value: "loan:loan", label: "Loan", type: "loan", subtype: "loan" },
  { value: "investment:brokerage", label: "Investment", type: "investment", subtype: "brokerage" },
] as const satisfies ReadonlyArray<{ value: string; label: string; type: Account["type"]; subtype: string }>;

export type AccountGroupKey = "cash" | "savings" | "credit" | "loan" | "investment" | "other";

export const ACCOUNT_GROUPS: Array<{ key: AccountGroupKey; label: string }> = [
  { key: "cash", label: "Checking & cash" },
  { key: "savings", label: "Savings" },
  { key: "credit", label: "Credit cards" },
  { key: "loan", label: "Loans" },
  { key: "investment", label: "Investments" },
  { key: "other", label: "Other" },
];

const SAVINGS_SUBTYPES = new Set(["savings", "money market", "cd", "hsa"]);

export function accountGroup(account: Pick<Account, "type" | "subtype">): AccountGroupKey {
  if (account.type === "depository") {
    return SAVINGS_SUBTYPES.has((account.subtype ?? "").toLowerCase()) ? "savings" : "cash";
  }
  return account.type;
}

export function accountTypeLabel(account: Pick<Account, "type" | "subtype">): string {
  const sub = account.subtype ? account.subtype[0].toUpperCase() + account.subtype.slice(1) : null;
  switch (account.type) {
    case "depository":
      return sub ?? "Deposit account";
    case "credit":
      return "Credit card";
    case "loan":
      return sub && sub !== "Loan" ? `${sub} loan` : "Loan";
    case "investment":
      return "Investment";
    default:
      return "Account";
  }
}
