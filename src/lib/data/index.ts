import "server-only";
import { getEnv } from "@/lib/env";
import type { SessionUser } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FinanceRepository } from "./repository";
import { DemoRepository } from "./demo/store";
import { SupabaseRepository } from "./supabase/repository";

/**
 * Returns the repository for the configured data source, bound to the signed-in user.
 * There is no silent fallback: a Supabase user is never shown demo data, and demo
 * mode never touches the database (config validation forbids demo auth + Supabase data).
 */
export async function getRepository(user: SessionUser): Promise<FinanceRepository> {
  const env = getEnv();
  if (env.DATA_SOURCE === "demo") return new DemoRepository();
  if (user.mode !== "supabase") throw new Error("Supabase data requires Supabase authentication.");
  return new SupabaseRepository(await createSupabaseServerClient(), user.id);
}
