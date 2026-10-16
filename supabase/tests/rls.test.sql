-- RLS / ownership tests. Run with `npm run test:db` (see run-db-tests.sh).
-- Two users (A, B) each own a full set of rows; every assertion checks that
-- A can reach only A's data, and only through the allowed operations.

\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

-- ---------------------------------------------------------------------------
-- Test helpers
-- ---------------------------------------------------------------------------

create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

create function tests.assert(condition boolean, message text) returns void
language plpgsql as $$
begin
  if condition is distinct from true then
    raise exception 'ASSERTION FAILED: %', message;
  end if;
end;
$$;

-- Runs sql as the current role and asserts it fails with the given SQLSTATE.
create function tests.expect_error(sql text, expected_state text, message text) returns void
language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlstate = expected_state then
      return;
    end if;
    raise exception 'ASSERTION FAILED: % (expected SQLSTATE %, got % - %)',
      message, expected_state, sqlstate, sqlerrm;
  end;
  raise exception 'ASSERTION FAILED: % (statement succeeded, expected SQLSTATE %)',
    message, expected_state;
end;
$$;

-- Runs sql and returns the number of affected rows.
create function tests.affected(sql text) returns bigint
language plpgsql as $$
declare
  n bigint;
begin
  execute sql;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as superuser, standing in for the service role)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test');

insert into public.institutions (id, name) values
  ('11111111-0000-0000-0000-000000000000', 'Fictional Test Bank');

create function tests.seed(uid uuid, tag text) returns void
language plpgsql as $$
declare
  conn uuid := gen_random_uuid();
  acct uuid := gen_random_uuid();
  card uuid := gen_random_uuid();
  manual_acct uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid();
  t2 uuid := gen_random_uuid();
  bud uuid := gen_random_uuid();
  conv uuid := gen_random_uuid();
  groceries uuid;
begin
  select id into groceries from public.transaction_categories
   where user_id = uid and name = 'Groceries';

  insert into public.bank_connections (id, user_id, institution_id, provider, provider_item_id)
  values (conn, uid, '11111111-0000-0000-0000-000000000000', 'plaid', 'item-' || tag);
  insert into public.bank_connection_secrets (connection_id, user_id, access_token_ciphertext, key_id)
  values (conn, uid, 'v1:ciphertext-' || tag, 'k1');

  insert into public.accounts (id, user_id, connection_id, source, provider_account_id, type, name, mask)
  values (acct, uid, conn, 'plaid', 'acct-' || tag, 'depository', 'Checking ' || tag, '1234'),
         (card, uid, conn, 'plaid', 'card-' || tag, 'credit', 'Card ' || tag, '9876');
  insert into public.accounts (id, user_id, source, type, name)
  values (manual_acct, uid, 'manual', 'depository', 'Cash ' || tag);

  insert into public.balance_snapshots (user_id, account_id, current_minor, available_minor, currency, as_of, source)
  values (uid, acct, 100000, 95000, 'USD', now(), 'institution');

  insert into public.transactions (id, user_id, account_id, source, external_id, status, amount_minor,
                                   currency, transaction_date, description, default_category_id)
  values (t1, uid, acct, 'plaid', 'tx1-' || tag, 'posted', -4512, 'USD', current_date, 'Grocer', groceries),
         (t2, uid, card, 'plaid', 'tx2-' || tag, 'posted', 4512, 'USD', current_date, 'Payment', null);

  insert into public.transaction_overrides (transaction_id, user_id, note)
  values (t1, uid, 'note ' || tag);
  insert into public.transfer_links (user_id, outflow_transaction_id, inflow_transaction_id, kind, detected_by)
  values (uid, t1, t2, 'credit_card_payment', 'rule');

  insert into public.budgets (id, user_id, month) values (bud, uid, date_trunc('month', current_date)::date);
  insert into public.budget_allocations (user_id, budget_id, category_id, kind, planned_minor)
  values (uid, bud, groceries, 'variable', 60000);

  insert into public.income_sources (user_id, name, kind, cadence) values (uid, 'Job ' || tag, 'salary', 'biweekly');
  insert into public.recurring_bills (user_id, name, amount_minor, cadence, next_due_date)
  values (uid, 'Rent ' || tag, 150000, 'monthly', current_date + 5);
  insert into public.savings_goals (user_id, name, target_minor) values (uid, 'Fund ' || tag, 500000);
  insert into public.debt_goals (user_id, account_id, name, apr_bps) values (uid, card, 'Card ' || tag, 2299);
  insert into public.financial_forecasts (user_id, kind, inputs, result, data_as_of)
  values (uid, 'cash_flow', '{}', '{}', now());
  insert into public.ai_conversations (id, user_id, title) values (conv, uid, 'Chat ' || tag);
  insert into public.ai_messages (user_id, conversation_id, role, content) values (uid, conv, 'user', 'hi');
  insert into public.sync_runs (user_id, connection_id, trigger, status) values (uid, conn, 'initial', 'succeeded');
  insert into public.audit_events (user_id, actor, action) values (uid, 'system', 'seeded');
