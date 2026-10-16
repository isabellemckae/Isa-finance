#!/usr/bin/env bash
# Applies all migrations to a fresh throwaway database and runs the RLS tests.
# Requires a local PostgreSQL (15+) superuser connection via standard PG* env
# vars (PGHOST, PGPORT, PGUSER, PGPASSWORD). Never point this at a real
# Supabase project: it creates stub roles and an auth schema.
set -euo pipefail

cd "$(dirname "$0")/.."
DB="isa_finance_test_$$"

cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Roles are cluster-wide; create them once if missing.
psql -v ON_ERROR_STOP=1 -q -d postgres <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls; end if;
end $$;
SQL

createdb "$DB"
# Strip role creation from the stub (handled above) and apply the rest.
grep -v '^create role' tests/supabase-stub.sql | psql -v ON_ERROR_STOP=1 -q -d "$DB"
for f in migrations/*.sql; do
  echo "applying $f"
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"
done
# Test files share one database and run in name order (rls.test.sql seeds fixtures).
for f in tests/*.test.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"
done
