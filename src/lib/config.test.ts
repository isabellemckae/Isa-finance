import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ConfigError, parseEnv, readAuthMode } from "./config";

const supabase = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  ALLOWED_USER_EMAIL: "owner@example.com",
};

function problems(source: Record<string, string>): string[] {
  try {
    parseEnv(source);
    return [];
  } catch (e) {
    if (e instanceof ConfigError) return e.problems;
    throw e;
  }
}

describe("parseEnv", () => {
  it("defaults to demo auth and demo data locally", () => {
    const env = parseEnv({ NODE_ENV: "development" });
    expect(env.AUTH_MODE).toBe("demo");
    expect(env.DATA_SOURCE).toBe("demo");
    expect(env.REQUIRE_MFA).toBe(true);
    expect(env.PLAID_ENV).toBe("sandbox");
  });

  it("defaults to Supabase auth in production and requires its settings", () => {
    expect(problems({ NODE_ENV: "production" })).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^NEXT_PUBLIC_SUPABASE_URL/),
        expect.stringMatching(/^ALLOWED_USER_EMAIL/),
      ]),
    );
    expect(parseEnv({ NODE_ENV: "production", ...supabase }).AUTH_MODE).toBe("supabase");
  });

  it("refuses demo auth in production", () => {
    expect(problems({ NODE_ENV: "production", AUTH_MODE: "demo", ...supabase })).toEqual([
      "AUTH_MODE: Demo authentication cannot be used in production.",
    ]);
  });

  it("refuses demo auth with real data", () => {
    expect(problems({ AUTH_MODE: "demo", DATA_SOURCE: "supabase" })[0]).toMatch(/^DATA_SOURCE/);
  });

  it("only allows the Plaid sandbox", () => {
    expect(problems({ PLAID_ENV: "production" })[0]).toMatch(/^PLAID_ENV/);
  });

  it("validates the encryption keyring without echoing values", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    expect(parseEnv({ TOKEN_ENCRYPTION_KEYS: `k1:${key}`, TOKEN_ENCRYPTION_ACTIVE_KEY_ID: "k1" }).TOKEN_ENCRYPTION_KEYS).toBe(
      `k1:${key}`,
    );
    const errors = problems({ TOKEN_ENCRYPTION_KEYS: "k1:not-a-real-key-secret", TOKEN_ENCRYPTION_ACTIVE_KEY_ID: "k2" });
    expect(errors).toHaveLength(2);
    expect(errors.join(" ")).not.toContain("not-a-real-key-secret");
  });

  it("parses boolean flags", () => {
    expect(parseEnv({ REQUIRE_MFA: "false" }).REQUIRE_MFA).toBe(false);
    expect(problems({ REQUIRE_MFA: "yes" })[0]).toMatch(/^REQUIRE_MFA/);
  });
});

describe(".env.example", () => {
  it("parses as a valid local configuration", () => {
    const text = readFileSync(path.resolve(__dirname, "../../.env.example"), "utf8");
    const vars = Object.fromEntries(
      text
        .split("\n")
        .filter((line) => /^[A-Z_]+=/.test(line))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
    expect(parseEnv({ NODE_ENV: "development", ...vars }).AUTH_MODE).toBe("demo");
  });
});

describe("readAuthMode", () => {
  it("never reports demo mode in production", () => {
    expect(readAuthMode({ NODE_ENV: "production", AUTH_MODE: "demo" })).toBe("supabase");
    expect(readAuthMode({ NODE_ENV: "development" })).toBe("demo");
    expect(readAuthMode({ NODE_ENV: "development", AUTH_MODE: "supabase" })).toBe("supabase");
  });
});
