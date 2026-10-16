import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex, verifyPlaidWebhook, type PlaidJwk } from "./webhook-verify";

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  return { privateKey, jwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, expired_at: null } as PlaidJwk };
}

function jwt(privateKey: KeyObject, claims: Record<string, unknown>, header: Record<string, unknown> = {}) {
  const h = b64({ alg: "ES256", kid: "kid-1", typ: "JWT", ...header });
  const c = b64(claims);
  const sig = sign("sha256", Buffer.from(`${h}.${c}`), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${h}.${c}.${sig.toString("base64url")}`;
}

const now = new Date("2026-10-16T18:00:00Z");
const iat = Math.floor(now.getTime() / 1000);
const body = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-1" }, null, 2);

describe("verifyPlaidWebhook", () => {
  const { privateKey, jwk } = keyPair();
  const getKey = async (kid: string) => (kid === "kid-1" ? jwk : null);

  it("accepts a correctly signed, fresh webhook with a matching body", async () => {
    const header = jwt(privateKey, { iat, request_body_sha256: sha256Hex(body) });
    await expect(verifyPlaidWebhook({ rawBody: body, verificationHeader: header, getKey, now })).resolves.toEqual({
      bodySha256: sha256Hex(body),
      kid: "kid-1",
    });
  });

  it("rejects a missing or malformed header", async () => {
    await expect(verifyPlaidWebhook({ rawBody: body, verificationHeader: null, getKey, now })).rejects.toThrow("Missing");
    await expect(verifyPlaidWebhook({ rawBody: body, verificationHeader: "a.b", getKey, now })).rejects.toThrow("Malformed");
  });

  it("rejects other algorithms, including alg=none and HS256", async () => {
    for (const alg of ["none", "HS256", "RS256"]) {
      const header = jwt(privateKey, { iat, request_body_sha256: sha256Hex(body) }, { alg });
      await expect(verifyPlaidWebhook({ rawBody: body, verificationHeader: header, getKey, now })).rejects.toThrow("algorithm");
    }
  });

  it("rejects unknown and expired keys", async () => {
    const unknown = jwt(privateKey, { iat, request_body_sha256: sha256Hex(body) }, { kid: "other" });
    await expect(verifyPlaidWebhook({ rawBody: body, verificationHeader: unknown, getKey, now })).rejects.toThrow("Unknown");
    const header = jwt(privateKey, { iat, request_body_sha256: sha256Hex(body) });
    const expired = async () => ({ ...jwk, expired_at: iat - 10 });
    await expect(verifyPlaidWebhook({ rawBody: body, verificationHeader: header, getKey: expired, now })).rejects.toThrow("expired");
  });

  it("rejects a signature from a different key", async () => {
    const attacker = keyPair();
    const header = jwt(attacker.privateKey, { iat, request_body_sha256: sha256Hex(body) });
    await expect(verifyPlaidWebhook({ rawBody: body, verificationHeader: header, getKey, now })).rejects.toThrow("signature");
  });

  it("rejects a modified body", async () => {
    const header = jwt(privateKey, { iat, request_body_sha256: sha256Hex(body) });
    const tampered = body.replace("item-1", "item-2");
    await expect(verifyPlaidWebhook({ rawBody: tampered, verificationHeader: header, getKey, now })).rejects.toThrow("Body hash");
  });

  it("rejects replays older than five minutes and tokens from the future", async () => {
    const old = jwt(privateKey, { iat: iat - 301, request_body_sha256: sha256Hex(body) });
    await expect(verifyPlaidWebhook({ rawBody: body, verificationHeader: old, getKey, now })).rejects.toThrow("too old");
    const future = jwt(privateKey, { iat: iat + 600, request_body_sha256: sha256Hex(body) });
    await expect(verifyPlaidWebhook({ rawBody: body, verificationHeader: future, getKey, now })).rejects.toThrow("future");
  });

  it("rejects a token whose claims were swapped after signing", async () => {
    const header = jwt(privateKey, { iat, request_body_sha256: sha256Hex("other body") });
    const [h, , s] = header.split(".");
    const forged = `${h}.${b64({ iat, request_body_sha256: sha256Hex(body) })}.${s}`;
    await expect(verifyPlaidWebhook({ rawBody: body, verificationHeader: forged, getKey, now })).rejects.toThrow("signature");
  });
});
