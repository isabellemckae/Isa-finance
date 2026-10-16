-- ISA Finance Phase 2: data-access helpers for the Supabase repository.
--
-- Every function here is SECURITY INVOKER: it runs with the caller's privileges,
-- so table grants and Row Level Security apply exactly as for direct queries.
-- Functions only bundle multi-step writes into one transaction.

-- ---------------------------------------------------------------------------
-- Latest balance per account (RLS applies through security_invoker)
-- ---------------------------------------------------------------------------

create view public.account_latest_balances
with (security_invoker = true) as
select distinct on (account_id)
  account_id,
  user_id,
  current_minor,
  available_minor,
  credit_limit_minor,
  currency,
  as_of
from public.balance_snapshots
order by account_id, as_of desc;

revoke all on public.account_latest_balances from anon, authenticated;
grant select on public.account_latest_balances to authenticated;

-- ---------------------------------------------------------------------------
-- Manual account with its opening balance, atomically
-- ---------------------------------------------------------------------------

create function public.create_manual_account(
  p_name text,
  p_type text,
  p_subtype text,
  p_currency char(3),
  p_nickname text,
  p_current_minor bigint,
  p_credit_limit_minor bigint default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into public.accounts (user_id, source, type, subtype, name, nickname, currency)
  values (auth.uid(), 'manual', p_type, p_subtype, p_name, p_nickname, p_currency)
  returning id into v_account_id;

  insert into public.balance_snapshots
    (user_id, account_id, current_minor, available_minor, credit_limit_minor, currency, as_of, source)
  values (
    auth.uid(), v_account_id, p_current_minor,
    case when p_type = 'depository' then p_current_minor
         when p_type = 'credit' and p_credit_limit_minor is not null then p_credit_limit_minor - p_current_minor
         else null end,
    p_credit_limit_minor, p_currency, now(), 'manual'
  );

  return v_account_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- CSV import: idempotent on (account_id, dedupe_hash)
-- ---------------------------------------------------------------------------

create function public.import_transactions(
  p_account_id uuid,
  p_batch_id uuid,
  p_rows jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_currency char(3);
  v_inserted integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'p_rows must be an array of at most 5000 rows' using errcode = '22023';
  end if;

  -- RLS: only the caller's own accounts are visible here.
  select currency into v_currency from public.accounts where id = p_account_id;
  if v_currency is null then
    raise exception 'account not found' using errcode = '42501';
  end if;

  insert into public.transactions (
    user_id, account_id, source, status, amount_minor, currency, transaction_date,
    description, merchant_name, default_category_id, dedupe_hash, import_batch_id
  )
  select
    auth.uid(), p_account_id, 'csv', 'posted',
    (r ->> 'amount_minor')::bigint,
    v_currency,
    (r ->> 'date')::date,
    r ->> 'description',
    nullif(r ->> 'merchant_name', ''),
    nullif(r ->> 'category_id', '')::uuid,
    r ->> 'dedupe_hash',
    p_batch_id
  from jsonb_array_elements(p_rows) as r
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- ---------------------------------------------------------------------------
-- Budgets
-- ---------------------------------------------------------------------------

create function public.ensure_budget(p_month date, p_currency char(3) default 'USD')
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  insert into public.budgets (user_id, month, currency)
  values (auth.uid(), p_month, p_currency)
  on conflict (user_id, month) do nothing;
  select id into v_id from public.budgets where user_id = auth.uid() and month = p_month;
  return v_id;
end;
$$;

create function public.upsert_budget_allocation(
  p_month date,
  p_category_id uuid,
  p_kind text,
  p_planned_minor bigint
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_budget_id uuid := public.ensure_budget(p_month);
  v_id uuid;
begin
  insert into public.budget_allocations (user_id, budget_id, category_id, kind, planned_minor)
  values (auth.uid(), v_budget_id, p_category_id, p_kind, p_planned_minor)
  on conflict (budget_id, category_id)
  do update set kind = excluded.kind, planned_minor = excluded.planned_minor
  returning id into v_id;
  return v_id;
end;
$$;

-- Copies allocations from one month into another, keeping any that already exist.
create function public.copy_budget(p_from date, p_to date)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_target uuid := public.ensure_budget(p_to);
  v_copied integer;
begin
  insert into public.budget_allocations (user_id, budget_id, category_id, kind, planned_minor)
  select auth.uid(), v_target, a.category_id, a.kind, a.planned_minor
  from public.budget_allocations a
  join public.budgets b on b.id = a.budget_id
  where b.user_id = auth.uid() and b.month = p_from
  on conflict (budget_id, category_id) do nothing;
  get diagnostics v_copied = row_count;
  return v_copied;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: callable by signed-in users only
-- ---------------------------------------------------------------------------

revoke all on function public.create_manual_account(text, text, text, char, text, bigint, bigint) from public, anon;
revoke all on function public.import_transactions(uuid, uuid, jsonb) from public, anon;
revoke all on function public.ensure_budget(date, char) from public, anon;
revoke all on function public.upsert_budget_allocation(date, uuid, text, bigint) from public, anon;
revoke all on function public.copy_budget(date, date) from public, anon;

grant execute on function public.create_manual_account(text, text, text, char, text, bigint, bigint) to authenticated;
grant execute on function public.import_transactions(uuid, uuid, jsonb) to authenticated;
grant execute on function public.ensure_budget(date, char) to authenticated;
grant execute on function public.upsert_budget_allocation(date, uuid, text, bigint) to authenticated;
grant execute on function public.copy_budget(date, date) to authenticated;
