#!/usr/bin/env bash
# Migrations and SQL tests on a THROWAWAY local PostgreSQL database with
# pgvector, never on Supabase: the tests create and activate fictitious versions.
# The connection comes from the usual variables, e.g.
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres web/supabase/tests/run.sh
# It creates what Supabase provides (roles, extensions schema), applies the
# migrations in order, and checks 008 (tests/008_index_config.sql) and 010
# (tests/010_schema_version_and_quota_release.sql). Used by the job « sql » of
# .github/workflows/check.yml.
set -euo pipefail
cd "$(dirname "$0")/../.."

q() { psql -v ON_ERROR_STOP=1 -q "$@"; }

q -c "create schema if not exists extensions"
q -c "do \$\$ declare r text; begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (select from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if;
  end loop; end \$\$"

for file in supabase/migrations/00[1-7]*.sql; do
  q -f "$file" >/dev/null
  echo "Migration appliquée : $file"
done
q -f supabase/tests/008_index_config.sql
q -f supabase/migrations/009_drop_unused_vector_index.sql
echo "Migration appliquée : supabase/migrations/009_drop_unused_vector_index.sql"

# 010 refuses to apply while the HNSW index of 009 is still there, and leaves nothing behind.
q -c "create index document_passages_vector on document_passages using hnsw (embedding extensions.vector_cosine_ops)"
if out=$(q -f supabase/migrations/010_schema_version_and_quota_release.sql 2>&1); then
  echo "ÉCHEC : 010 s'est appliquée sans la migration 009"
  exit 1
fi
grep -q "Appliquer d'abord les migrations 001 à 009" <<<"$out" || { echo "ÉCHEC : message inattendu : $out"; exit 1; }
[ "$(psql -At -c "select to_regclass('public.schema_migrations') is null")" = t ] || {
  echo "ÉCHEC : la migration 010 refusée a laissé la table schema_migrations"
  exit 1
}
echo "OK  010 refuse de s'appliquer sans la migration 009, sans laisser de trace"
q -c "drop index document_passages_vector"

q -f supabase/migrations/010_schema_version_and_quota_release.sql
q -f supabase/migrations/010_schema_version_and_quota_release.sql
echo "OK  010 appliquée, puis rejouée sans erreur"
q -f supabase/tests/010_schema_version_and_quota_release.sql
echo "Tests SQL terminés."
