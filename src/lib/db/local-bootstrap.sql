-- Local development / test bootstrap for PGlite.
-- Recreates the small subset of Supabase's platform objects that Ascend
-- migrations depend on: roles, the auth schema, auth.users and auth.uid().
-- NEVER run this against a Supabase project (it already provides these).

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
$$;

grant execute on function auth.uid() to anon, authenticated;
grant execute on function auth.role() to anon, authenticated;

-- Local-only credential store (scrypt hashes). Not part of the Supabase schema.
create schema if not exists local_auth;
create table if not exists local_auth.credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  password_hash text not null,
  created_at timestamptz not null default now()
);
revoke all on schema local_auth from anon, authenticated;

create table if not exists local_auth.migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
