import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  CursorConflictError,
  type ApplySyncInput,
  type ApplySyncResult,
  type ConnectionRecord,
  type PlaidStore,
  type SyncTrigger,
} from "./ports";

/**
 * PlaidStore backed by Supabase with the SERVICE-ROLE client (bypasses RLS). Used only
 * by the Plaid link, sync and webhook paths. Every user-scoped query filters on
 * `user_id` explicitly, and the SQL functions derive the owner from the connection row.
 * Database error details are never surfaced; only the SQLSTATE is kept.
 */

export class PlaidStoreError extends Error {
  constructor(
    readonly operation: string,
    readonly code: string | null,
  ) {
    super(`Plaid store operation failed: ${operation}`);
    this.name = "PlaidStoreError";
  }
}

const statusSchema = z.enum(["active", "login_required", "pending_expiration", "revoked", "error", "disconnected"]);

const connectionRow = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  provider_item_id: z.string(),
  status: statusSchema,
  transactions_cursor: z.string().nullable(),
  institution: z.object({ name: z.string() }).nullable(),
  // PostgREST embeds this one-to-one table as an array (composite foreign key).
  secret: z.preprocess(
    (v) => (Array.isArray(v) ? (v[0] ?? null) : v),
    z.object({ access_token_ciphertext: z.string() }).nullable(),
  ),
});

const SELECT_CONNECTION =
  "id, user_id, provider_item_id, status, transactions_cursor, institution:institutions(name), secret:bank_connection_secrets(access_token_ciphertext)";

const countsSchema = z.object({ accounts: z.number(), added: z.number(), modified: z.number(), removed: z.number() });

type PgError = { code?: string; message?: string } | null;

export class SupabasePlaidStore implements PlaidStore {
  constructor(private readonly db: SupabaseClient) {}

  private fail(operation: string, error: PgError): never {
    throw new PlaidStoreError(operation, error?.code ?? null);
  }

  private toRecord(raw: unknown): ConnectionRecord {
    const r = connectionRow.parse(raw);
    return {
      id: r.id,
      userId: r.user_id,
      itemId: r.provider_item_id,
      status: r.status,
      cursor: r.transactions_cursor,
      institutionName: r.institution?.name ?? null,
      ciphertext: r.secret?.access_token_ciphertext ?? null,
    };
  }

  async createConnection(input: Parameters<PlaidStore["createConnection"]>[0]): Promise<void> {
    const { error } = await this.db.rpc("create_plaid_connection", {
      p_connection_id: input.connectionId,
      p_user_id: input.userId,
      p_item_id: input.itemId,
      p_institution_plaid_id: input.institution?.plaidId ?? null,
      p_institution_name: input.institution?.name ?? null,
      p_key_id: input.keyId,
      p_ciphertext: input.ciphertext,
      p_consent_expires_at: input.consentExpiresAt,
    });
    if (error) this.fail("create_connection", error);
  }

  async getConnection(connectionId: string, userId?: string): Promise<ConnectionRecord | null> {
    let query = this.db.from("bank_connections").select(SELECT_CONNECTION).eq("id", connectionId).eq("provider", "plaid");
    if (userId) query = query.eq("user_id", userId);
    const { data, error } = await query.maybeSingle();
    if (error) this.fail("get_connection", error);
    return data ? this.toRecord(data) : null;
  }

  async getConnectionByItemId(itemId: string): Promise<ConnectionRecord | null> {
    const { data, error } = await this.db
      .from("bank_connections")
      .select(SELECT_CONNECTION)
      .eq("provider", "plaid")
      .eq("provider_item_id", itemId)
      .maybeSingle();
    if (error) this.fail("get_connection_by_item", error);
    return data ? this.toRecord(data) : null;
  }

  async setStatus(connectionId: string, status: ConnectionRecord["status"], errorCode: string | null): Promise<void> {
    const { error } = await this.db
      .from("bank_connections")
      .update({ status, last_error_code: errorCode?.slice(0, 100) ?? null, last_sync_attempt_at: new Date().toISOString() })
      .eq("id", connectionId)
      .neq("status", "disconnected");
    if (error) this.fail("set_status", error);
  }

