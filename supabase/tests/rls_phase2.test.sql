-- Phase 2 data-access tests. Runs after rls.test.sql in the same database and
-- reuses its fixtures (users A and B, tests.* helpers, tests.b_ids).

\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

-- anon cannot call any Phase 2 function.
set role anon;
select tests.expect_error($$select public.ensure_budget('2026-01-01')$$, '42501', 'anon cannot ensure_budget');
select tests.expect_error($$select public.import_transactions(gen_random_uuid(), gen_random_uuid(), '[]')$$,
  '42501', 'anon cannot import');
select tests.expect_error($$select * from public.account_latest_balances$$, '42501', 'anon cannot read balances view');
reset role;

set role authenticated;
set request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- Latest balances view respects RLS
-- ---------------------------------------------------------------------------
select tests.assert(
  (select count(*) from public.account_latest_balances where user_id is distinct from auth.uid()) = 0,
  'latest balances: no other-user rows');
select tests.assert(
  (select count(*) from public.account_latest_balances) > 0, 'latest balances: own rows visible');
select tests.expect_error(
  $$insert into public.account_latest_balances (account_id) values (gen_random_uuid())$$,
  '55000', 'balances view is read-only (not updatable)');

-- ---------------------------------------------------------------------------
-- Manual accounts
-- ---------------------------------------------------------------------------
create temp table t_ids (name text primary key, id uuid);
grant all on t_ids to authenticated;

insert into t_ids
select 'manual', public.create_manual_account('Piggy bank', 'depository', 'cash', 'USD', 'Coins', 12345, null);
insert into t_ids
select 'store_card', public.create_manual_account('Store card', 'credit', 'credit card', 'USD', null, 2000, 50000);

select tests.assert(
  (select count(*) from public.accounts a join t_ids t on t.id = a.id
    where a.user_id = auth.uid() and a.source = 'manual') = 2,
  'manual accounts owned by caller');
select tests.assert(
  (select available_minor from public.account_latest_balances
    where account_id = (select id from t_ids where name = 'manual')) = 12345,
  'manual depository opening balance');
select tests.assert(
  (select available_minor from public.account_latest_balances
    where account_id = (select id from t_ids where name = 'store_card')) = 48000,
  'manual credit available credit = limit - owed');
select tests.expect_error(
  $$select public.create_manual_account('x', 'spaceship', null, 'USD', null, 0, null)$$,
  '23514', 'account type validated by check constraint');

-- ---------------------------------------------------------------------------
-- CSV import
-- ---------------------------------------------------------------------------
select tests.assert(
  public.import_transactions(
    (select id from t_ids where name = 'manual'), gen_random_uuid(),
    jsonb_build_array(
      jsonb_build_object('date', '2026-10-01', 'amount_minor', -450, 'description', 'Coffee',
                         'dedupe_hash', repeat('1', 64)),
      jsonb_build_object('date', '2026-10-01', 'amount_minor', -450, 'description', 'Coffee',
                         'dedupe_hash', repeat('2', 64),
                         'category_id', (select id::text from public.transaction_categories where name = 'Dining'))
    )) = 2,
  'import inserts new rows');
select tests.assert(
  public.import_transactions(
    (select id from t_ids where name = 'manual'), gen_random_uuid(),
    jsonb_build_array(
      jsonb_build_object('date', '2026-10-01', 'amount_minor', -450, 'description', 'Coffee',
                         'dedupe_hash', repeat('1', 64)))) = 0,
  're-import is idempotent');
select tests.assert(
  (select count(*) from public.transactions where source = 'csv' and user_id = auth.uid()) = 2,
  'imported rows owned by caller, flagged csv');
select tests.expect_error(
  $$select public.import_transactions((select account from tests.b_ids), gen_random_uuid(),
      jsonb_build_array(jsonb_build_object('date','2026-10-01','amount_minor',-1,'description','x',
                                           'dedupe_hash', repeat('3', 64))))$$,
  '42501', 'cannot import into another user account');
select tests.expect_error(
  $$select public.import_transactions((select id from t_ids where name = 'manual'), gen_random_uuid(),
      jsonb_build_array(jsonb_build_object('date','2026-10-01','amount_minor',-1,'description','x',
                         'dedupe_hash', repeat('4', 64), 'category_id', (select category::text from tests.b_ids))))$$,
  '23503', 'cannot import with another user category');
select tests.expect_error(
  $$select public.import_transactions((select id from t_ids where name = 'manual'), gen_random_uuid(),
      jsonb_build_array(jsonb_build_object('date','2026-10-01','amount_minor',-1,'description','x',
                         'dedupe_hash', 'not-a-hash')))$$,
  '23514', 'dedupe hash format enforced');

-- ---------------------------------------------------------------------------
-- Budgets
-- ---------------------------------------------------------------------------
select public.upsert_budget_allocation('2030-01-01',
  (select id from public.transaction_categories where name = 'Groceries'), 'variable', 50000);
select public.upsert_budget_allocation('2030-01-01',
  (select id from public.transaction_categories where name = 'Groceries'), 'variable', 65000);
select tests.assert(
  (select planned_minor from public.budget_allocations a join public.budgets b on b.id = a.budget_id
    where b.month = '2030-01-01') = 65000,
  'allocation upsert updates in place');
select tests.assert(
  (select count(*) from public.budgets where month = '2030-01-01') = 1, 'one budget per month');
select tests.expect_error(
  $$select public.upsert_budget_allocation('2030-01-01', (select category from tests.b_ids), 'variable', 1)$$,
  '23503', 'cannot allocate another user category');
select tests.expect_error(
  $$select public.upsert_budget_allocation('2030-01-15', (select id from public.transaction_categories where name = 'Dining'), 'variable', 1)$$,
  '23514', 'budget month must be the first of the month');
select tests.expect_error(
  $$select public.upsert_budget_allocation('2030-01-01', (select id from public.transaction_categories where name = 'Dining'), 'variable', -1)$$,
  '23514', 'planned amount cannot be negative');

select tests.assert(public.copy_budget('2030-01-01', '2030-02-01') = 1, 'copy budget copies allocations');
select tests.assert(public.copy_budget('2030-01-01', '2030-02-01') = 0, 'copy budget is idempotent');

reset role;
reset request.jwt.claims;

-- User B sees none of A's Phase 2 rows.
set role authenticated;
set request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
select tests.assert((select count(*) from public.budgets where month >= '2030-01-01') = 0,
  'B cannot see A budgets');
select tests.assert((select count(*) from public.transactions where source = 'csv') = 0,
  'B cannot see A imports');
select tests.assert((select count(*) from public.accounts where name = 'Piggy bank') = 0,
  'B cannot see A manual accounts');
reset role;
reset request.jwt.claims;

\o
\echo 'Phase 2 RLS tests passed'
