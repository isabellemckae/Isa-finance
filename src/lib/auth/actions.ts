"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { limiters } from "@/lib/security/rate-limit";
import { normalizeEmail, safeNextPath } from "./access";
import { getAccessState, requireMfaStep } from "./dal";

/**
 * Authentication server actions. Every input is validated with Zod. Errors are
 * generic to avoid revealing whether an account exists, and secrets are never logged.
 */

export interface FormState {
  error: string | null;
}

const GENERIC_SIGN_IN_ERROR = "Email or password is incorrect.";

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

function tooManyAttempts(retryAfterMs: number): FormState {
  const minutes = Math.ceil(retryAfterMs / 60_000);
  return { error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` };
}

const signInSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
  next: z.string().max(512).optional(),
});

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const env = getEnv();
  if (env.AUTH_MODE !== "supabase") return { error: "Sign-in is disabled in demo mode." };

  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { error: "Enter a valid email and password." };
  const email = normalizeEmail(parsed.data.email);

  const limit = limiters.login.check(`${await clientIp()}|${email}`);
  if (!limit.allowed) return tooManyAttempts(limit.retryAfterMs);
  const accountLimit = limiters.loginPerAccount.check(email);
  if (!accountLimit.allowed) return tooManyAttempts(accountLimit.retryAfterMs);

  // Single-user allowlist, checked before contacting the Auth server.
  if (email !== normalizeEmail(env.ALLOWED_USER_EMAIL as string)) return { error: GENERIC_SIGN_IN_ERROR };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });
  if (error) return { error: GENERIC_SIGN_IN_ERROR };

  await supabase.rpc("log_audit_event", { p_action: "auth.sign_in" });
  redirect(safeNextPath(parsed.data.next));
}

export async function signOut(): Promise<void> {
  const env = getEnv();
  if (env.AUTH_MODE === "supabase") {
    const supabase = await createSupabaseServerClient();
    const { user } = await getAccessState();
    if (user) await supabase.rpc("log_audit_event", { p_action: "auth.sign_out" });
    await supabase.auth.signOut();
  }
  redirect("/login");
}

// ---------------------------------------------------------------------------
// MFA (TOTP)
// ---------------------------------------------------------------------------

export interface EnrollmentState {
  error: string | null;
  factorId: string | null;
  /** SVG data URI from Supabase; rendered as an <img>. */
  qrCode: string | null;
  /** Shown once so the user can type it into an authenticator app manually. */
  secret: string | null;
}

export async function startTotpEnrollment(): Promise<EnrollmentState> {
  await requireMfaStep("mfa-setup");
  const supabase = await createSupabaseServerClient();

  // Remove abandoned, unverified factors so enrollment can be restarted.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.factor_type === "totp" && factor.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "ISA Finance" });
  if (error || !data) {
    return { error: "Could not start authenticator setup. Try again.", factorId: null, qrCode: null, secret: null };
  }
  return { error: null, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

const codeSchema = z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app.");

export async function confirmTotpEnrollment(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireMfaStep("mfa-setup");
  const factorId = z.string().uuid().safeParse(formData.get("factorId"));
  const code = codeSchema.safeParse(formData.get("code"));
  if (!factorId.success) return { error: "Setup expired. Reload the page to start again." };
  if (!code.success) return { error: code.error.issues[0].message };

  const limit = limiters.mfa.check(user.id);
  if (!limit.allowed) return tooManyAttempts(limit.retryAfterMs);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factorId.data, code: code.data });
  if (error) return { error: "That code didn't match. Check your device's clock and try again." };

  await supabase.rpc("log_audit_event", { p_action: "auth.mfa_enrolled" });
  redirect("/");
}

export async function verifyTotp(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireMfaStep("mfa-verify");
  const code = codeSchema.safeParse(formData.get("code"));
  if (!code.success) return { error: code.error.issues[0].message };

  const limit = limiters.mfa.check(user.id);
  if (!limit.allowed) return tooManyAttempts(limit.retryAfterMs);

  const supabase = await createSupabaseServerClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp.find((f) => f.status === "verified");
  if (!factor) redirect("/mfa/setup");

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.data });
  if (error) return { error: "That code didn't match. Try again." };

  await supabase.rpc("log_audit_event", { p_action: "auth.mfa_verified" });
  redirect("/");
}
