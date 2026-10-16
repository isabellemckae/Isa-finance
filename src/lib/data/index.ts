import "server-only";
import { getEnv } from "@/lib/env";
import type { SessionUser } from "@/lib/auth/dal";
import type { FinanceRepository } from "./repository";
import { buildDemoData } from "./demo/dataset";

const demoRepository: FinanceRepository = {
  async getFinancialData(_user, now) {
    return buildDemoData(now);
  },
};

export class DataSourceNotReadyError extends Error {
  constructor() {
    super(
      "DATA_SOURCE=supabase is not implemented yet. The Supabase repository ships in Phase 2. " +
        "Use DATA_SOURCE=demo until then.",
    );
    this.name = "DataSourceNotReadyError";
  }
}

/** Returns the repository for the configured data source. No silent fallback to demo data. */
export function getRepository(user: SessionUser): FinanceRepository {
  const env = getEnv();
  if (env.DATA_SOURCE === "demo") return demoRepository;
  // Supabase users must never be shown fictional data by accident.
  void user;
  throw new DataSourceNotReadyError();
}
