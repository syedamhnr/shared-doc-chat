
-- Move vector extension to the extensions schema (linter fix)
-- The extension was created in public; re-create it in the dedicated extensions schema.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector SCHEMA extensions;

-- Make the vector type resolvable from public queries without schema-prefix
-- (Grant usage so public search_path still finds vector operators)
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;
