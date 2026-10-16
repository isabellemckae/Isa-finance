-- ISA Finance: privileges and Row Level Security
--
-- Model:
--   * anon: no access to anything in public.
--   * authenticated: only rows where user_id = auth.uid(), and only the
--     operations listed per table below (table + column grants AND policies).
--   * service_role: bypasses RLS; used only by server-only Plaid sync/webhook code.
--   * Tables with secrets (bank_connection_secrets, webhook_events) have RLS
--     enabled with NO policies and no grants to anon/authenticated.

-- ---------------------------------------------------------------------------
-- Reset privileges (Supabase grants broad defaults to anon/authenticated)
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;

grant execute on function public.log_audit_event(text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Enable + force RLS everywhere
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'institutions', 'bank_connections', 'bank_connection_secrets',
    'accounts', 'balance_snapshots', 'transaction_categories', 'transactions',
    'transaction_overrides', 'transfer_links', 'budgets', 'budget_allocations',
    'income_sources', 'recurring_bills', 'savings_goals', 'debt_goals',
    'financial_forecasts', 'ai_conversations', 'ai_messages', 'sync_runs',
    'webhook_events', 'audit_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Full-CRUD owner tables
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'transaction_overrides', 'transfer_links', 'budgets', 'budget_allocations',
    'income_sources', 'recurring_bills', 'savings_goals', 'debt_goals'
  ]
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format(
      'create policy "owner can read" on public.%I for select to authenticated
         using (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "owner can insert" on public.%I for insert to authenticated
         with check (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "owner can update" on public.%I for update to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "owner can delete" on public.%I for delete to authenticated
         using (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Read + insert + delete (no update) owner tables
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['financial_forecasts', 'ai_conversations', 'ai_messages']
  loop
    execute format('grant select, insert, delete on public.%I to authenticated', t);
    execute format(
      'create policy "owner can read" on public.%I for select to authenticated
         using (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "owner can insert" on public.%I for insert to authenticated
         with check (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "owner can delete" on public.%I for delete to authenticated
         using (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

grant update (title) on public.ai_conversations to authenticated;
create policy "owner can update" on public.ai_conversations for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Read-only (for the user) tables written by the server
-- ---------------------------------------------------------------------------

grant select on public.bank_connections to authenticated;
create policy "owner can read" on public.bank_connections for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.sync_runs to authenticated;
create policy "owner can read" on public.sync_runs for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.audit_events to authenticated;
create policy "owner can read" on public.audit_events for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.institutions to authenticated;
create policy "authenticated can read institutions" on public.institutions
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Profiles: read + limited update of own row
-- ---------------------------------------------------------------------------

grant select on public.profiles to authenticated;
grant update (display_name, base_currency, timezone, safety_buffer_minor, include_expected_income)
  on public.profiles to authenticated;
create policy "owner can read" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "owner can update" on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Accounts: read all own; create manual accounts; rename / hide
-- ---------------------------------------------------------------------------

grant select, delete on public.accounts to authenticated;
grant insert (user_id, source, type, subtype, name, nickname, mask, currency, is_hidden)
  on public.accounts to authenticated;
grant update (nickname, is_hidden) on public.accounts to authenticated;

create policy "owner can read" on public.accounts for select to authenticated
  using (user_id = (select auth.uid()));
create policy "owner can create manual accounts" on public.accounts for insert to authenticated
  with check (user_id = (select auth.uid()) and source = 'manual' and connection_id is null);
create policy "owner can update" on public.accounts for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "owner can delete manual accounts" on public.accounts for delete to authenticated
  using (user_id = (select auth.uid()) and source = 'manual');

-- ---------------------------------------------------------------------------
-- Balance snapshots: read own; manual balances for manual accounts only
-- ---------------------------------------------------------------------------

grant select on public.balance_snapshots to authenticated;
grant insert (user_id, account_id, current_minor, available_minor, credit_limit_minor,
              currency, as_of, source)
  on public.balance_snapshots to authenticated;

create policy "owner can read" on public.balance_snapshots for select to authenticated
  using (user_id = (select auth.uid()));
create policy "owner can record manual balances" on public.balance_snapshots
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and source = 'manual'
    and exists (
      select 1 from public.accounts a
      where a.id = account_id
        and a.user_id = (select auth.uid())
        and a.source = 'manual'
    )
  );

-- ---------------------------------------------------------------------------
-- Categories: read own; manage non-system categories
-- ---------------------------------------------------------------------------

grant select, delete on public.transaction_categories to authenticated;
grant insert (user_id, name, kind, is_essential, parent_id, color)
  on public.transaction_categories to authenticated;
grant update (name, is_essential, parent_id, color)
  on public.transaction_categories to authenticated;

create policy "owner can read" on public.transaction_categories for select to authenticated
  using (user_id = (select auth.uid()));
create policy "owner can insert" on public.transaction_categories for insert to authenticated
  with check (user_id = (select auth.uid()) and not is_system);
create policy "owner can update custom" on public.transaction_categories
  for update to authenticated
  using (user_id = (select auth.uid()) and not is_system)
  with check (user_id = (select auth.uid()) and not is_system);
create policy "owner can delete custom" on public.transaction_categories
  for delete to authenticated
  using (user_id = (select auth.uid()) and not is_system);

-- ---------------------------------------------------------------------------
-- Transactions: read own; add manual/CSV rows; edit/delete manual rows only.
-- Bank-provided rows are immutable for users (edits go to overrides).
-- ---------------------------------------------------------------------------

grant select on public.transactions to authenticated;
grant insert (user_id, account_id, source, status, amount_minor, currency, transaction_date,
              description, merchant_name, default_category_id, dedupe_hash, import_batch_id)
  on public.transactions to authenticated;
grant update (status, amount_minor, transaction_date, description, merchant_name)
  on public.transactions to authenticated;
grant delete on public.transactions to authenticated;

create policy "owner can read" on public.transactions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "owner can add manual or imported" on public.transactions
  for insert to authenticated
  with check (user_id = (select auth.uid()) and source in ('manual', 'csv'));
create policy "owner can edit manual" on public.transactions for update to authenticated
  using (user_id = (select auth.uid()) and source = 'manual')
  with check (user_id = (select auth.uid()) and source = 'manual');
create policy "owner can delete manual or imported" on public.transactions
  for delete to authenticated
  using (user_id = (select auth.uid()) and source in ('manual', 'csv'));

-- bank_connection_secrets and webhook_events: intentionally no grants, no policies.
