#!/usr/bin/env bash
# Integration tests for the Supabase repository against a REAL PostgREST + Postgres
# stack with all migrations and RLS applied. Nothing here touches a hosted project.
#
# Requirements: local PostgreSQL 15+ reachable via PG* env vars as a superuser,
# and Docker (pulls postgrest/postgrest). All credentials are random per run.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="isa_finance_it_$$"
PORT="${POSTGREST_PORT:-3901}"
CONTAINER="isa-postgrest-$$"
SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
PW="$(node -e 'console.log(require("crypto").randomBytes(16).toString("hex"))')"
PGHOST_FOR_CONTAINER="${PGHOST_FOR_CONTAINER:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  dropdb --if-exists "$DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql -v ON_ERROR_STOP=1 -q -d postgres <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
end \$\$;
alter role authenticator with password '$PW';
grant anon, authenticated, service_role to authenticator;
SQL

createdb "$DB"
grep -v '^create role' supabase/tests/supabase-stub.sql | psql -v ON_ERROR_STOP=1 -q -d "$DB"
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"; done
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/integration-seed.sql

docker run -d --rm --name "$CONTAINER" --network host \
  -e PGRST_DB_URI="postgres://authenticator:$PW@$PGHOST_FOR_CONTAINER:$PGPORT/$DB" \
  -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET="$SECRET" \
  -e PGRST_SERVER_PORT="$PORT" \
  postgrest/postgrest:v12.2.3 >/dev/null

for _ in $(seq 1 40); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/" && break
  sleep 0.5
done

ISA_IT_POSTGREST_URL="http://127.0.0.1:$PORT" ISA_IT_JWT_SECRET="$SECRET" \
  npx vitest run --config vitest.integration.mts
