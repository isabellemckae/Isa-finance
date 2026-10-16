-- ISA Finance: initial schema
--
-- Conventions (see ARCHITECTURE.md §3):
--   * money is bigint minor units (*_minor) + currency char(3)
--   * amount sign: negative = money out of the account, positive = money in
--   * every user-owned table has user_id, RLS enabled + forced, owner policies
--   * child tables use composite FKs (parent_id, user_id) so rows can never
--     reference another user's parent row
--   * provider (bank) data is never edited by users; edits go to overrides

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  base_currency char(3) not null default 'USD' check (base_currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'America/Chicago' check (char_length(timezone) <= 64),
  safety_buffer_minor bigint not null default 0 check (safety_buffer_minor >= 0),
  include_expected_income boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Institutions (reference data, not user-owned)
-- ---------------------------------------------------------------------------

create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  plaid_institution_id text unique,
  name text not null check (char_length(name) <= 120),
  primary_color text check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Bank connections (Plaid Items, manual sources, CSV sources)
-- ---------------------------------------------------------------------------

create table public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  institution_id uuid references public.institutions (id),
  provider text not null check (provider in ('plaid', 'manual', 'csv')),
  provider_item_id text,
  environment text not null default 'sandbox'
    check (environment in ('sandbox', 'production')),
  status text not null default 'active'
    check (status in ('active', 'login_required', 'pending_expiration',
                      'revoked', 'error', 'disconnected')),
  last_error_code text check (char_length(last_error_code) <= 100),
  consent_expires_at timestamptz,
  transactions_cursor text,
  last_sync_attempt_at timestamptz,
  last_successful_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (provider, provider_item_id)
);

create index bank_connections_user_idx on public.bank_connections (user_id);
create index bank_connections_institution_idx on public.bank_connections (institution_id);

-- Encrypted Plaid access tokens. No policies: only the service role can access it.
create table public.bank_connection_secrets (
  connection_id uuid primary key,
  user_id uuid not null,
  access_token_ciphertext text not null,
  key_id text not null check (char_length(key_id) <= 32),
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  foreign key (connection_id, user_id)
    references public.bank_connections (id, user_id) on delete cascade
);

create index bank_connection_secrets_key_idx on public.bank_connection_secrets (key_id);

-- ---------------------------------------------------------------------------
-- Accounts & balances
-- ---------------------------------------------------------------------------

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid,
  source text not null check (source in ('plaid', 'manual', 'csv')),
  provider_account_id text,
  type text not null
    check (type in ('depository', 'credit', 'loan', 'investment', 'other')),
  subtype text check (char_length(subtype) <= 40),
  name text not null check (char_length(name) <= 120),
  official_name text check (char_length(official_name) <= 200),
  nickname text check (char_length(nickname) <= 60),
  mask text check (mask ~ '^[0-9A-Za-z]{2,4}$'),
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  is_hidden boolean not null default false,
  is_asset boolean generated always as (type in ('depository', 'investment')) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (connection_id, provider_account_id),
  foreign key (connection_id, user_id)
    references public.bank_connections (id, user_id) on delete cascade,
  check ((source = 'plaid') = (provider_account_id is not null))
);

create index accounts_user_idx on public.accounts (user_id);
create index accounts_connection_idx on public.accounts (connection_id);

create table public.balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null,
  current_minor bigint,
  available_minor bigint,
  credit_limit_minor bigint check (credit_limit_minor is null or credit_limit_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  as_of timestamptz not null,
  source text not null check (source in ('institution', 'manual', 'computed')),
  created_at timestamptz not null default now(),
  unique (account_id, as_of),
  foreign key (account_id, user_id)
    references public.accounts (id, user_id) on delete cascade
);

create index balance_snapshots_user_idx on public.balance_snapshots (user_id);
create index balance_snapshots_account_asof_idx
  on public.balance_snapshots (account_id, as_of desc);

