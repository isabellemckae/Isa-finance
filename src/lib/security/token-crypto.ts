import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for Plaid access tokens, with a rotating keyring.
 *
 * - Keys come from `TOKEN_ENCRYPTION_KEYS` ("id:base64,id:base64") and never touch the database.
 * - Each ciphertext records its key id, so old keys keep decrypting after rotation.
 * - Additional authenticated data binds a ciphertext to its connection and user: a token
 *   copied onto another row (or another user's row) fails to decrypt.
 *
 * Format: `v1.<keyId>.<base64url iv>.<base64url ciphertext+tag>`.
 */

export class TokenCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenCryptoError";
  }
}

export interface Keyring {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}

const KEY_ID = /^[a-z0-9_-]{1,32}$/;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function parseKeyring(keysValue: string | undefined, activeKeyId: string | undefined): Keyring {
  if (!keysValue || !activeKeyId) throw new TokenCryptoError("Token encryption keys are not configured.");
  const keys = new Map<string, Buffer>();
  for (const entry of keysValue.split(",").map((s) => s.trim()).filter(Boolean)) {
    const sep = entry.indexOf(":");
    const id = entry.slice(0, sep);
    const key = Buffer.from(entry.slice(sep + 1), "base64");
    // Messages name the key id only, never key material.
    if (sep < 1 || !KEY_ID.test(id)) throw new TokenCryptoError("Invalid key id in TOKEN_ENCRYPTION_KEYS.");
    if (key.length !== 32) throw new TokenCryptoError(`Key "${id}" must be 32 bytes.`);
    if (keys.has(id)) throw new TokenCryptoError(`Duplicate key id "${id}".`);
    keys.set(id, key);
  }
  if (!keys.has(activeKeyId)) throw new TokenCryptoError("TOKEN_ENCRYPTION_ACTIVE_KEY_ID is not in the keyring.");
  return { activeKeyId, keys };
}

function aad(binding: { connectionId: string; userId: string }): Buffer {
  return Buffer.from(`isa-finance:plaid-token:v1:${binding.connectionId}:${binding.userId}`, "utf8");
}

export interface EncryptedToken {
  keyId: string;
  ciphertext: string;
}

export function encryptToken(
  plaintext: string,
  binding: { connectionId: string; userId: string },
  keyring: Keyring,
): EncryptedToken {
  if (!plaintext) throw new TokenCryptoError("Nothing to encrypt.");
  const key = keyring.keys.get(keyring.activeKeyId)!;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(binding));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return {
    keyId: keyring.activeKeyId,
    ciphertext: ["v1", keyring.activeKeyId, iv.toString("base64url"), body.toString("base64url")].join("."),
  };
}

export function decryptToken(
  ciphertext: string,
  binding: { connectionId: string; userId: string },
  keyring: Keyring,
): string {
  const parts = ciphertext.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new TokenCryptoError("Unrecognized ciphertext format.");
  const [, keyId, ivText, bodyText] = parts;
  const key = keyring.keys.get(keyId);
  if (!key) throw new TokenCryptoError(`Key "${keyId}" is not in the keyring.`);
  const iv = Buffer.from(ivText, "base64url");
  const body = Buffer.from(bodyText, "base64url");
  if (iv.length !== IV_BYTES || body.length <= TAG_BYTES) throw new TokenCryptoError("Malformed ciphertext.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(binding));
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenCryptoError("Token failed authentication.");
  }
}

/** True when the ciphertext was written with a key other than the active one. */
export function needsReencryption(ciphertext: string, keyring: Keyring): boolean {
  return ciphertext.split(".")[1] !== keyring.activeKeyId;
}

export interface StoredSecret {
  connectionId: string;
  userId: string;
  ciphertext: string;
}

/**
 * Key rotation: re-encrypts every secret not written with the active key. Secrets
 * that fail to decrypt are reported (by connection id only) and left untouched.
 */
export function planReencryption(
  secrets: readonly StoredSecret[],
  keyring: Keyring,
): { updates: Array<StoredSecret & { keyId: string; previousCiphertext: string }>; failed: string[] } {
  const updates: Array<StoredSecret & { keyId: string; previousCiphertext: string }> = [];
  const failed: string[] = [];
  for (const s of secrets) {
    if (!needsReencryption(s.ciphertext, keyring)) continue;
    const binding = { connectionId: s.connectionId, userId: s.userId };
    try {
      const plaintext = decryptToken(s.ciphertext, binding, keyring);
      const next = encryptToken(plaintext, binding, keyring);
      updates.push({ ...s, ciphertext: next.ciphertext, keyId: next.keyId, previousCiphertext: s.ciphertext });
    } catch {
      failed.push(s.connectionId);
    }
  }
  return { updates, failed };
}
