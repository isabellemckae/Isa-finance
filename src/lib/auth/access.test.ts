import { describe, expect, it } from "vitest";
import { redirectPathFor, resolveAccess, safeNextPath, type AccessInput } from "./access";

const owner = { id: "u1", email: "Owner@Example.com" };

function decide(overrides: Partial<AccessInput>) {
  return resolveAccess({
    user: owner,
    currentLevel: "aal2",
    nextLevel: "aal2",
    allowedEmail: "owner@example.com",
    requireMfa: true,
    ...overrides,
  }).kind;
}

describe("resolveAccess", () => {
  it("requires a session", () => {
    expect(decide({ user: null })).toBe("login");
  });

  it("only admits the allowlisted owner (case-insensitive)", () => {
    expect(decide({})).toBe("allow");
    expect(decide({ user: { id: "u2", email: "intruder@example.com" } })).toBe("forbidden");
    expect(decide({ user: { id: "u3", email: null } })).toBe("forbidden");
  });

  it("forces MFA enrollment when required", () => {
    expect(decide({ currentLevel: "aal1", nextLevel: "aal1" })).toBe("mfa-setup");
    expect(decide({ currentLevel: "aal1", nextLevel: "aal1", requireMfa: false })).toBe("allow");
  });

  it("forces a TOTP challenge whenever a factor exists, even if MFA is optional", () => {
    expect(decide({ currentLevel: "aal1", nextLevel: "aal2" })).toBe("mfa-verify");
    expect(decide({ currentLevel: "aal1", nextLevel: "aal2", requireMfa: false })).toBe("mfa-verify");
  });

  it("maps decisions to redirect paths", () => {
    expect(redirectPathFor({ kind: "allow" })).toBeNull();
    expect(redirectPathFor({ kind: "mfa-verify" })).toBe("/mfa/verify");
    expect(redirectPathFor({ kind: "forbidden", reason: "not-allowlisted" })).toBe("/login?error=forbidden");
  });
});

describe("safeNextPath", () => {
  it.each([
    ["/budget", "/budget"],
    ["/transactions?q=coffee", "/transactions?q=coffee"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["/ok\r\nSet-Cookie: x", "/"],
    [null, "/"],
  ])("%j → %j", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
