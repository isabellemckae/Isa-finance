/**
 * Pure access policy. Decides what an incoming request may do, given what the
 * authentication layer verified. Unit tested in access.test.ts and used by the data
 * access layer (dal.ts). The proxy only does an optimistic pre-check.
 */

export type AccessDecision =
  | { kind: "allow" }
  | { kind: "login" }
  | { kind: "mfa-setup" }
  | { kind: "mfa-verify" }
  | { kind: "forbidden"; reason: "not-allowlisted" };

export interface AccessInput {
  /** User verified with the Auth server (null when there is no valid session). */
  user: { id: string; email: string | null } | null;
  /** Current session assurance level. */
  currentLevel: "aal1" | "aal2" | null;
  /** Highest level the user can reach with their enrolled, verified factors. */
  nextLevel: "aal1" | "aal2" | null;
  allowedEmail: string;
  requireMfa: boolean;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function resolveAccess(input: AccessInput): AccessDecision {
  if (!input.user) return { kind: "login" };
  if (!input.user.email || normalizeEmail(input.user.email) !== normalizeEmail(input.allowedEmail)) {
    return { kind: "forbidden", reason: "not-allowlisted" };
  }
  const hasVerifiedFactor = input.nextLevel === "aal2";
  if (hasVerifiedFactor && input.currentLevel !== "aal2") return { kind: "mfa-verify" };
  if (input.requireMfa && !hasVerifiedFactor) return { kind: "mfa-setup" };
  return { kind: "allow" };
}

/** Where to send the user for each non-allow decision. */
export function redirectPathFor(decision: AccessDecision): string | null {
  switch (decision.kind) {
    case "allow":
      return null;
    case "login":
      return "/login";
    case "mfa-setup":
      return "/mfa/setup";
    case "mfa-verify":
      return "/mfa/verify";
    case "forbidden":
      return "/login?error=forbidden";
  }
}

/** Only allow same-site relative paths as post-login destinations (no open redirects). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (/[\r\n]/.test(next)) return "/";
  return next;
}