  async startSyncRun(input: { connectionId: string; userId: string; trigger: SyncTrigger; cursorBefore: string | null }): Promise<string> {
    const { data, error } = await this.db
      .from("sync_runs")
      .insert({
        connection_id: input.connectionId,
        user_id: input.userId,
        trigger: input.trigger,
        status: "running",
        cursor_before: input.cursorBefore,
      })
      .select("id")
      .single();
    if (error || !data) this.fail("start_sync_run", error);
    return z.object({ id: z.string().uuid() }).parse(data).id;
  }

  async finishSyncRun(
    runId: string,
    result: { status: "succeeded" | "failed"; counts?: ApplySyncResult; cursorAfter?: string | null; errorCode?: string | null },
  ): Promise<void> {
    const { error } = await this.db
      .from("sync_runs")
      .update({
        status: result.status,
        finished_at: new Date().toISOString(),
        added_count: result.counts?.added ?? 0,
        modified_count: result.counts?.modified ?? 0,
        removed_count: result.counts?.removed ?? 0,
        cursor_after: result.cursorAfter ?? null,
        error_code: result.errorCode?.slice(0, 100) ?? null,
      })
      .eq("id", runId);
    if (error) this.fail("finish_sync_run", error);
  }

  async applySync(input: ApplySyncInput): Promise<ApplySyncResult> {
    const { data, error } = await this.db.rpc("apply_plaid_sync", {
      p_connection_id: input.connectionId,
      p_cursor_before: input.cursorBefore,
      p_cursor_after: input.cursorAfter,
      p_payload: {
        accounts: input.accounts,
        balances: input.balances,
        added: input.added,
        modified: input.modified,
        removed: input.removed,
      },
    });
    if (error?.code === "PT409") throw new CursorConflictError();
    if (error) this.fail("apply_sync", error);
    return countsSchema.parse(data);
  }

  async recordWebhook(input: { bodySha256: string; type: string; code: string; itemId: string | null }): Promise<"new" | "duplicate"> {
    const { data, error } = await this.db
      .from("webhook_events")
      .upsert(
        {
          provider: "plaid",
          body_sha256: input.bodySha256,
          webhook_type: input.type.slice(0, 60),
          webhook_code: input.code.slice(0, 60),
          provider_item_id: input.itemId?.slice(0, 200) ?? null,
        },
        { onConflict: "body_sha256", ignoreDuplicates: true },
      )
      .select("id");
    if (error) this.fail("record_webhook", error);
    if (data && data.length > 0) return "new";
    // Seen before: reprocess only if the earlier attempt failed.
    const { data: retried, error: retryError } = await this.db
      .from("webhook_events")
      .update({ status: "received", processed_at: null })
      .eq("body_sha256", input.bodySha256)
      .eq("status", "failed")
      .select("id");
    if (retryError) this.fail("record_webhook", retryError);
    return retried && retried.length > 0 ? "new" : "duplicate";
  }

  async markWebhook(bodySha256: string, status: "processed" | "ignored" | "failed"): Promise<void> {
    const { error } = await this.db
      .from("webhook_events")
      .update({ status, processed_at: new Date().toISOString() })
      .eq("body_sha256", bodySha256);
    if (error) this.fail("mark_webhook", error);
  }

  async markDisconnected(connectionId: string): Promise<void> {
    const { error } = await this.db.rpc("disconnect_plaid_connection", { p_connection_id: connectionId });
    if (error) this.fail("disconnect", error);
  }

  async audit(
    userId: string,
    action: string,
    entityId: string | null,
    metadata: Record<string, string | number | boolean | null> = {},
  ): Promise<void> {
    // Best effort: an audit failure must not undo a completed sync, but is reported.
    const { error } = await this.db.from("audit_events").insert({
      user_id: userId,
      actor: "system",
      action: action.slice(0, 80),
      entity_type: "bank_connection",
      entity_id: entityId,
      metadata,
    });
    if (error) console.error("audit_event_failed", { action, code: error.code });
  }
}
