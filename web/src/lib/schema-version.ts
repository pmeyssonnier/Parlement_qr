// Number of the last migration of supabase/migrations/ this code expects in the
// database: /api/health compares it with schema_version() (migration 010).
// tests/project.test.ts checks that it is the highest migration number. Kept
// free of dependencies for the tests.
export const SCHEMA_VERSION = 10;
