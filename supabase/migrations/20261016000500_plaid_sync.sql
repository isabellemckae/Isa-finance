-- Phase 4: Plaid sandbox linking and transaction sync.
--
-- These functions are called only by the server with the service-role key (the Plaid
-- link, sync and webhook paths). They are NOT executable by anon or authenticated.
-- Each derives the owning user from the connection row, never from caller input,
-- and applies a whole sync together with its cursor in one transaction, so an
-- interrupted sync restarts from the last committed cursor.

-- ---------------------------------------------------------------------------
-- Link: institution + connection + encrypted token, atomically
-- ---------------------------------------------------------------------------

create or replace function public.create_plaid_connection(
  p_connection_id uuid,
  p_user_id uuid,
  p_item_id text,
  p_institution_plaid_id text,
  p_institution_name text,
  p_key_id text,
  p_ciphertext text,
  p_consent_expires_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_institution uuid;
begin
  if p_item_id is null or char_length(p_item_id) not between 1 and 200 then
    raise exception 'invalid item id' using errcode = '22023';
  end if;
  if p_ciphertext !~ '^v1\.[a-z0-9_-]{1,32}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then
    -- Refuse anything that is not our ciphertext format (e.g. a plaintext token).
    raise exception 'token must be encrypted' using errcode = '22023';
  end if;

  if p_institution_plaid_id is not null then
    insert into public.institutions (plaid_institution_id, name)
    values (left(p_institution_plaid_id, 100), left(coalesce(nullif(p_institution_name, ''), 'Bank'), 120))
    on conflict (plaid_institution_id) do update set name = excluded.name
    returning id into v_institution;
  end if;

  insert into public.bank_connections (id, user_id, institution_id, provider, provider_item_id, environment, status, consent_expires_at)
  values (p_connection_id, p_user_id, v_institution, 'plaid', p_item_id, 'sandbox', 'active', p_consent_expires_at);

  insert into public.bank_connection_secrets (connection_id, user_id, access_token_ciphertext, key_id)
  values (p_connection_id, p_user_id, p_ciphertext, p_key_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Sync: accounts, balances, transactions and cursor in one transaction
-- ---------------------------------------------------------------------------

create or replace function public.apply_plaid_sync(
  p_connection_id uuid,
  p_cursor_before text,
  p_cursor_after text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid;
  v_cursor text;
  v_status text;
  v_accounts int := 0;
  v_added int := 0;
  v_modified int := 0;
  v_removed int := 0;
begin
  if p_cursor_after is null or char_length(p_cursor_after) > 4096 then
    raise exception 'invalid cursor' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload) <> 'object'
     or coalesce(jsonb_array_length(p_payload -> 'added'), 0)
      + coalesce(jsonb_array_length(p_payload -> 'modified'), 0)
      + coalesce(jsonb_array_length(p_payload -> 'removed'), 0) > 100000 then
    raise exception 'invalid sync payload' using errcode = '22023';
  end if;

  -- Row lock serializes concurrent syncs of the same connection.
  select user_id, transactions_cursor, status into v_user, v_cursor, v_status
  from public.bank_connections
  where id = p_connection_id and provider = 'plaid'
  for update;
  if not found then
    raise exception 'connection_not_found' using errcode = 'P0002';
  end if;
  if v_status = 'disconnected' then
    raise exception 'connection_disconnected' using errcode = '55000';
  end if;
  if v_cursor is distinct from p_cursor_before then
    -- Another sync committed first; the caller's data is stale.
    raise exception 'cursor_conflict' using errcode = 'PT409';
  end if;

  -- Accounts (user-editable nickname and hidden flag are never touched).
  insert into public.accounts (user_id, connection_id, source, provider_account_id, type, subtype, name, official_name, mask, currency)
  select v_user, p_connection_id, 'plaid', a.provider_account_id, a.type, a.subtype, a.name, a.official_name, a.mask, a.currency
  from jsonb_to_recordset(coalesce(p_payload -> 'accounts', '[]')) as a(
    provider_account_id text, type text, subtype text, name text, official_name text, mask text, currency text)
  on conflict (connection_id, provider_account_id) do update
    set type = excluded.type, subtype = excluded.subtype, name = excluded.name,
        official_name = excluded.official_name, mask = excluded.mask, currency = excluded.currency;
  get diagnostics v_accounts = row_count;

  -- Balances as reported by the institution.
  insert into public.balance_snapshots (user_id, account_id, current_minor, available_minor, credit_limit_minor, currency, as_of, source)
  select v_user, acc.id, b.current_minor, b.available_minor, b.credit_limit_minor, b.currency, b.as_of, 'institution'
  from jsonb_to_recordset(coalesce(p_payload -> 'balances', '[]')) as b(
    provider_account_id text, current_minor bigint, available_minor bigint, credit_limit_minor bigint, currency text, as_of timestamptz)
  join public.accounts acc
    on acc.connection_id = p_connection_id and acc.user_id = v_user and acc.provider_account_id = b.provider_account_id
  on conflict (account_id, as_of) do update
    set current_minor = excluded.current_minor, available_minor = excluded.available_minor,
        credit_limit_minor = excluded.credit_limit_minor, currency = excluded.currency;

  -- Added and modified transactions: idempotent upsert on (user, source, external id).
  create temp table if not exists pg_temp.plaid_sync_tx (
    op text, external_id text, provider_account_id text, pending_external_id text, status text,
    amount_minor bigint, currency text, transaction_date date, authorized_date date,
    description text, merchant_name text, provider_category_primary text,
    provider_category_detailed text, payment_channel text, category_name text
  ) on commit drop;
  truncate pg_temp.plaid_sync_tx;

  insert into pg_temp.plaid_sync_tx
  select 'added', t.* from jsonb_to_recordset(coalesce(p_payload -> 'added', '[]')) as t(
    external_id text, provider_account_id text, pending_external_id text, status text,
    amount_minor bigint, currency text, transaction_date date, authorized_date date,
    description text, merchant_name text, provider_category_primary text,
    provider_category_detailed text, payment_channel text, category_name text)
  union all
  select 'modified', t.* from jsonb_to_recordset(coalesce(p_payload -> 'modified', '[]')) as t(
    external_id text, provider_account_id text, pending_external_id text, status text,
    amount_minor bigint, currency text, transaction_date date, authorized_date date,
    description text, merchant_name text, provider_category_primary text,
    provider_category_detailed text, payment_channel text, category_name text);

  insert into public.transactions (
    user_id, account_id, source, external_id, pending_external_id, status, amount_minor, currency,
    transaction_date, authorized_date, description, merchant_name, provider_category_primary,
    provider_category_detailed, payment_channel, default_category_id)
  select distinct on (t.external_id)
         v_user, acc.id, 'plaid', t.external_id, t.pending_external_id, t.status, t.amount_minor, t.currency,
         t.transaction_date, t.authorized_date, t.description, t.merchant_name, t.provider_category_primary,
         t.provider_category_detailed, t.payment_channel,
         (select c.id from public.transaction_categories c
           where c.user_id = v_user and c.name = t.category_name)
  from pg_temp.plaid_sync_tx t
  join public.accounts acc
    on acc.connection_id = p_connection_id and acc.user_id = v_user and acc.provider_account_id = t.provider_account_id
  -- A transaction listed twice keeps its latest ("modified") version.
  order by t.external_id, t.op desc
  on conflict (user_id, source, external_id) do update
    set account_id = excluded.account_id,
        pending_external_id = excluded.pending_external_id,
        status = excluded.status,
        amount_minor = excluded.amount_minor,
        currency = excluded.currency,
        transaction_date = excluded.transaction_date,
        authorized_date = excluded.authorized_date,
        description = excluded.description,
        merchant_name = excluded.merchant_name,
        provider_category_primary = excluded.provider_category_primary,
        provider_category_detailed = excluded.provider_category_detailed,
        payment_channel = excluded.payment_channel,
        default_category_id = excluded.default_category_id,
        is_removed = false,
        removed_at = null;

  select count(*) filter (where t.op = 'added'), count(*) filter (where t.op = 'modified')
  into v_added, v_modified
  from pg_temp.plaid_sync_tx t
  join public.accounts acc
    on acc.connection_id = p_connection_id and acc.user_id = v_user and acc.provider_account_id = t.provider_account_id;

  -- Pending → posted: the posted transaction supersedes its pending version, and the
  -- user's edits (category, note, exclusions) carry over to it.
  update public.transactions p
     set superseded_by = n.id
    from public.transactions n
   where n.user_id = v_user and n.source = 'plaid' and n.pending_external_id is not null
     and n.external_id in (select external_id from pg_temp.plaid_sync_tx)
     and p.user_id = v_user and p.source = 'plaid' and p.external_id = n.pending_external_id
     and p.id <> n.id and p.superseded_by is null;

  insert into public.transaction_overrides (transaction_id, user_id, category_id, merchant_name, note, exclude_from_budget, transfer_override)
  select n.id, v_user, o.category_id, o.merchant_name, o.note, o.exclude_from_budget, o.transfer_override
  from public.transactions p
  join public.transaction_overrides o on o.transaction_id = p.id and o.user_id = v_user
  join public.transactions n on n.id = p.superseded_by and n.user_id = v_user
  where p.user_id = v_user and p.source = 'plaid'
    and n.external_id in (select external_id from pg_temp.plaid_sync_tx)
  on conflict (transaction_id) do nothing;

  -- Removed transactions are flagged, not deleted, so history and links stay explainable.
  update public.transactions
     set is_removed = true, removed_at = now()
   where user_id = v_user and source = 'plaid' and not is_removed
     and account_id in (select id from public.accounts where connection_id = p_connection_id and user_id = v_user)
     and external_id in (select jsonb_array_elements_text(coalesce(p_payload -> 'removed', '[]')));
  get diagnostics v_removed = row_count;

  update public.bank_connections
     set transactions_cursor = p_cursor_after,
         last_sync_attempt_at = now(),
         last_successful_sync_at = now(),
         status = case when status = 'pending_expiration' then status else 'active' end,
         last_error_code = case when status = 'pending_expiration' then last_error_code else null end
   where id = p_connection_id;

  return jsonb_build_object('accounts', v_accounts, 'added', v_added, 'modified', v_modified, 'removed', v_removed);
end;
$$;

-- ---------------------------------------------------------------------------
-- Disconnect: delete the token and stop syncing; history stays
-- ---------------------------------------------------------------------------

create or replace function public.disconnect_plaid_connection(p_connection_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.bank_connection_secrets where connection_id = p_connection_id;
  update public.bank_connections
     set status = 'disconnected', transactions_cursor = null, last_error_code = null
   where id = p_connection_id and provider = 'plaid';
  if not found then
    raise exception 'connection_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Webhook idempotency lookups by item.
create index if not exists bank_connections_item_idx on public.bank_connections (provider_item_id);

revoke all on function public.create_plaid_connection(uuid, uuid, text, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.apply_plaid_sync(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.disconnect_plaid_connection(uuid) from public, anon, authenticated;
grant execute on function public.create_plaid_connection(uuid, uuid, text, text, text, text, text, timestamptz) to service_role;
grant execute on function public.apply_plaid_sync(uuid, text, text, jsonb) to service_role;
grant execute on function public.disconnect_plaid_connection(uuid) to service_role;
