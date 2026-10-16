import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirectPathFor, resolveAccess, type AccessDecision } from "./access";

/**
 * Data access layer: the authoritative authentication check.
 *
 * Every page, server action and route handler that touches financial data must
 * call `requireUser()` and pass the returned id down. Never take a user id from input.
 */

export interface SessionUser {
  id: string;
  email: string;
  mode: "supabase" | "demo";
}

const DEMO_USER: SessionUser = {
  id: "00000000-0000-4000-8000-000000000000",
  email: "demo@isa-finance.invalid",
  mode: "demo",
};

interface AccessState {
  decision: AccessDecision;
  user: SessionUser | null;
}

function asLevel(level: string | null | undefined): "aal1" | "aal2" | null {
  return level === "aal1" || level === "aal2" ? level : null;
}

/** Resolves the current request's access once per render (React `cache`). */
export const getAccessState = cache(async (): Promise<AccessState> => {
  const env = getEnv();
  if (env.AUTH_MODE === "demo") {
    return { decision: { kind: "allow" }, user: DEMO_USER };
  }

  const supabase = await createSupabaseServerClient();
  // getUser() validates the session with the Supabase Auth server (not just the cookie).
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const authUser = userError ? null : userData.user;
  let currentLevel: "aal1" | "aal2" | null = null;
  let nextLevel: "aal1" | "aal2" | null = null;
  if (authUser) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    currentLevel = asLevel(aal?.currentLevel);
    nextLevel = asLevel(aal?.nextLevel);
  }

  const decision = resolveAccess({
    user: authUser ? { id: authUser.id, email: authUser.email ?? null } : null,
    currentLevel,
    nextLevel,
    allowedEmail: env.ALLOWED_USER_EMAIL as string,
    requireMfa: env.REQUIRE_MFA,
  });
  return {
    decision,
    user: authUser ? { id: authUser.id, email: authUser.email ?? "", mode: "supabase" } : null,
  };
});

/** Requires a fully authorized user (allowlisted, MFA satisfied) or redirects. */
export async function requireUser(): Promise<SessionUser> {
  const { decision, user } = await getAccessState();
  const path = redirectPathFor(decision);
  if (path || !user) redirect(path ?? "/login");
  return user;
}

/**
 * For the MFA pages: requires a signed-in, allowlisted user whose only missing
 * step is the one this page handles.
 */
export async function requireMfaStep(step: "mfa-setup" | "mfa-verify"): Promise<SessionUser> {
  const { decision, user } = await getAccessState();
  if (decision.kind === step && user) return user;
  redirect(redirectPathFor(decision) ?? "/");
}
