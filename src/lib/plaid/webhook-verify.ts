import { createHash, createPublicKey, timingSafeEqual, verify, type JsonWebKey } from "node:crypto";
import { z } from "zod";

/**
 * Verifies the `Plaid-Verification` header on incoming webhooks
 * (https://plaid.com/docs/api/webhooks/webhook-verification/):
 *
 * 1. The header is a JWT whose `alg` must be ES256 (anything else is rejected outright).
 * 2. The signing key is looked up by `kid` through Plaid's verification-key endpoint
 *    (`getKey`), and must not be expired.
 * 3. `iat` must be within five minutes, so captured webhooks can't be replayed later.
 * 4. `request_body_sha256` must equal the SHA-256 of the exact raw body received.
 */

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

export const plaidJwkSchema = z.object({
  kty: z.literal("EC"),
  crv: z.literal("P-256"),
  x: z.string().min(1),
  y: z.string().min(1),
  kid: z.string().optional(),
  alg: z.string().optional(),
  use: z.string().optional(),
  created_at: z.number().optional(),
  expired_at: z.number().nullable().optional(),
});
export type PlaidJwk = z.infer<typeof plaidJwkSchema>;

const headerSchema = z.object({ alg: z.string(), kid: z.string().min(1).max(200), typ: z.string().optional() });
const claimsSchema = z.object({ iat: z.number().int(), request_body_sha256: z.string().regex(/^[0-9a-f]{64}$/) });

export const MAX_WEBHOOK_AGE_SECONDS = 5 * 60;
const MAX_CLOCK_SKEW_SECONDS = 60;

function decodePart<T>(part: string, schema: z.ZodType<T>, what: string): T {
  try {
    return schema.parse(JSON.parse(Buffer.from(part, "base64url").toString("utf8")));
  } catch {
    throw new WebhookVerificationError(`Invalid JWT ${what}.`);
  }
}

export function sha256Hex(body: string | Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

export async function verifyPlaidWebhook(input: {
  rawBody: string;
  verificationHeader: string | null;
  getKey: (kid: string) => Promise<PlaidJwk | null>;
  now?: Date;
}): Promise<{ bodySha256: string; kid: string }> {
  const token = input.verificationHeader?.trim();
  if (!token) throw new WebhookVerificationError("Missing Plaid-Verification header.");
  const parts = token.split(".");
  if (parts.length !== 3 || token.length > 4096) throw new WebhookVerificationError("Malformed JWT.");
  const [headerPart, claimsPart, signaturePart] = parts;

  const header = decodePart(headerPart, headerSchema, "header");
  if (header.alg !== "ES256") throw new WebhookVerificationError("Unexpected JWT algorithm.");

  const jwk = await input.getKey(header.kid);
  if (!jwk) throw new WebhookVerificationError("Unknown signing key.");
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (jwk.expired_at != null && jwk.expired_at <= nowSeconds) throw new WebhookVerificationError("Signing key expired.");

  const publicKey = createPublicKey({
    key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } satisfies JsonWebKey,
    format: "jwk",
  });
  const signature = Buffer.from(signaturePart, "base64url");
  const valid =
    signature.length === 64 &&
    verify("sha256", Buffer.from(`${headerPart}.${claimsPart}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, signature);
  if (!valid) throw new WebhookVerificationError("Invalid signature.");

  const claims = decodePart(claimsPart, claimsSchema, "claims");
  if (claims.iat < nowSeconds - MAX_WEBHOOK_AGE_SECONDS || claims.iat > nowSeconds + MAX_CLOCK_SKEW_SECONDS) {
    throw new WebhookVerificationError("Webhook is too old or from the future.");
  }

  const bodySha256 = sha256Hex(input.rawBody);
  if (!timingSafeEqual(Buffer.from(bodySha256), Buffer.from(claims.request_body_sha256))) {
    throw new WebhookVerificationError("Body hash mismatch.");
  }
  return { bodySha256, kid: header.kid };
}
