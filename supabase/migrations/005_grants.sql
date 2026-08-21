-- Table-level privileges were missing for the standard roles, so every query
-- (even a workspace owner's own, and the edge functions') failed with
-- "permission denied for table ...". RLS is still what actually protects rows;
-- these grants just let the roles reach the tables so RLS can be evaluated.
grant usage on schema public to anon, authenticated, service_role;

grant all privileges on all tables in schema public to anon, authenticated, service_role;
grant all privileges on all sequences in schema public to anon, authenticated, service_role;
grant all privileges on all functions in schema public to anon, authenticated, service_role;

-- Apply the same to anything created later in this schema.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