end;
$$;

select tests.seed('aaaaaaaa-0000-0000-0000-000000000001', 'A');
select tests.seed('bbbbbbbb-0000-0000-0000-000000000002', 'B');
insert into public.webhook_events (provider, body_sha256, webhook_type, webhook_code)
values ('plaid', repeat('a', 64), 'TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE');

-- An extra B transaction with no override / transfer link attached.
insert into public.transactions (user_id, account_id, source, external_id, status, amount_minor,
                                 currency, transaction_date, description)
select user_id, id, 'plaid', 'tx3-B', 'posted', -999, 'USD', current_date, 'Coffee'
  from public.accounts where provider_account_id = 'acct-B';

-- Ids of B's rows, so A-side tests can try to reference them directly.
create table tests.b_ids as
select
  (select id from public.transactions where external_id = 'tx3-B') as tx,
  (select id from public.accounts where provider_account_id = 'acct-B') as account,
  (select id from public.budgets where user_id = 'bbbbbbbb-0000-0000-0000-000000000002') as budget,
  (select id from public.transaction_categories
    where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' and name = 'Groceries') as category,
  (select id from public.ai_conversations where user_id = 'bbbbbbbb-0000-0000-0000-000000000002') as conversation;
grant select on tests.b_ids to authenticated;

-- Bootstrap trigger created profile + categories for both users.
select tests.assert((select count(*) from public.profiles) = 2, 'profiles bootstrapped');
select tests.assert(
  (select count(*) from public.transaction_categories where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 23,
  'default categories seeded');

-- ---------------------------------------------------------------------------
-- anon: no access at all
-- ---------------------------------------------------------------------------

set role anon;
select tests.expect_error('select * from public.transactions', '42501', 'anon cannot read transactions');
select tests.expect_error('select * from public.accounts', '42501', 'anon cannot read accounts');
select tests.expect_error('select * from public.profiles', '42501', 'anon cannot read profiles');
select tests.expect_error('select * from public.institutions', '42501', 'anon cannot read institutions');
select tests.expect_error($$select public.log_audit_event('x')$$, '42501', 'anon cannot log audit events');
reset role;

-- ---------------------------------------------------------------------------
-- authenticated as user A
-- ---------------------------------------------------------------------------

set role authenticated;
set request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

-- Isolation: every user-owned table shows only A's rows (and A has rows).
do $$
declare
  t text;
  own bigint;
  other bigint;
begin
  foreach t in array array[
    'bank_connections', 'accounts', 'balance_snapshots', 'transaction_categories',
    'transactions', 'transaction_overrides', 'transfer_links', 'budgets',
    'budget_allocations', 'income_sources', 'recurring_bills', 'savings_goals',
    'debt_goals', 'financial_forecasts', 'ai_conversations', 'ai_messages',
    'sync_runs', 'audit_events'
  ]
  loop
    execute format('select count(*) filter (where user_id = auth.uid()),
                           count(*) filter (where user_id is distinct from auth.uid())
                      from public.%I', t)
      into own, other;
    perform tests.assert(own > 0, t || ': owner sees own rows');
    perform tests.assert(other = 0, t || ': no rows of other users visible');
  end loop;
end;
$$;

select tests.assert((select count(*) from public.profiles) = 1, 'only own profile visible');
select tests.assert((select count(*) from public.institutions) = 1, 'institutions readable');

-- Secret tables are not reachable at all.
select tests.expect_error('select * from public.bank_connection_secrets', '42501', 'secrets not readable');
select tests.expect_error('select * from public.webhook_events', '42501', 'webhook log not readable');

-- Cannot write another user's rows (RLS filters them out: 0 rows affected).
select tests.assert(tests.affected(
  $$update public.budgets set notes = 'x' where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'$$) = 0,
  'cannot update other user budget');
select tests.assert(tests.affected(
  $$delete from public.savings_goals where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'$$) = 0,
  'cannot delete other user goals');
select tests.assert(tests.affected(
  $$delete from public.transaction_overrides where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'$$) = 0,
  'cannot delete other user overrides');

-- Cannot insert rows claiming to be user B.
select tests.expect_error(
  $$insert into public.savings_goals (user_id, name, target_minor)
    values ('bbbbbbbb-0000-0000-0000-000000000002', 'evil', 100)$$,
  '42501', 'cannot insert as another user');

-- Composite FKs: cannot attach own rows to another user's parent rows (23503 = FK violation).
select tests.expect_error(
  $$insert into public.transaction_overrides (transaction_id, user_id, note)
    select tx, auth.uid(), 'hijack' from tests.b_ids$$,
  '23503', 'override cannot reference another user transaction');
select tests.expect_error(
  $$insert into public.budget_allocations (user_id, budget_id, category_id, kind, planned_minor)
    select auth.uid(), budget, (select id from public.transaction_categories where name = 'Dining'),
           'variable', 100 from tests.b_ids$$,
  '23503', 'allocation cannot reference another user budget');
select tests.expect_error(
  $$insert into public.ai_messages (user_id, conversation_id, role, content)
    select auth.uid(), conversation, 'user', 'x' from tests.b_ids$$,
  '23503', 'message cannot reference another user conversation');
select tests.expect_error(
  $$insert into public.transfer_links (user_id, outflow_transaction_id, inflow_transaction_id, kind, detected_by)
    select auth.uid(), tx, (select id from public.transactions where external_id = 'tx1-A'),
           'transfer', 'user' from tests.b_ids$$,
  '23503', 'transfer link cannot reference another user transaction');
select tests.expect_error(
  $$insert into public.transactions (user_id, account_id, source, status, amount_minor, currency,
                                     transaction_date, description)
    select auth.uid(), account, 'manual', 'posted', -100, 'USD', current_date, 'x' from tests.b_ids$$,
  '23503', 'transaction cannot be added to another user account');

-- Provider (bank) data is immutable for the user.
select tests.assert(tests.affected(
  $$update public.transactions set amount_minor = 1 where source = 'plaid'$$) = 0,
  'cannot edit bank-provided transactions');
select tests.assert(tests.affected(
  $$delete from public.transactions where source = 'plaid'$$) = 0,
  'cannot delete bank-provided transactions');
select tests.expect_error(
  $$update public.transactions set provider_data = '{}'$$,
  '42501', 'provider_data column not updatable');
select tests.expect_error(
  $$update public.transactions set user_id = 'bbbbbbbb-0000-0000-0000-000000000002'$$,
  '42501', 'transaction owner not updatable');
select tests.expect_error(
  $$insert into public.transactions (user_id, account_id, source, status, amount_minor, currency,
                                     transaction_date, description)
    select auth.uid(), id, 'plaid', 'posted', -100, 'USD', current_date, 'fake'
      from public.accounts where source = 'plaid' limit 1$$,
  '42501', 'cannot insert plaid-sourced transactions');

-- Manual transactions are fully editable by their owner.
insert into public.transactions (user_id, account_id, source, status, amount_minor, currency,
                                 transaction_date, description)
select auth.uid(), id, 'manual', 'posted', -2500, 'USD', current_date, 'Farmers market'
  from public.accounts where source = 'manual';
select tests.assert(tests.affected(
  $$update public.transactions set amount_minor = -2600 where source = 'manual'$$) = 1,
  'can edit own manual transaction');

-- Accounts: only nickname/is_hidden updatable; only manual accounts creatable.
select tests.assert(tests.affected(
  $$update public.accounts set nickname = 'Everyday' where source = 'plaid' and type = 'depository'$$) = 1,
  'can set nickname');
select tests.expect_error($$update public.accounts set name = 'x'$$, '42501', 'account name not updatable');
select tests.expect_error($$update public.accounts set mask = '0000'$$, '42501', 'account mask not updatable');
select tests.expect_error(
  $$insert into public.accounts (user_id, source, type, name) values (auth.uid(), 'plaid', 'depository', 'x')$$,
  '42501', 'cannot create plaid accounts');
select tests.assert(tests.affected(
  $$delete from public.accounts where source = 'plaid'$$) = 0,
  'cannot delete bank-linked accounts');

-- Balances: manual snapshots only for manual accounts.
select tests.expect_error(
  $$insert into public.balance_snapshots (user_id, account_id, current_minor, currency, as_of, source)
    select auth.uid(), id, 1, 'USD', now(), 'manual' from public.accounts where source = 'plaid' limit 1$$,
  '42501', 'cannot record balances for bank-linked accounts');
select tests.assert(tests.affected(
  $$insert into public.balance_snapshots (user_id, account_id, current_minor, currency, as_of, source)
    select auth.uid(), id, 5000, 'USD', now(), 'manual' from public.accounts where source = 'manual'$$) = 1,
  'can record manual balance');

-- Bank connections are read-only for the user (status, cursor are server-managed).
select tests.expect_error($$update public.bank_connections set status = 'active'$$, '42501',
  'connections not updatable by user');
select tests.expect_error($$delete from public.bank_connections$$, '42501',
  'connections not deletable by user');
select tests.expect_error($$update public.sync_runs set status = 'failed'$$, '42501',
  'sync history not updatable by user');

-- Categories: system categories are protected.
select tests.assert(tests.affected(
  $$delete from public.transaction_categories where is_system$$) = 0,
  'cannot delete system categories');
select tests.expect_error(
  $$insert into public.transaction_categories (user_id, name, kind, is_system)
    values (auth.uid(), 'Fake system', 'expense', true)$$,
  '42501', 'cannot create system categories');
select tests.assert(tests.affected(
  $$insert into public.transaction_categories (user_id, name, kind) values (auth.uid(), 'Pets', 'expense')$$) = 1,
  'can create custom category');

-- Profiles: own row only; id not updatable.
select tests.assert(tests.affected(
  $$update public.profiles set display_name = 'Isa'$$) = 1, 'can update own profile only');
select tests.expect_error($$update public.profiles set id = gen_random_uuid()$$, '42501',
  'profile id not updatable');

-- Audit log: append via function only; immutable.
select public.log_audit_event('test.event', 'profile', null, '{"k":"v"}');
select tests.assert(
  (select count(*) from public.audit_events where action = 'test.event' and user_id = auth.uid()) = 1,
  'audit event attributed to caller');
select tests.expect_error(
  $$insert into public.audit_events (user_id, actor, action) values (auth.uid(), 'user', 'forged')$$,
  '42501', 'cannot insert audit events directly');
select tests.expect_error($$update public.audit_events set action = 'x'$$, '42501',
  'cannot update audit events');
select tests.expect_error($$delete from public.audit_events$$, '42501', 'cannot delete audit events');

-- Server-managed functions are not callable by users.
select tests.expect_error($$select public.handle_new_user()$$, '42501',
  'handle_new_user not executable by users');

reset role;
reset request.jwt.claims;

-- Unauthenticated JWT-less "authenticated" role sees nothing.
set role authenticated;
select tests.assert((select count(*) from public.transactions) = 0, 'no sub claim -> no rows');
reset role;

-- Audit log is immutable even for privileged roles (trigger).
select tests.expect_error($$delete from public.audit_events$$, 'P0001', 'audit log immutable for owner role');

-- service_role bypasses RLS (used only by server-side Plaid code).
set role service_role;
select tests.assert((select count(*) from public.transactions where source = 'plaid') = 5,
  'service role sees all rows');
reset role;

\o
\echo 'RLS tests passed'