-- ---------------------------------------------------------------------------
-- Categories & transactions
-- ---------------------------------------------------------------------------

create table public.transaction_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  kind text not null check (kind in ('expense', 'income', 'transfer')),
  is_essential boolean not null default false,
  parent_id uuid,
  color text check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, name),
  foreign key (parent_id, user_id)
    references public.transaction_categories (id, user_id) on delete set null (parent_id)
);

create index transaction_categories_parent_idx on public.transaction_categories (parent_id);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null,
  source text not null check (source in ('plaid', 'manual', 'csv')),
  external_id text not null default gen_random_uuid()::text,
  pending_external_id text,
  status text not null check (status in ('pending', 'posted')),
  amount_minor bigint not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  transaction_date date not null,
  authorized_date date,
  description text not null check (char_length(description) <= 500),
  merchant_name text check (char_length(merchant_name) <= 200),
  provider_category_primary text check (char_length(provider_category_primary) <= 100),
  provider_category_detailed text check (char_length(provider_category_detailed) <= 100),
  payment_channel text check (char_length(payment_channel) <= 20),
  default_category_id uuid,
  dedupe_hash text check (dedupe_hash ~ '^[0-9a-f]{64}$'),
  import_batch_id uuid,
  superseded_by uuid,
  is_removed boolean not null default false,
  removed_at timestamptz,
  provider_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, source, external_id),
  foreign key (account_id, user_id)
    references public.accounts (id, user_id) on delete cascade,
  foreign key (default_category_id, user_id)
    references public.transaction_categories (id, user_id) on delete set null (default_category_id),
  foreign key (superseded_by, user_id)
    references public.transactions (id, user_id) on delete set null (superseded_by)
);

create unique index transactions_csv_dedupe_uidx
  on public.transactions (account_id, dedupe_hash)
  where dedupe_hash is not null;
create index transactions_user_date_idx
  on public.transactions (user_id, transaction_date desc);
create index transactions_account_date_idx
  on public.transactions (account_id, transaction_date desc);
create index transactions_pending_external_idx
  on public.transactions (user_id, pending_external_id)
  where pending_external_id is not null;
create index transactions_default_category_idx on public.transactions (default_category_id);
create index transactions_superseded_idx on public.transactions (superseded_by);

-- User edits, kept separate from original bank data.
create table public.transaction_overrides (
  transaction_id uuid primary key,
  user_id uuid not null,
  category_id uuid,
  merchant_name text check (char_length(merchant_name) <= 200),
  note text check (char_length(note) <= 2000),
  exclude_from_budget boolean not null default false,
  transfer_override text check (transfer_override in ('is_transfer', 'not_transfer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (transaction_id, user_id)
    references public.transactions (id, user_id) on delete cascade,
  foreign key (category_id, user_id)
    references public.transaction_categories (id, user_id) on delete set null (category_id)
);

create index transaction_overrides_user_idx on public.transaction_overrides (user_id);
create index transaction_overrides_category_idx on public.transaction_overrides (category_id);

create table public.transfer_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  outflow_transaction_id uuid not null unique,
  inflow_transaction_id uuid not null unique,
  kind text not null check (kind in ('transfer', 'credit_card_payment')),
  detected_by text not null check (detected_by in ('rule', 'user')),
  created_at timestamptz not null default now(),
  check (outflow_transaction_id <> inflow_transaction_id),
  foreign key (outflow_transaction_id, user_id)
    references public.transactions (id, user_id) on delete cascade,
  foreign key (inflow_transaction_id, user_id)
    references public.transactions (id, user_id) on delete cascade
);

create index transfer_links_user_idx on public.transfer_links (user_id);

-- ---------------------------------------------------------------------------
-- Budgeting & planning
-- ---------------------------------------------------------------------------

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, month)
);

