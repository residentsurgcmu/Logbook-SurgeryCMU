-- Disposable PGlite stand-in only. No real users, Auth service, Storage service,
-- cron jobs or external HTTP. In particular there are NO public-table defaults.
create role anon nologin;
create role authenticated nologin;
create role authenticator nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create schema auth;
-- Historical migrations reference this pre-existing Dashboard helper but do
-- not define it anywhere in the repository. Model it explicitly for replay;
-- this is a rebuild limitation, not a new production function.
create schema private;
create function private.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end
$$;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}',
  raw_app_meta_data jsonb default '{}',
  created_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;
create schema storage;
create table storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text,
  name text, owner uuid, owner_id text, metadata jsonb default '{}'
);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql immutable as $$
  select (string_to_array($1, '/'))[1:array_length(string_to_array($1, '/'), 1)-1]
$$;
