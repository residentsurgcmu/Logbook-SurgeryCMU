-- Grand Rounds HN: install empty private storage only.
-- No deployed UI, API, operators, cases, key material, or HN data.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create schema rc_hn_prod_private;
revoke all on schema rc_hn_prod_private from public, anon, authenticated, service_role, authenticator;

create table rc_hn_prod_private.public_keys (
  spki bytea not null check (octet_length(spki) between 400 and 450),
  key_id text generated always as (encode(sha256(spki), 'hex')) stored primary key,
  registered_at timestamptz not null default now()
);

create table rc_hn_prod_private.pilot_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  key_id text not null references rc_hn_prod_private.public_keys(key_id)
);

create table rc_hn_prod_private.pilot_cases (
  case_id uuid primary key references public.resident_admission_cases(id) on delete cascade
);

create table rc_hn_prod_private.records (
  case_id uuid primary key references rc_hn_prod_private.pilot_cases(case_id) on delete cascade,
  key_id text not null references rc_hn_prod_private.public_keys(key_id),
  ciphertext bytea not null check (octet_length(ciphertext) = 384),
  revision integer not null check (revision > 0)
);
create index rc_hn_prod_records_key_idx on rc_hn_prod_private.records(key_id);

alter table rc_hn_prod_private.public_keys enable row level security;
alter table rc_hn_prod_private.pilot_config enable row level security;
alter table rc_hn_prod_private.pilot_cases enable row level security;
alter table rc_hn_prod_private.records enable row level security;

revoke all on all tables in schema rc_hn_prod_private
  from public, anon, authenticated, service_role, authenticator;

-- Abort on unexpected inherited/default grants. No policy or RPC exposes this schema.
do $$
begin
  if exists (
    select 1 from (values ('anon'),('authenticated'),('service_role'),('authenticator')) as clients(role)
    where has_schema_privilege(clients.role, 'rc_hn_prod_private', 'USAGE,CREATE')
      or exists (
        select 1 from pg_class c
        where c.relnamespace = 'rc_hn_prod_private'::regnamespace and c.relkind = 'r'
          and (has_table_privilege(clients.role, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            or has_any_column_privilege(clients.role, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
      )
  ) then raise exception 'HN_FOUNDATION_UNEXPECTED_GRANT'; end if;
end;
$$;
commit;