create table public.budget_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  budget_id uuid not null,
  category_id uuid not null,
  kind text not null check (kind in ('fixed', 'variable', 'savings', 'debt')),
  planned_minor bigint not null check (planned_minor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (budget_id, category_id),
  foreign key (budget_id, user_id)
    references public.budgets (id, user_id) on delete cascade,
  foreign key (category_id, user_id)
    references public.transaction_categories (id, user_id) on delete cascade
);

create index budget_allocations_user_idx on public.budget_allocations (user_id);
create index budget_allocations_category_idx on public.budget_allocations (category_id);

create table public.income_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  kind text not null check (kind in ('salary', 'freelance', 'benefits', 'other')),
  expected_amount_minor bigint check (expected_amount_minor is null or expected_amount_minor >= 0),
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  cadence text not null
    check (cadence in ('weekly', 'biweekly', 'semimonthly', 'monthly', 'irregular')),
  next_expected_date date,
  deposit_account_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (deposit_account_id, user_id)
    references public.accounts (id, user_id) on delete set null (deposit_account_id),
  foreign key (user_id) references auth.users (id) on delete cascade
);

create index income_sources_user_idx on public.income_sources (user_id);
create index income_sources_account_idx on public.income_sources (deposit_account_id);

create table public.recurring_bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  merchant_pattern text check (char_length(merchant_pattern) <= 120),
  amount_minor bigint not null check (amount_minor >= 0),
  amount_is_estimate boolean not null default false,
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  cadence text not null
    check (cadence in ('weekly', 'biweekly', 'monthly', 'quarterly', 'annual')),
  next_due_date date not null,
  pay_from_account_id uuid,
  category_id uuid,
  autopay boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (pay_from_account_id, user_id)
    references public.accounts (id, user_id) on delete set null (pay_from_account_id),
  foreign key (category_id, user_id)
    references public.transaction_categories (id, user_id) on delete set null (category_id)
);

create index recurring_bills_user_due_idx on public.recurring_bills (user_id, next_due_date);
create index recurring_bills_account_idx on public.recurring_bills (pay_from_account_id);
create index recurring_bills_category_idx on public.recurring_bills (category_id);

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  target_minor bigint not null check (target_minor > 0),
  saved_minor bigint not null default 0 check (saved_minor >= 0),
  monthly_contribution_minor bigint not null default 0 check (monthly_contribution_minor >= 0),
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  target_date date,
  linked_account_id uuid,
  priority smallint not null default 3 check (priority between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (linked_account_id, user_id)
    references public.accounts (id, user_id) on delete set null (linked_account_id)
);

create index savings_goals_user_idx on public.savings_goals (user_id);
create index savings_goals_account_idx on public.savings_goals (linked_account_id);

create table public.debt_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid,
  name text not null check (char_length(name) between 1 and 80),
  apr_bps integer not null check (apr_bps between 0 and 10000),
  minimum_payment_minor bigint not null default 0 check (minimum_payment_minor >= 0),
  planned_payment_minor bigint not null default 0 check (planned_payment_minor >= 0),
  payment_due_day smallint check (payment_due_day between 1 and 31),
  strategy text not null default 'avalanche'
    check (strategy in ('avalanche', 'snowball', 'custom')),
  target_payoff_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, user_id)
    references public.accounts (id, user_id) on delete set null (account_id)
);

create index debt_goals_user_idx on public.debt_goals (user_id);
create index debt_goals_account_idx on public.debt_goals (account_id);

create table public.financial_forecasts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('cash_flow', 'debt_payoff', 'savings', 'safe_to_spend')),
  inputs jsonb not null,
  assumptions jsonb not null default '[]'::jsonb,
  result jsonb not null,
  data_as_of timestamptz not null,
  created_at timestamptz not null default now()
);

create index financial_forecasts_user_idx on public.financial_forecasts (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Personal CFO conversations
-- ---------------------------------------------------------------------------

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text check (char_length(title) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index ai_conversations_user_idx on public.ai_conversations (user_id, updated_at desc);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  conversation_id uuid not null,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null check (char_length(content) <= 20000),
  tool_name text check (char_length(tool_name) <= 64),
  created_at timestamptz not null default now(),
  foreign key (conversation_id, user_id)
    references public.ai_conversations (id, user_id) on delete cascade
);

create index ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);
create index ai_messages_user_idx on public.ai_messages (user_id);

