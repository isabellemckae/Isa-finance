-- Fixtures for the PostgREST integration tests (fictional). Inserted as superuser,
-- standing in for the server-side Plaid sync that arrives in Phase 4.
insert into auth.users (id, email) values
  ('aaaaaaaa-1111-4000-8000-000000000001', 'owner@example.test'),
  ('bbbbbbbb-2222-4000-8000-000000000002', 'other@example.test'),
  -- Used only by the Plaid store tests, so their links don't affect the repository tests.
  ('cccccccc-3333-4000-8000-000000000003', 'plaid@example.test');

insert into public.institutions (id, name) values
  ('11111111-2222-4000-8000-000000000000', 'Fictional Test Bank');

insert into public.bank_connections (id, user_id, institution_id, provider, provider_item_id, status, last_successful_sync_at)
values ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-1111-4000-8000-000000000001',
        '11111111-2222-4000-8000-000000000000', 'plaid', 'item-it-a', 'login_required', now() - interval '3 hours');

insert into public.accounts (id, user_id, connection_id, source, provider_account_id, type, subtype, name, mask)
values ('dddddddd-0000-4000-8000-000000000001', 'aaaaaaaa-1111-4000-8000-000000000001',
        'cccccccc-0000-4000-8000-000000000001', 'plaid', 'acct-it-a', 'depository', 'checking', 'Linked Checking', '4321');

insert into public.balance_snapshots (user_id, account_id, current_minor, available_minor, currency, as_of, source) values
  ('aaaaaaaa-1111-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', 100000, 90000, 'USD', now() - interval '2 days', 'institution'),
  ('aaaaaaaa-1111-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', 250000, 240000, 'USD', now() - interval '3 hours', 'institution');

insert into public.transactions (id, user_id, account_id, source, external_id, status, amount_minor, currency, transaction_date, description)
values ('eeeeeeee-0000-4000-8000-000000000001', 'aaaaaaaa-1111-4000-8000-000000000001',
        'dddddddd-0000-4000-8000-000000000001', 'plaid', 'plaid-tx-1', 'posted', -4512, 'USD', current_date, 'FERN & FIG MARKET');
