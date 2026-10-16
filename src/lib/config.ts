import { z } from "zod";

/**
 * Environment configuration schema. Pure (no `server-only`), so it can be unit tested
 * and used by `proxy.ts`. Application code reads secrets through `src/lib/env.ts`.
 *
 * Nothing here ever logs values; errors only name the offending variables.
 */

const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const booleanFlag = (defaultValue: boolean) =>
  z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((v) => (v === undefined || v === "" ? defaultValue : v === "true" || v === "1"));

const keyringEntry = /^[a-z0-9_-]{1,32}:[A-Za-z0-9+/]{43}=$/;

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    AUTH_MODE: z.enum(["supabase", "demo"]).optional(),
    DATA_SOURCE: z.enum(["demo", "supabase"]).default("demo"),

    NEXT_PUBLIC_SUPABASE_URL: optionalString.pipe(z.url().optional()),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalString,
    SUPABASE_SECRET_KEY: optionalString,
    ALLOWED_USER_EMAIL: optionalString.pipe(z.email().optional()),
    REQUIRE_MFA: booleanFlag(true),

    OPENAI_API_KEY: optionalString,
    OPENAI_MODEL: optionalString,

    PLAID_CLIENT_ID: optionalString,
    PLAID_SECRET: optionalString,
    PLAID_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
    PLAID_WEBHOOK_URL: optionalString.pipe(z.url().optional()),

    TOKEN_ENCRYPTION_KEYS: optionalString,
    TOKEN_ENCRYPTION_ACTIVE_KEY_ID: optionalString,
  })
  .transform((env) => ({
    ...env,
    // Demo auth is the local default; production always uses Supabase.
    AUTH_MODE: env.AUTH_MODE ?? (env.NODE_ENV === "production" ? "supabase" : "demo"),
  }))
  .superRefine((env, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });

    if (env.AUTH_MODE === "demo" && env.NODE_ENV === "production") {
      issue("AUTH_MODE", "Demo authentication cannot be used in production.");
    }
    if (env.AUTH_MODE === "demo" && env.DATA_SOURCE !== "demo") {
      issue("DATA_SOURCE", "Demo authentication may only serve the fictional demo dataset.");
    }
    if (env.AUTH_MODE === "supabase") {
      if (!env.NEXT_PUBLIC_SUPABASE_URL) issue("NEXT_PUBLIC_SUPABASE_URL", "Required when AUTH_MODE=supabase.");
      if (!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
        issue("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "Required when AUTH_MODE=supabase.");
      if (!env.ALLOWED_USER_EMAIL) issue("ALLOWED_USER_EMAIL", "Required when AUTH_MODE=supabase (single-user app).");
    }
    if (env.PLAID_ENV !== "sandbox") {
      issue("PLAID_ENV", "Only the Plaid sandbox is allowed until the Phase 5 security review.");
    }
    if (env.TOKEN_ENCRYPTION_KEYS) {
      const entries = env.TOKEN_ENCRYPTION_KEYS.split(",").map((s) => s.trim());
      if (!entries.every((e) => keyringEntry.test(e))) {
        issue("TOKEN_ENCRYPTION_KEYS", "Expected comma-separated `id:<base64 32-byte key>` entries.");
      }
      const ids = entries.map((e) => e.split(":")[0]);
      if (!env.TOKEN_ENCRYPTION_ACTIVE_KEY_ID || !ids.includes(env.TOKEN_ENCRYPTION_ACTIVE_KEY_ID)) {
        issue("TOKEN_ENCRYPTION_ACTIVE_KEY_ID", "Must name one of the keys in TOKEN_ENCRYPTION_KEYS.");
      }
    }
  });

export type AppEnv = z.output<typeof envSchema>;

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

export function parseEnv(source: Record<string, string | undefined>): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Only variable names and messages, never values.
    throw new ConfigError(result.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`));
  }
  return result.data;
}

/**
 * Minimal, non-throwing read for the proxy, which must not crash on every request.
 * Full validation happens in `env.ts` on the server.
 */
export function readAuthMode(source: Record<string, string | undefined>): "supabase" | "demo" {
  if (source.AUTH_MODE === "supabase" || source.AUTH_MODE === "demo") {
    return source.AUTH_MODE === "demo" && source.NODE_ENV === "production" ? "supabase" : source.AUTH_MODE;
  }
  return source.NODE_ENV === "production" ? "supabase" : "demo";
}
