#!/usr/bin/env node
// Re-encrypts stored Plaid access tokens with the ACTIVE key after a key rotation.
// See docs/SECURITY.md → Key management. Run:  npm run tokens:reencrypt
//
// Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, TOKEN_ENCRYPTION_KEYS and
// TOKEN_ENCRYPTION_ACTIVE_KEY_ID from the environment (e.g. `node --env-file=.env.local`).
// Prints counts and connection ids only; never tokens or keys. Each row is updated only
// if its ciphertext is unchanged since it was read (safe to re-run).
import { createClient } from "@supabase/supabase-js";
import { parseKeyring, planReencryption } from "../src/lib/security/token-crypto.ts";

const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SECRET_KEY: serviceKey } = process.env;
if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");
  process.exit(1);
}
const keyring = parseKeyring(process.env.TOKEN_ENCRYPTION_KEYS, process.env.TOKEN_ENCRYPTION_ACTIVE_KEY_ID);
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data, error } = await db
  .from("bank_connection_secrets")
  .select("connection_id, user_id, access_token_ciphertext")
  .neq("key_id", keyring.activeKeyId);
if (error) {
  console.error(`Could not read secrets (${error.code || "connection failed"}).`);
  process.exit(1);
}

const plan = planReencryption(
  data.map((r) => ({ connectionId: r.connection_id, userId: r.user_id, ciphertext: r.access_token_ciphertext })),
  keyring,
);
let updated = 0;
for (const u of plan.updates) {
  const { data: rows, error: updateError } = await db
    .from("bank_connection_secrets")
    .update({ access_token_ciphertext: u.ciphertext, key_id: u.keyId, rotated_at: new Date().toISOString() })
    .eq("connection_id", u.connectionId)
    .eq("access_token_ciphertext", u.previousCiphertext)
    .select("connection_id");
  if (updateError) plan.failed.push(u.connectionId);
  else updated += rows.length;
}
console.log(`Re-encrypted ${updated} of ${data.length} secret(s) with key "${keyring.activeKeyId}".`);
if (plan.failed.length) {
  console.error(`Failed for connection(s): ${plan.failed.join(", ")}. Their keys may be missing from the keyring.`);
  process.exit(2);
}
