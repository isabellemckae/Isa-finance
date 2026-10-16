import "server-only";
import { parseEnv, type AppEnv } from "./config";

/**
 * Validated server environment. Import only from server code. Secrets never reach
 * client bundles because this module is `server-only`.
 */

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  cached ??= parseEnv(process.env);
  return cached;
}
