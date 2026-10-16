import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, needsReencryption, parseKeyring, planReencryption, TokenCryptoError } from "./token-crypto";

const k = () => randomBytes(32).toString("base64");
const binding = { connectionId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222" };
const TOKEN = "access-sandbox-12345678-aaaa-bbbb-cccc-1234567890ab";

describe("token encryption", () => {
  const k1 = k();
  const k2 = k();
  const ring1 = parseKeyring(`k1:${k1}`, "k1");
  const ring2 = parseKeyring(`k2:${k2},k1:${k1}`, "k2");

  it("round-trips and never contains the plaintext", () => {
    const enc = encryptToken(TOKEN, binding, ring1);
    expect(enc.keyId).toBe("k1");
    expect(enc.ciphertext).not.toContain("access-sandbox");
    expect(decryptToken(enc.ciphertext, binding, ring1)).toBe(TOKEN);
  });

  it("uses a fresh IV for every encryption", () => {
    expect(encryptToken(TOKEN, binding, ring1).ciphertext).not.toBe(encryptToken(TOKEN, binding, ring1).ciphertext);
  });

  it("detects tampering", () => {
    const { ciphertext } = encryptToken(TOKEN, binding, ring1);
    const parts = ciphertext.split(".");
    const body = Buffer.from(parts[3], "base64url");
    body[0] ^= 1;
    parts[3] = body.toString("base64url");
    expect(() => decryptToken(parts.join("."), binding, ring1)).toThrow(TokenCryptoError);
  });

  it("binds the ciphertext to its connection and user", () => {
    const { ciphertext } = encryptToken(TOKEN, binding, ring1);
    expect(() => decryptToken(ciphertext, { ...binding, userId: "33333333-3333-4333-8333-333333333333" }, ring1)).toThrow(
      "Token failed authentication.",
    );
    expect(() => decryptToken(ciphertext, { ...binding, connectionId: "44444444-4444-4444-8444-444444444444" }, ring1)).toThrow(
      TokenCryptoError,
    );
  });

  it("supports rotation: old ciphertexts still decrypt and new ones use the active key", () => {
    const old = encryptToken(TOKEN, binding, ring1);
    expect(decryptToken(old.ciphertext, binding, ring2)).toBe(TOKEN);
    expect(needsReencryption(old.ciphertext, ring2)).toBe(true);
    const fresh = encryptToken(TOKEN, binding, ring2);
    expect(fresh.keyId).toBe("k2");
    expect(needsReencryption(fresh.ciphertext, ring2)).toBe(false);
  });

  it("fails clearly when the key was removed", () => {
    const old = encryptToken(TOKEN, binding, ring1);
    expect(() => decryptToken(old.ciphertext, binding, parseKeyring(`k2:${k2}`, "k2"))).toThrow('Key "k1" is not in the keyring.');
  });

  it("validates the keyring without echoing key material", () => {
    expect(() => parseKeyring(undefined, "k1")).toThrow("not configured");
    expect(() => parseKeyring("k1:c2hvcnQ=", "k1")).toThrow('Key "k1" must be 32 bytes.');
    expect(() => parseKeyring(`k1:${k1}`, "k9")).toThrow("not in the keyring");
    expect(() => parseKeyring(`k1:${k1},k1:${k2}`, "k1")).toThrow("Duplicate");
    expect(() => parseKeyring(`BAD ID:${k1}`, "k1")).toThrow("Invalid key id");
    try {
      parseKeyring("k1:c2hvcnQ=", "k1");
    } catch (e) {
      expect(String(e)).not.toContain("c2hvcnQ");
    }
  });

  it("rejects malformed ciphertexts", () => {
    expect(() => decryptToken("plain-token", binding, ring1)).toThrow("Unrecognized");
    expect(() => decryptToken("v1.k1.AAAA.AAAA", binding, ring1)).toThrow("Malformed");
  });

  it("plans a rotation: re-encrypts old-key secrets, skips current ones, reports failures", () => {
    const old = encryptToken(TOKEN, binding, ring1);
    const current = encryptToken(TOKEN, { ...binding, connectionId: "55555555-5555-4555-8555-555555555555" }, ring2);
    const corrupt = { connectionId: "66666666-6666-4666-8666-666666666666", userId: binding.userId, ciphertext: old.ciphertext };
    const plan = planReencryption(
      [
        { ...binding, ciphertext: old.ciphertext },
        { connectionId: "55555555-5555-4555-8555-555555555555", userId: binding.userId, ciphertext: current.ciphertext },
        corrupt,
      ],
      ring2,
    );
    expect(plan.failed).toEqual([corrupt.connectionId]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({ connectionId: binding.connectionId, keyId: "k2", previousCiphertext: old.ciphertext });
    expect(decryptToken(plan.updates[0].ciphertext, binding, parseKeyring(`k2:${k2}`, "k2"))).toBe(TOKEN);
  });
});
