-- Phase 4 tests: Plaid link/sync/disconnect functions (service role only), atomic
-- cursor handling, idempotent replays, pending → posted, and owner visibility.
-- Runs after the earlier suites in the same database (users A and B exist).

\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

-- Ciphertext in our format (contents are irrelevant to the database).
\set ct '''v1.k1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBB'''
\set conn '''cccccccc-0000-4000-8000-000000000001'''
\set userA '''aaaaaaaa-0000-0000-0000-000000000001'''
\set userB '''aaaaaaaa-0000-0000-0000-000000000002'''

-- Neither anon nor authenticated users can call the privileged functions.
set role anon;
select tests.expect_error(
  format('select public.create_plaid_connection(%L, %L, %L, null, null, %L, %L, null)', :conn, :userA, 'item-x', 'k1', :ct),
  '42501', 'anon cannot create connections');
reset role;

set role authenticated;
set request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select tests.expect_error(
  format('select public.create_plaid_connection(%L, %L, %L, null, null, %L, %L, null)', :conn, :userA, 'item-x', 'k1', :ct),
  '42501', 'users cannot create connections directly');
select tests.expect_error(
  format('select public.apply_plaid_sync(%L, null, %L, %L)', :conn, 'c1', '{}'),
  '42501', 'users cannot apply syncs');
select tests.expect_error(
  format('select public.disconnect_plaid_connection(%L)', :conn), '42501', 'users cannot call disconnect directly');
reset role;

-- ---------------------------------------------------------------------------
-- As the service role
-- ---------------------------------------------------------------------------
set role service_role;

select tests.expect_error(
  format('select public.create_plaid_connection(%L, %L, %L, null, null, %L, %L, null)', :conn, :userA, 'item-x', 'k1',
         'access-sandbox-plaintext-token'),
  '22023', 'plaintext tokens are refused');

select public.create_plaid_connection(:conn, :userA, 'item-sandbox-1', 'ins_109508', 'First Platypus Bank', 'k1', :ct, null);

select tests.assert(
  (select environment = 'sandbox' and status = 'active' and user_id = :userA from public.bank_connections where id = :conn),
  'connection created for A in sandbox');
select tests.assert(
  (select count(*) = 1 from public.bank_connection_secrets where connection_id = :conn and key_id = 'k1'),
  'secret stored with key id');
select tests.expect_error(
  format('select public.create_plaid_connection(%L, %L, %L, null, null, %L, %L, null)',
         'cccccccc-0000-4000-8000-000000000009', :userB, 'item-sandbox-1', 'k1', :ct),
  '23505', 'an Item cannot be linked twice');

-- First sync: two accounts, balances, three transactions (one pending).
select tests.assert(
  public.apply_plaid_sync(:conn, null, 'cursor-1', $json${
    "accounts": [
      {"provider_account_id": "acc-chk", "type": "depository", "subtype": "checking", "name": "Plaid Checking", "official_name": null, "mask": "0000", "currency": "USD"},
      {"provider_account_id": "acc-card", "type": "credit", "subtype": "credit card", "name": "Plaid Credit Card", "official_name": null, "mask": "3333", "currency": "USD"}
    ],
    "balances": [
      {"provider_account_id": "acc-chk", "current_minor": 11000, "available_minor": 10000, "credit_limit_minor": null, "currency": "USD", "as_of": "2026-10-16T10:00:00Z"},
      {"provider_account_id": "acc-card", "current_minor": 41000, "available_minor": 660000, "credit_limit_minor": 700000, "currency": "USD", "as_of": "2026-10-16T10:00:00Z"}
    ],
    "added": [
      {"external_id": "p-tx-1", "provider_account_id": "acc-chk", "pending_external_id": null, "status": "posted", "amount_minor": -1234, "currency": "USD", "transaction_date": "2026-10-15", "authorized_date": null, "description": "Groceries", "merchant_name": "Market", "provider_category_primary": "FOOD_AND_DRINK", "provider_category_detailed": "FOOD_AND_DRINK_GROCERIES", "payment_channel": "in store", "category_name": "Groceries"},
      {"external_id": "p-tx-2", "provider_account_id": "acc-card", "pending_external_id": null, "status": "posted", "amount_minor": -5000, "currency": "USD", "transaction_date": "2026-10-14", "authorized_date": null, "description": "Shoes", "merchant_name": null, "provider_category_primary": null, "provider_category_detailed": null, "payment_channel": null, "category_name": null},
      {"external_id": "p-pend-3", "provider_account_id": "acc-chk", "pending_external_id": null, "status": "pending", "amount_minor": -800, "currency": "USD", "transaction_date": "2026-10-16", "authorized_date": null, "description": "Cafe", "merchant_name": "Cafe", "provider_category_primary": null, "provider_category_detailed": null, "payment_channel": null, "category_name": "Dining"},
      {"external_id": "p-orphan", "provider_account_id": "acc-unknown", "pending_external_id": null, "status": "posted", "amount_minor": -1, "currency": "USD", "transaction_date": "2026-10-16", "authorized_date": null, "description": "x", "merchant_name": null, "provider_category_primary": null, "provider_category_detailed": null, "payment_channel": null, "category_name": null}
    ],
    "modified": [], "removed": []
  }$json$::jsonb) = '{"accounts": 2, "added": 3, "modified": 0, "removed": 0}'::jsonb,
  'first sync counts (orphaned transaction skipped)');

