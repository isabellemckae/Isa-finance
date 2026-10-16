/**
 * Guards against invented numbers: every dollar amount in the CFO's answer must
 * appear in a tool result (or in the user's own message).
 */

const AMOUNT_RE = /-?\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|-?\$\s?\d+(?:\.\d{1,2})?/g;

/** Canonical key for an amount: absolute value in cents ("$1,200" and "$1,200.00" match). */
export function amountKey(text: string): string | null {
  const cleaned = text.replace(/[$,\s-]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return `${BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0") || "0")}`;
}

export function extractAmounts(text: string): string[] {
  return (text.match(AMOUNT_RE) ?? []).map((m) => m.trim());
}

/**
 * Collects every amount that appears in tool outputs (formatted strings) and in the
 * user's own messages (where bare numbers like "250" also count).
 */
export function allowedAmountKeys(toolOutputs: string[], userTexts: string[] = []): Set<string> {
  const keys = new Set<string>(["0"]);
  for (const source of [...toolOutputs, ...userTexts]) {
    for (const match of extractAmounts(source)) {
      const key = amountKey(match);
      if (!key) continue;
      keys.add(key);
      // Whole-dollar display of an amount that has cents ("$1,287" for "$1,286.54").
      const cents = BigInt(key);
      const rounded = ((cents + 50n) / 100n) * 100n;
      keys.add(rounded.toString());
    }
  }
  // Bare numbers in the user's messages ("can I afford 250?") count as given amounts.
  for (const text of userTexts) {
    for (const match of text.match(/\b\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\b|\b\d{1,7}(?:\.\d{1,2})?\b/g) ?? []) {
      const key = amountKey(match);
      if (key) keys.add(key);
    }
  }
  return keys;
}

export function findUnverifiedAmounts(answer: string, allowed: Set<string>): string[] {
  const out: string[] = [];
  for (const match of extractAmounts(answer)) {
    const key = amountKey(match);
    if (key && !allowed.has(key)) out.push(match);
  }
  return [...new Set(out)];
}