-- ---------------------------------------------------------------------------
-- Sync history, webhooks, audit
-- ---------------------------------------------------------------------------

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  connection_id uuid not null,
  trigger text not null check (trigger in ('initial', 'webhook', 'manual', 'scheduled')),
  status text not null check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  added_count integer not null default 0,
  modified_count integer not null default 0,
  removed_count integer not null default 0,
  cursor_before text,
  cursor_after text,
  error_code text check (char_length(error_code) <= 100),
  foreign key (connection_id, user_id)
    references public.bank_connections (id, user_id) on delete cascade
);

create index sync_runs_connection_idx on public.sync_runs (connection_id, started_at desc);
create index sync_runs_user_idx on public.sync_runs (user_id);

-- Webhook idempotency log. No policies: service role only.
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('plaid')),
  body_sha256 text not null unique check (body_sha256 ~ '^[0-9a-f]{64}$'),
  webhook_type text not null,
  webhook_code text not null,
  provider_item_id text,
  status text not null default 'received'
    check (status in ('received', 'processed', 'ignored', 'failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

-- Append-only audit log. user_id deliberately has no FK so history survives
-- account deletion; rows are immutable (see trigger below).
create table public.audit_events (
  id bigint generated always as identity primary key,
  user_id uuid,
  actor text not null check (actor in ('user', 'system', 'ai')),
  action text not null check (char_length(action) <= 80),
  entity_type text check (char_length(entity_type) <= 40),
  entity_id text check (char_length(entity_id) <= 80),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_user_idx on public.audit_events (user_id, created_at desc);

create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_events is append-only';
end;
$$;

create trigger audit_events_immutable
  before update or delete on public.audit_events
  for each row execute function public.prevent_audit_mutation();

-- Lets an authenticated user append an audit event attributed to themselves.
create or replace function public.log_audit_event(
  p_action text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.audit_events (user_id, actor, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'user', p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'institutions', 'bank_connections', 'accounts',
    'transaction_categories', 'transactions', 'transaction_overrides',
    'budgets', 'budget_allocations', 'income_sources', 'recurring_bills',
    'savings_goals', 'debt_goals', 'ai_conversations'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- New-user bootstrap: profile + default categories
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);

  insert into public.transaction_categories (user_id, name, kind, is_essential, is_system)
  values
    (new.id, 'Paycheck',            'income',   false, true),
    (new.id, 'Other income',        'income',   false, true),
    (new.id, 'Interest',            'income',   false, true),
    (new.id, 'Refunds',             'income',   false, true),
    (new.id, 'Transfer',            'transfer', false, true),
    (new.id, 'Credit card payment', 'transfer', false, true),
    (new.id, 'Savings',             'transfer', false, true),
    (new.id, 'Housing',             'expense',  true,  true),
    (new.id, 'Utilities',           'expense',  true,  true),
    (new.id, 'Groceries',           'expense',  true,  true),
    (new.id, 'Transportation',      'expense',  true,  true),
    (new.id, 'Insurance',           'expense',  true,  true),
    (new.id, 'Health',              'expense',  true,  true),
    (new.id, 'Dining',              'expense',  false, true),
    (new.id, 'Shopping',            'expense',  false, true),
    (new.id, 'Subscriptions',       'expense',  false, true),
    (new.id, 'Personal care',       'expense',  false, true),
    (new.id, 'Entertainment',       'expense',  false, true),
    (new.id, 'Travel',              'expense',  false, true),
    (new.id, 'Gifts & donations',   'expense',  false, true),
    (new.id, 'Fees',                'expense',  false, true),
    (new.id, 'Education',           'expense',  false, true),
    (new.id, 'Uncategorized',       'expense',  false, true);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
