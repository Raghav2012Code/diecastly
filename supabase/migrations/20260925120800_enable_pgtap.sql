-- pgTAP is used by `supabase test db` for database invariant tests.
-- It is harmless in production and unused there; it exists so the test suite
-- can run against a local database.

create extension if not exists pgtap with schema extensions;