select tests.assert(
  (select count(*) = 3 from public.transactions where user_id = :userA and external_id like 'p-%'),
  'three Plaid transactions stored for A');
select tests.assert(
  (select c.name = 'Groceries' from public.transactions t join public.transaction_categories c on c.id = t.default_category_id
    where t.external_id = 'p-tx-1'),
  'category matched by name within the user''s categories');
select tests.assert(
  (select transactions_cursor = 'cursor-1' and last_successful_sync_at is not null from public.bank_connections where id = :conn),
  'cursor committed with the data');
select tests.assert(
  (select current_minor = 41000 and credit_limit_minor = 700000 from public.balance_snapshots b
    join public.accounts a on a.id = b.account_id where a.provider_account_id = 'acc-card'),
  'credit balance stored as amount owed with limit');

-- A stale cursor is rejected and nothing changes.
select tests.expect_error(
  format('select public.apply_plaid_sync(%L, %L, %L, %L)', :conn, 'cursor-0', 'cursor-x',
         '{"added":[{"external_id":"p-stale","provider_account_id":"acc-chk","status":"posted","amount_minor":-1,"currency":"USD","transaction_date":"2026-10-16","description":"stale"}]}'),
  'PT409', 'stale cursor rejected');
select tests.assert(
  (select count(*) = 0 from public.transactions where external_id = 'p-stale'), 'stale sync wrote nothing');

-- Replaying the same page is idempotent (same rows, no duplicates).
select public.apply_plaid_sync(:conn, 'cursor-1', 'cursor-1', $json${
  "accounts": [], "balances": [], "modified": [], "removed": [],
  "added": [{"external_id": "p-tx-1", "provider_account_id": "acc-chk", "pending_external_id": null, "status": "posted", "amount_minor": -1234, "currency": "USD", "transaction_date": "2026-10-15", "authorized_date": null, "description": "Groceries", "merchant_name": "Market", "provider_category_primary": null, "provider_category_detailed": null, "payment_channel": null, "category_name": "Groceries"}]
}$json$::jsonb);
select tests.assert(
  (select count(*) = 1 from public.transactions where external_id = 'p-tx-1'), 'replay did not duplicate');

-- User edits the pending transaction, then it posts: the edit carries over.
insert into public.transaction_overrides (transaction_id, user_id, note)
select id, user_id, 'Coffee with Sam' from public.transactions where external_id = 'p-pend-3';

select tests.assert(
  public.apply_plaid_sync(:conn, 'cursor-1', 'cursor-2', $json${
    "accounts": [], "balances": [],
    "added": [{"external_id": "p-post-3", "provider_account_id": "acc-chk", "pending_external_id": "p-pend-3", "status": "posted", "amount_minor": -850, "currency": "USD", "transaction_date": "2026-10-16", "authorized_date": null, "description": "Cafe", "merchant_name": "Cafe", "provider_category_primary": null, "provider_category_detailed": null, "payment_channel": null, "category_name": "Dining"}],
    "modified": [{"external_id": "p-tx-2", "provider_account_id": "acc-card", "pending_external_id": null, "status": "posted", "amount_minor": -4500, "currency": "USD", "transaction_date": "2026-10-14", "authorized_date": null, "description": "Shoes (adjusted)", "merchant_name": null, "provider_category_primary": null, "provider_category_detailed": null, "payment_channel": null, "category_name": "Shopping"}],
    "removed": ["p-pend-3", "p-tx-1", "someone-elses-tx"]
  }$json$::jsonb) = '{"accounts": 0, "added": 1, "modified": 1, "removed": 2}'::jsonb,
  'incremental sync counts');

select tests.assert(
  (select p.superseded_by = n.id and p.is_removed from public.transactions p, public.transactions n
    where p.external_id = 'p-pend-3' and n.external_id = 'p-post-3'),
  'pending superseded by posted');
select tests.assert(
  (select o.note = 'Coffee with Sam' from public.transaction_overrides o join public.transactions t on t.id = o.transaction_id
    where t.external_id = 'p-post-3'),
  'user edits carried over to the posted transaction');
select tests.assert(
  (select amount_minor = -4500 and description = 'Shoes (adjusted)' from public.transactions where external_id = 'p-tx-2'),
  'modified transaction updated');
select tests.assert(
  (select is_removed and removed_at is not null from public.transactions where external_id = 'p-tx-1'),
  'removed transaction flagged, not deleted');

-- A sync for A's connection can never write rows for B, and B's data is untouched.
select tests.assert(
  (select count(*) = 0 from public.transactions where user_id = :userB and external_id like 'p-%'),
  'nothing written for B');
reset role;

-- ---------------------------------------------------------------------------
-- What the owner (and the other user) can see
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select tests.assert(
  (select count(*) = 1 from public.bank_connections where id = 'cccccccc-0000-4000-8000-000000000001'),
  'A sees the connection');
select tests.assert(
  (select count(*) = 4 from public.transactions where external_id like 'p-%'), 'A sees synced transactions');
select tests.expect_error($$select * from public.bank_connection_secrets$$, '42501', 'A cannot read token ciphertext');
select tests.expect_error($$select * from public.webhook_events$$, '42501', 'A cannot read webhook log');
select tests.expect_error(
  $$update public.bank_connections set status = 'active' where id = 'cccccccc-0000-4000-8000-000000000001'$$,
  '42501', 'A cannot change connection status directly');
select tests.expect_error(
  $$update public.bank_connections set transactions_cursor = null where id = 'cccccccc-0000-4000-8000-000000000001'$$,
  '42501', 'A cannot reset the cursor');

set request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}';
select tests.assert(
  (select count(*) = 0 from public.bank_connections where id = 'cccccccc-0000-4000-8000-000000000001'),
  'B cannot see A''s connection');
select tests.assert(
  (select count(*) = 0 from public.transactions where external_id like 'p-%'), 'B cannot see A''s Plaid transactions');
select tests.assert(
  (select count(*) = 0 from public.sync_runs where connection_id = 'cccccccc-0000-4000-8000-000000000001'),
  'B cannot see A''s sync runs');
reset role;

-- ---------------------------------------------------------------------------
-- Disconnect
-- ---------------------------------------------------------------------------
set role service_role;
select public.disconnect_plaid_connection(:conn);
select tests.assert(
  (select status = 'disconnected' and transactions_cursor is null from public.bank_connections where id = :conn),
  'connection marked disconnected and cursor cleared');
select tests.assert(
  (select count(*) = 0 from public.bank_connection_secrets where connection_id = :conn), 'token deleted');
select tests.assert(
  (select count(*) = 4 from public.transactions where user_id = :userA and external_id like 'p-%'), 'history kept');
select tests.expect_error(
  format('select public.apply_plaid_sync(%L, null, %L, %L)', :conn, 'c9', '{}'),
  '55000', 'disconnected connections cannot sync');
reset role;

\o
\echo 'Phase 4 Plaid tests passed'
