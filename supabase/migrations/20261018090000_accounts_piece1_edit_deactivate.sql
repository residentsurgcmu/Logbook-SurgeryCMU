-- RC-02a-1 — Accounts piece 1: edit account + deactivate / reactivate (database side).
-- Spec: RC02a1_Accounts_Piece1_Spec_v4 (final). Decisions: D-008, D-009, D-011, D-014, D-018–D-022.
--
-- What this migration does
--   1. New audit table resident_account_events (no client access; read through an Admin RPC).
--   2. New helper private.resident_account_active() = role.active AND profile.active for the caller.
--      private.resident_role_is() and private.resident_can_evaluate() now require both flags too, so every
--      policy and function that already used them (most of the app) refuses a deactivated account.
--   3. Admin RPCs: admin_list_accounts, admin_preview_account_action, admin_update_account,
--      admin_set_account_active, admin_list_account_events; service-role RPC admin_provision_account_internal
--      used by the resident-admin Edge Function (no overwrite of an existing account, D-011).
--   4. Lock contract between deactivation and request submit / evaluate / cancel (spec 2.2 item 3).
--   5. Closes direct browser writes on resident_profiles and resident_user_roles (spec 2.5).
--   6. Adds the active check to the remaining write paths and to read paths that show other people's data (spec 2.6).
--
-- Not touched: PGY promotion, exam PGY / scores / MPL / pass-fail (D-014, D-018), attendance rows (D-020),
-- resident_evaluator_assignments privileges, legacy Year 4 / Breast tables and policies.
-- Deactivation is database-only: no Auth ban (D-022).
-- Data: the only row written is the account-write pause switch (section 0), which this migration turns ON.
-- No account, request, assessment, exam or attendance row is changed.
--
-- Release safety (G0 B-R02): from the moment this migration commits, every INSERT/UPDATE/DELETE on
-- resident_profiles, resident_user_roles and resident_staff_directory is refused for EVERY database role
-- (browser, service-role Edge Functions old or new, Admin RPCs) until the owner runs
-- supabase/manual/rc02a1_pause_off.sql after the Edge Functions are deployed and checked.
-- v3 (Option A, REL-P001): after the pause ends, DIRECT writes to those tables by client roles
-- (anon, authenticated, authenticator, service_role) stay refused for good, so a request of the OLD
-- resident-admin Edge Function (direct service-role upsert) can never write, even if it was still running
-- when the pause ended. The new Edge Function and the Admin RPCs write only through the reviewed
-- SECURITY DEFINER functions and are not affected.
-- Requests already running when the migration starts finish first: the policy changes below need an
-- exclusive lock on those tables, which waits for running transactions (lock_timeout 15 s: if the wait is
-- longer the migration stops without changing anything and can simply be run again).

set lock_timeout = '15s';

-- ---------------------------------------------------------------- 0. account-write pause switch
create table if not exists public.resident_maintenance_pause (
  scope text primary key check (scope in ('accounts')),
  paused boolean not null,
  note text check (note is null or char_length(note) <= 300),
  snapshot jsonb not null default '{}'::jsonb,   -- counts only (no names / e-mails): account numbers when the pause started
  changed_at timestamptz not null default now(),
  -- v3 (Option A): refuse DIRECT writes to the account tables by client roles (anon, authenticated,
  -- authenticator, service_role) — paused or not. Writes made inside the reviewed SECURITY DEFINER
  -- functions run as the function owner and are allowed. Turned off only by rc02a1_rollback.sql.
  block_client_direct_writes boolean not null default true
);
alter table public.resident_maintenance_pause enable row level security;
revoke all on table public.resident_maintenance_pause from public, anon, authenticated;

create or replace function private.resident_account_counts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'active_admin', count(*) filter (where r.role = 'admin' and r.active and p.active),
    'active_staff', count(*) filter (where r.role = 'staff' and r.active and p.active),
    'active_resident', count(*) filter (where r.role = 'resident' and r.active and p.active),
    'inactive', count(*) filter (where not (r.active and p.active)),
    'profiles', (select count(*) from public.resident_profiles),
    'roles', (select count(*) from public.resident_user_roles),
    'staff_list', (select count(*) from public.resident_staff_directory))
  from public.resident_user_roles r join public.resident_profiles p on p.user_id = r.user_id;
$$;
revoke all on function private.resident_account_counts() from public, anon, authenticated;

create or replace function public.resident_accounts_paused()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select paused from public.resident_maintenance_pause where scope = 'accounts'), false);
$$;
revoke all on function public.resident_accounts_paused() from public, anon;
grant execute on function public.resident_accounts_paused() to authenticated, service_role;

create or replace function public.resident_account_direct_writes_blocked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select block_client_direct_writes from public.resident_maintenance_pause where scope = 'accounts'), true);
$$;
revoke all on function public.resident_account_direct_writes_blocked() from public, anon;
grant execute on function public.resident_account_direct_writes_blocked() to authenticated, service_role;

-- Guard on the three account tables (name kept from v2). SECURITY INVOKER on purpose (v3): current_user is
-- the role that runs the statement — 'service_role' for a direct REST write by an Edge Function (the old
-- resident-admin path), but the function owner when the write happens inside a reviewed SECURITY DEFINER
-- function (new Edge path and Admin RPCs).
create or replace function private.resident_refuse_account_write_when_paused()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- 1. pause: refuses everyone, including the reviewed functions
  if (select public.resident_accounts_paused()) then
    raise exception 'ACCOUNTS_PAUSED: ระบบบัญชีพักชั่วคราวระหว่างปรับปรุง กรุณาลองใหม่ภายหลัง'
      using errcode = 'P0001';
  end if;
  -- 2. v3 (Option A): client roles may never write these tables directly, paused or not
  if current_user in ('anon', 'authenticated', 'authenticator', 'service_role')
     and (select public.resident_account_direct_writes_blocked()) then
    raise exception 'ACCOUNT_WRITE_REFUSED: บัญชีแก้ได้ผ่านคำสั่งของระบบเท่านั้น กรุณาใช้หน้าจัดการบัญชี'
      using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.resident_refuse_account_write_when_paused() from public, anon, authenticated;

drop trigger if exists resident_profiles_pause_guard on public.resident_profiles;
create trigger resident_profiles_pause_guard before insert or update or delete on public.resident_profiles
  for each row execute function private.resident_refuse_account_write_when_paused();
drop trigger if exists resident_user_roles_pause_guard on public.resident_user_roles;
create trigger resident_user_roles_pause_guard before insert or update or delete on public.resident_user_roles
  for each row execute function private.resident_refuse_account_write_when_paused();
drop trigger if exists resident_staff_directory_pause_guard on public.resident_staff_directory;
create trigger resident_staff_directory_pause_guard before insert or update or delete on public.resident_staff_directory
  for each row execute function private.resident_refuse_account_write_when_paused();
-- TRUNCATE is not a client privilege after section 5; it is also refused while paused.
drop trigger if exists resident_profiles_pause_truncate on public.resident_profiles;
create trigger resident_profiles_pause_truncate before truncate on public.resident_profiles
  for each statement execute function private.resident_refuse_account_write_when_paused();
drop trigger if exists resident_user_roles_pause_truncate on public.resident_user_roles;
create trigger resident_user_roles_pause_truncate before truncate on public.resident_user_roles
  for each statement execute function private.resident_refuse_account_write_when_paused();

-- The pause starts now, inside this migration's transaction.
insert into public.resident_maintenance_pause (scope, paused, note, snapshot, changed_at)
values ('accounts', true, 'RC-02a-1 release: paused by migration 20261018090000', private.resident_account_counts(), now())
on conflict (scope) do update set paused = true, note = excluded.note, snapshot = excluded.snapshot, changed_at = now();


-- ---------------------------------------------------------------- 1. audit table
create table if not exists public.resident_account_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  actor_id uuid not null,            -- no foreign key: an audit row must never block or follow an account change
  target_id uuid,                    -- no foreign key, same reason
  action text not null check (action in (
    'account.created', 'account.updated', 'account.deactivated', 'account.reactivated')),
  changes jsonb not null default '{}'::jsonb,
  reason text check (reason is null or char_length(reason) <= 300),
  side_effects jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text check (error is null or char_length(error) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists resident_account_events_target_idx
  on public.resident_account_events (target_id, created_at desc);
alter table public.resident_account_events enable row level security;
revoke all on table public.resident_account_events from public, anon, authenticated;

-- ---------------------------------------------------------------- 2. helpers
create or replace function private.resident_account_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.resident_user_roles r
    join public.resident_profiles p on p.user_id = r.user_id
    where r.user_id = (select auth.uid()) and r.active and p.active
  );
$$;
revoke all on function private.resident_account_active() from public, anon;
grant execute on function private.resident_account_active() to authenticated, service_role;

-- Active Admin check for a given id (used by service-role RPCs where auth.uid() is empty).
create or replace function private.resident_account_is_active_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.resident_user_roles r
    join public.resident_profiles p on p.user_id = r.user_id
    where r.user_id = p_user_id and r.role = 'admin' and r.active and p.active
  );
$$;
revoke all on function private.resident_account_is_active_admin(uuid) from public, anon, authenticated;

-- Lock order (spec 2.2 item 3): account rows in ascending user_id. The target row is locked
-- FOR NO KEY UPDATE (it will change), the actor row FOR SHARE.
create or replace function private.resident_account_lock(p_actor uuid, p_target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  for v_id in
    select r.user_id from public.resident_user_roles r
    where r.user_id in (p_actor, p_target)
    order by r.user_id
  loop
    if v_id = p_target then
      perform 1 from public.resident_user_roles r where r.user_id = v_id for no key update;
    else
      perform 1 from public.resident_user_roles r where r.user_id = v_id for share;
    end if;
  end loop;
end;
$$;
revoke all on function private.resident_account_lock(uuid, uuid) from public, anon, authenticated;

-- Same request_id twice = return the first result, write nothing (retry / double click).
create or replace function private.resident_account_replay(p_request_id uuid, p_actor uuid, p_actions text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_event public.resident_account_events%rowtype;
begin
  if p_request_id is null then raise exception 'INVALID_INPUT: request id is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('resident_account_request:' || p_request_id::text, 0));
  select * into v_event from public.resident_account_events where request_id = p_request_id;
  if not found then return null; end if;
  if v_event.actor_id is distinct from p_actor or not (v_event.action = any (p_actions)) then
    raise exception 'INVALID_INPUT: request id was already used for another action';
  end if;
  return v_event.result || jsonb_build_object('replayed', true);
end;
$$;
revoke all on function private.resident_account_replay(uuid, uuid, text[]) from public, anon, authenticated;

create or replace function private.resident_account_reason(p_reason text, p_required boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare v text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_required and v is null then raise exception 'INVALID_INPUT: reason is required'; end if;
  if v is not null and char_length(v) > 300 then raise exception 'INVALID_INPUT: reason is longer than 300 characters'; end if;
  return v;
end;
$$;
revoke all on function private.resident_account_reason(text, boolean) from public, anon, authenticated;

-- Pending requests where the person is the Resident or the evaluator (each request once).
create or replace function private.resident_account_pending_requests(p_user_id uuid)
returns table (request_id uuid, as_resident boolean, as_staff boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.resident_id = p_user_id, q.staff_id = p_user_id
  from public.resident_assessment_requests q
  where q.status = 'pending' and (q.resident_id = p_user_id or q.staff_id = p_user_id)
  order by q.id;
$$;
revoke all on function private.resident_account_pending_requests(uuid) from public, anon, authenticated;

create or replace function private.resident_account_active_assignments(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.resident_evaluator_assignments a
  where a.active and (a.evaluator_id = p_user_id or a.resident_id = p_user_id);
$$;
revoke all on function private.resident_account_active_assignments(uuid) from public, anon, authenticated;

create or replace function private.resident_account_active_admins()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.resident_user_roles r
  join public.resident_profiles p on p.user_id = r.user_id
  where r.role = 'admin' and r.active and p.active;
$$;
revoke all on function private.resident_account_active_admins() from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. Admin RPCs
create or replace function public.admin_list_accounts()
returns table (
  user_id uuid, full_name text, email text, role public.resident_system_role, pgy smallint,
  unit_name text, admin_tag text, role_active boolean, profile_active boolean, active boolean,
  updated_at timestamptz, created_at timestamptz, is_self boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.resident_role_is('admin')) then raise exception 'Active Admin account required'; end if;
  return query
  select p.user_id, p.full_name, p.email, r.role, p.pgy,
         d.unit_name, r.admin_tag, r.active, p.active, (r.active and p.active),
         p.updated_at, p.created_at, p.user_id = (select auth.uid())
  from public.resident_profiles p
  join public.resident_user_roles r on r.user_id = p.user_id
  left join public.resident_staff_directory d on d.auth_user_id = p.user_id
  order by r.role, p.full_name, p.user_id;
end;
$$;

create or replace function public.admin_preview_account_action(p_user_id uuid, p_action text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.resident_user_roles%rowtype;
  v_profile public.resident_profiles%rowtype;
  v_pending uuid[];
  v_as_resident integer;
  v_as_staff integer;
  v_admins integer;
  v_admins_after integer;
  v_blockers text[] := '{}';
  v_last_off timestamptz;
  v_year_start date;
begin
  if not (select private.resident_role_is('admin')) then raise exception 'Active Admin account required'; end if;
  if p_action is null or p_action not in ('deactivate', 'reactivate') then raise exception 'INVALID_INPUT: unknown action'; end if;
  select * into v_role from public.resident_user_roles where user_id = p_user_id;
  select * into v_profile from public.resident_profiles where user_id = p_user_id;
  if v_role.user_id is null or v_profile.user_id is null then raise exception 'Account was not found'; end if;

  if p_user_id = (select auth.uid()) then v_blockers := array_append(v_blockers, 'SELF_ACTION_FORBIDDEN'); end if;
  v_admins := private.resident_account_active_admins();

  if p_action = 'deactivate' then
    select coalesce(array_agg(x.request_id order by x.request_id), '{}'),
           count(*) filter (where x.as_resident), count(*) filter (where x.as_staff)
      into v_pending, v_as_resident, v_as_staff
    from private.resident_account_pending_requests(p_user_id) x;
    v_admins_after := v_admins - case when v_role.role = 'admin' and v_role.active and v_profile.active then 1 else 0 end;
    if v_role.role = 'admin' and v_admins_after < 1 then v_blockers := array_append(v_blockers, 'LAST_ADMIN'); end if;
    return jsonb_build_object(
      'action', p_action, 'user_id', p_user_id, 'role', v_role.role,
      'active', v_role.active and v_profile.active, 'updated_at', v_profile.updated_at,
      'is_admin', v_role.role = 'admin',
      'pending_request_ids', to_jsonb(v_pending),
      'pending_requests', cardinality(v_pending),
      'pending_as_resident', v_as_resident, 'pending_as_staff', v_as_staff,
      'active_assignments', private.resident_account_active_assignments(p_user_id),
      'active_admins_now', v_admins, 'active_admins_after', v_admins_after,
      'blockers', to_jsonb(v_blockers),
      'preview_counts', jsonb_build_object(
        'pending_requests', cardinality(v_pending),
        'active_assignments', private.resident_account_active_assignments(p_user_id)));
  end if;

  -- reactivate
  select max(e.created_at) into v_last_off from public.resident_account_events e
    where e.target_id = p_user_id and e.action = 'account.deactivated';
  v_year_start := private.resident_academic_year_start(clock_timestamp());
  return jsonb_build_object(
    'action', p_action, 'user_id', p_user_id, 'role', v_role.role, 'pgy', v_profile.pgy,
    'active', v_role.active and v_profile.active, 'updated_at', v_profile.updated_at,
    'deactivated_at', v_last_off,
    -- A Resident who was off since before 1 July may need a PGY check (the form only warns).
    'academic_year_warning', v_role.role = 'resident' and v_last_off is not null
      and (v_last_off at time zone 'Asia/Bangkok')::date < v_year_start,
    'active_assignments', private.resident_account_active_assignments(p_user_id),
    'blockers', to_jsonb(v_blockers));
end;
$$;

create or replace function public.admin_update_account(
  p_user_id uuid,
  p_expected_updated_at timestamptz,
  p_request_id uuid,
  p_changes jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_replay jsonb;
  v_role public.resident_user_roles%rowtype;
  v_profile public.resident_profiles%rowtype;
  v_dir public.resident_staff_directory%rowtype;
  v_key text;
  v_changes jsonb := '{}'::jsonb;
  v_name text; v_pgy smallint; v_unit text; v_tag text;
  v_new_name text; v_new_pgy smallint; v_new_unit text; v_new_tag text;
  v_reason text;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  v_replay := private.resident_account_replay(p_request_id, v_actor, array['account.updated']);
  if v_replay is not null then return v_replay; end if;
  if p_user_id is null or p_expected_updated_at is null then raise exception 'INVALID_INPUT: account and expected_updated_at are required'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then raise exception 'INVALID_INPUT: changes must be an object'; end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('full_name', 'pgy', 'unit_name', 'admin_tag') then
      raise exception 'INVALID_INPUT: field % cannot be changed here', v_key;
    end if;
  end loop;

  perform private.resident_account_lock(v_actor, p_user_id);
  if not (select private.resident_role_is('admin')) then raise exception 'Active Admin account required'; end if;
  select * into v_role from public.resident_user_roles where user_id = p_user_id;
  select * into v_profile from public.resident_profiles where user_id = p_user_id for no key update;
  if v_role.user_id is null or v_profile.user_id is null then raise exception 'Account was not found'; end if;
  if v_profile.updated_at is distinct from p_expected_updated_at then
    raise exception 'ACCOUNT_CONFLICT: this account was changed by someone else; reload and try again';
  end if;
  select * into v_dir from public.resident_staff_directory where auth_user_id = p_user_id;

  v_new_name := v_profile.full_name; v_new_pgy := v_profile.pgy; v_new_tag := v_role.admin_tag; v_new_unit := v_dir.unit_name;

  if p_changes ? 'full_name' then
    v_name := btrim(coalesce(p_changes->>'full_name', ''));
    if char_length(v_name) not between 2 and 160 then raise exception 'INVALID_INPUT: name must be 2-160 characters'; end if;
    v_new_name := v_name;
  end if;

  if p_changes ? 'pgy' then
    if v_role.role <> 'resident' then raise exception 'ROLE_RULE: only a Resident has a PGY'; end if;
    if jsonb_typeof(p_changes->'pgy') <> 'number' or (p_changes->>'pgy') !~ '^[1-4]$' then
      raise exception 'INVALID_INPUT: PGY must be 1-4';
    end if;
    v_new_pgy := (p_changes->>'pgy')::smallint;
  end if;

  if p_changes ? 'unit_name' then
    if v_role.role <> 'staff' or v_dir.email is null then raise exception 'ROLE_RULE: only a Staff account in the Staff list has a unit'; end if;
    v_unit := btrim(coalesce(p_changes->>'unit_name', ''));
    if char_length(v_unit) not between 2 and 80 then raise exception 'INVALID_INPUT: unit must be 2-80 characters'; end if;
    v_new_unit := v_unit;
  end if;

  if p_changes ? 'admin_tag' then
    if v_role.role <> 'admin' then raise exception 'ROLE_RULE: only an Admin has an admin tag'; end if;
    v_tag := nullif(btrim(coalesce(p_changes->>'admin_tag', '')), '');
    if v_tag is not null and char_length(v_tag) > 40 then raise exception 'INVALID_INPUT: admin tag must be at most 40 characters'; end if;
    v_new_tag := v_tag;
  end if;

  -- Only the fields sent are changed (spec 2.1). A stray PGY on a non-Resident account (one found on
  -- production 2026-10-17) is left as it is: saving that account's name does not touch it (G0 B-R01).

  if v_new_name is distinct from v_profile.full_name then
    v_changes := v_changes || jsonb_build_object('full_name', jsonb_build_object('before', v_profile.full_name, 'after', v_new_name));
  end if;
  if v_new_pgy is distinct from v_profile.pgy then
    v_changes := v_changes || jsonb_build_object('pgy', jsonb_build_object('before', v_profile.pgy, 'after', v_new_pgy));
  end if;
  if v_dir.email is not null and v_new_unit is distinct from v_dir.unit_name then
    v_changes := v_changes || jsonb_build_object('unit_name', jsonb_build_object('before', v_dir.unit_name, 'after', v_new_unit));
  end if;
  if v_new_tag is distinct from v_role.admin_tag then
    v_changes := v_changes || jsonb_build_object('admin_tag', jsonb_build_object('before', v_role.admin_tag, 'after', v_new_tag));
  end if;

  -- A Resident PGY change needs a reason (spec 2.1); other edits may have one.
  v_reason := private.resident_account_reason(p_reason, v_role.role = 'resident' and v_changes ? 'pgy');

  if v_changes = '{}'::jsonb then
    return jsonb_build_object('user_id', p_user_id, 'changed', false, 'updated_at', v_profile.updated_at, 'fields', '[]'::jsonb);
  end if;

  update public.resident_profiles
    set full_name = case when v_changes ? 'full_name' then v_new_name else full_name end,
        pgy = case when v_changes ? 'pgy' then v_new_pgy else pgy end,
        updated_at = v_now
    where user_id = p_user_id;
  if v_changes ? 'admin_tag' then
    update public.resident_user_roles set admin_tag = v_new_tag, updated_at = v_now where user_id = p_user_id;
  end if;
  if v_dir.email is not null and (v_changes ? 'full_name' or v_changes ? 'unit_name') then
    -- Staff name lives in both tables; both change in this one transaction.
    update public.resident_staff_directory
      set full_name = v_new_name, unit_name = v_new_unit, updated_at = v_now
      where auth_user_id = p_user_id;
  end if;

  v_result := jsonb_build_object('user_id', p_user_id, 'changed', true, 'updated_at', v_now,
    'fields', (select jsonb_agg(k order by k) from jsonb_object_keys(v_changes) k));
  insert into public.resident_account_events (request_id, actor_id, target_id, action, changes, reason, result)
  values (p_request_id, v_actor, p_user_id, 'account.updated', v_changes, v_reason, v_result);
  return v_result;
end;
$$;

create or replace function public.admin_set_account_active(
  p_user_id uuid,
  p_active boolean,
  p_expected_updated_at timestamptz,
  p_request_id uuid,
  p_reason text,
  p_preview_counts jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_action text := case when p_active then 'account.reactivated' else 'account.deactivated' end;
  v_replay jsonb;
  v_role public.resident_user_roles%rowtype;
  v_profile public.resident_profiles%rowtype;
  v_reason text;
  v_pending uuid[];
  v_assignments integer;
  v_admins_after integer;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  if p_active is null then raise exception 'INVALID_INPUT: active must be true or false'; end if;
  v_replay := private.resident_account_replay(p_request_id, v_actor, array[v_action]);
  if v_replay is not null then return v_replay; end if;
  if p_user_id is null or p_expected_updated_at is null then raise exception 'INVALID_INPUT: account and expected_updated_at are required'; end if;
  v_reason := private.resident_account_reason(p_reason, true);
  if p_user_id = v_actor then raise exception 'SELF_ACTION_FORBIDDEN: an Admin cannot deactivate or reactivate their own account'; end if;

  -- Lock order: (1) global accounts lock (last-Admin guard), (2) account rows ascending, (3) request rows.
  perform pg_advisory_xact_lock(hashtextextended('resident_accounts', 0));
  perform private.resident_account_lock(v_actor, p_user_id);
  -- Checked after the locks: an Admin deactivated a moment ago by another Admin is refused here.
  if not (select private.resident_role_is('admin')) then raise exception 'Active Admin account required'; end if;

  select * into v_role from public.resident_user_roles where user_id = p_user_id;
  select * into v_profile from public.resident_profiles where user_id = p_user_id for no key update;
  if v_role.user_id is null or v_profile.user_id is null then raise exception 'Account was not found'; end if;
  if v_profile.updated_at is distinct from p_expected_updated_at then
    raise exception 'ACCOUNT_CONFLICT: this account was changed by someone else; reload and try again';
  end if;
  if v_role.active = p_active and v_profile.active = p_active then
    raise exception 'ACCOUNT_CONFLICT: the account is already %', case when p_active then 'active' else 'deactivated' end;
  end if;

  if not p_active then
    v_admins_after := private.resident_account_active_admins()
      - (case when v_role.role = 'admin' and v_role.active and v_profile.active then 1 else 0 end);
    if v_role.role = 'admin' and v_admins_after < 1 then
      raise exception 'LAST_ADMIN: at least one active Admin must remain';
    end if;
    -- (3) request rows, then recount against what the Admin saw.
    select coalesce(array_agg(q.id order by q.id), '{}') into v_pending
    from (
      select q.id from public.resident_assessment_requests q
      where q.status = 'pending' and (q.resident_id = p_user_id or q.staff_id = p_user_id)
      order by q.id
      for update
    ) q;
    v_assignments := private.resident_account_active_assignments(p_user_id);
    if p_preview_counts is null
       or (p_preview_counts->>'pending_requests') is distinct from cardinality(v_pending)::text
       or (p_preview_counts->>'active_assignments') is distinct from v_assignments::text then
      raise exception 'PREVIEW_CHANGED: the numbers changed since the preview; review again';
    end if;
  else
    v_pending := '{}';
    v_assignments := private.resident_account_active_assignments(p_user_id);
  end if;

  update public.resident_user_roles set active = p_active, updated_at = v_now where user_id = p_user_id;
  update public.resident_profiles set active = p_active, updated_at = v_now where user_id = p_user_id;

  if not p_active and cardinality(v_pending) > 0 then
    -- Same effect as cancel_resident_assessment_request (D-009). Cancelled requests do not count
    -- as attempts, so the Resident gets them back under the existing cap rules.
    update public.resident_assessment_requests set status = 'cancelled' where id = any (v_pending);
    delete from public.resident_notifications
      where request_id = any (v_pending)
        and notification_type in ('assessment_requested', 'assessment_reminder');
  end if;

  v_result := jsonb_build_object('user_id', p_user_id, 'changed', true, 'active', p_active, 'updated_at', v_now,
    'cancelled_requests', cardinality(v_pending));
  insert into public.resident_account_events (request_id, actor_id, target_id, action, changes, reason, side_effects, result)
  values (p_request_id, v_actor, p_user_id, v_action,
    jsonb_build_object('active', jsonb_build_object('before', v_role.active and v_profile.active, 'after', p_active)),
    v_reason,
    case when p_active then jsonb_build_object('active_assignment_count', v_assignments)
         else jsonb_build_object('cancelled_request_ids', to_jsonb(v_pending), 'kept_assignment_count', v_assignments) end,
    v_result);
  return v_result;
end;
$$;

create or replace function public.admin_list_account_events(p_user_id uuid)
returns table (
  id uuid, created_at timestamptz, actor_id uuid, actor_name text, action text,
  changes jsonb, reason text, side_effects jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.resident_role_is('admin')) then raise exception 'Active Admin account required'; end if;
  return query
  select e.id, e.created_at, e.actor_id, a.full_name, e.action, e.changes, e.reason, e.side_effects
  from public.resident_account_events e
  left join public.resident_profiles a on a.user_id = e.actor_id
  where e.target_id = p_user_id
  order by e.created_at desc, e.id;
end;
$$;

-- Used only by the resident-admin Edge Function (service role) for provision_account and invite_staff.
-- Never overwrites: any existing profile or role for this person => ACCOUNT_EXISTS and nothing is written (D-011).
create or replace function public.admin_provision_account_internal(
  p_actor_id uuid,
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_role text,
  p_pgy smallint default null,
  p_unit_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_full_name, ''));
  v_unit text := nullif(btrim(coalesce(p_unit_name, '')), '');
  v_existing uuid;
  v_dir public.resident_staff_directory%rowtype;
  v_request uuid := gen_random_uuid();
  v_result jsonb;
begin
  if p_user_id is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID_INPUT: valid account and email are required'; end if;
  if p_role is null or p_role not in ('resident', 'staff', 'admin') then raise exception 'INVALID_INPUT: unknown role'; end if;
  if char_length(v_name) not between 2 and 160 then raise exception 'INVALID_INPUT: name must be 2-160 characters'; end if;
  if p_role = 'resident' and (p_pgy is null or p_pgy not between 1 and 4) then raise exception 'ROLE_RULE: a Resident needs PGY 1-4'; end if;
  if p_role <> 'resident' and p_pgy is not null then raise exception 'ROLE_RULE: only a Resident has a PGY'; end if;

  -- One add per email at a time (two clicks, two tabs, provision + invite together).
  perform pg_advisory_xact_lock(hashtextextended('resident_account_email:' || v_email, 0));
  if not private.resident_account_is_active_admin(p_actor_id) then raise exception 'Active Admin account required'; end if;

  select user_id into v_existing from public.resident_profiles where email = v_email or user_id = p_user_id limit 1;
  if v_existing is null then
    select user_id into v_existing from public.resident_user_roles where user_id = p_user_id;
  end if;
  if v_existing is not null then
    raise exception 'ACCOUNT_EXISTS: % ', v_existing;
  end if;

  if p_role = 'staff' then
    select * into v_dir from public.resident_staff_directory where email = v_email for update;
    if v_dir.email is null then
      if v_unit is null or char_length(v_unit) not between 2 and 80 then raise exception 'INVALID_INPUT: unit must be 2-80 characters'; end if;
      insert into public.resident_staff_directory (email, full_name, unit_name, active)
      values (v_email, v_name, v_unit, true);
      select * into v_dir from public.resident_staff_directory where email = v_email;
    end if;
    if not v_dir.active then raise exception 'ROLE_RULE: this Staff list entry is inactive'; end if;
    if v_dir.auth_user_id is not null and v_dir.auth_user_id <> p_user_id then
      raise exception 'ACCOUNT_EXISTS: % ', v_dir.auth_user_id;
    end if;
    v_name := v_dir.full_name;
  end if;

  -- The unique email / lower-case checks on resident_profiles are the final guard.
  insert into public.resident_profiles (user_id, full_name, email, pgy, active)
  values (p_user_id, v_name, v_email, case when p_role = 'resident' then p_pgy end, true);
  insert into public.resident_user_roles (user_id, role, active)
  values (p_user_id, p_role::public.resident_system_role, true);
  if p_role = 'staff' then
    update public.resident_staff_directory set auth_user_id = p_user_id, invited_at = now(), updated_at = now() where email = v_email;
  end if;

  v_result := jsonb_build_object('user_id', p_user_id, 'role', p_role, 'created', true);
  insert into public.resident_account_events (request_id, actor_id, target_id, action, changes, result)
  values (v_request, p_actor_id, p_user_id, 'account.created',
    jsonb_build_object('role', p_role, 'pgy', case when p_role = 'resident' then p_pgy end), v_result);
  return v_result;
end;
$$;

revoke all on function public.admin_list_accounts() from public, anon;
revoke all on function public.admin_preview_account_action(uuid, text) from public, anon;
revoke all on function public.admin_update_account(uuid, timestamptz, uuid, jsonb, text) from public, anon;
revoke all on function public.admin_set_account_active(uuid, boolean, timestamptz, uuid, text, jsonb) from public, anon;
revoke all on function public.admin_list_account_events(uuid) from public, anon;
grant execute on function public.admin_list_accounts() to authenticated;
grant execute on function public.admin_preview_account_action(uuid, text) to authenticated;
grant execute on function public.admin_update_account(uuid, timestamptz, uuid, jsonb, text) to authenticated;
grant execute on function public.admin_set_account_active(uuid, boolean, timestamptz, uuid, text, jsonb) to authenticated;
grant execute on function public.admin_list_account_events(uuid) to authenticated;
revoke all on function public.admin_provision_account_internal(uuid, uuid, text, text, text, smallint, text) from public, anon, authenticated;
grant execute on function public.admin_provision_account_internal(uuid, uuid, text, text, text, smallint, text) to service_role;

-- ---------------------------------------------------------------- 4–6. replaced functions (lock contract + active checks)
-- private.resident_role_is: full current definition from the repo migrations, edited only where marked RC-02a-1.
CREATE OR REPLACE FUNCTION private.resident_role_is(expected_role resident_system_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  -- RC-02a-1: an account is usable only when BOTH flags are on (D-022).
  select exists (
    select 1 from public.resident_user_roles r
    join public.resident_profiles p on p.user_id = r.user_id
    where r.user_id = (select auth.uid()) and r.role = expected_role and r.active and p.active
  );
$function$;

-- private.resident_can_evaluate: full current definition from the repo migrations, edited only where marked RC-02a-1.
CREATE OR REPLACE FUNCTION private.resident_can_evaluate(target_resident uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  -- RC-02a-1: assignments are kept when Staff is deactivated, but they give no access (D-021).
  select (select private.resident_role_is('admin')) or (
    (select private.resident_account_active()) and exists (
      select 1 from public.resident_evaluator_assignments
      where evaluator_id = (select auth.uid()) and resident_id = target_resident and active
    )
  );
$function$;

-- public.submit_resident_assessment_request: full current definition from the repo migrations, edited only where marked RC-02a-1.
CREATE OR REPLACE FUNCTION public.submit_resident_assessment_request(p_template_id uuid, p_staff_id uuid, p_assessment_date date, p_clinical_context text, p_procedure_or_activity text, p_self_outcome text, p_self_comment text, p_self_scores jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
  v_template public.resident_template_definitions%rowtype;
  v_request_id uuid;
  v_attempt integer;
  v_previous_staff text;
  v_resident_name text;
  v_criterion public.resident_template_criteria%rowtype;
  v_score jsonb;
  v_today date := (clock_timestamp() at time zone 'Asia/Bangkok')::date;
  v_ay_start date;
  v_ay_start_at timestamptz;
  v_ay_end_at timestamptz;
  v_requests integer;
  v_max_request integer;
  v_hist integer;
  v_used integer;
  v_cap integer;
  v_year_used integer;
  v_unavailable_until date;
begin
  if not (select private.resident_role_is('resident')) then raise exception 'Active Resident role required'; end if;
  -- RC-02a-1 lock order: both account rows, ascending user_id, held to the end of the transaction.
  -- A concurrent deactivation of either person finishes first (and is seen below) or waits for this request.
  perform 1 from public.resident_user_roles lock_role
    where lock_role.user_id in ((select auth.uid()), p_staff_id)
    order by lock_role.user_id
    for share;
  if not (select private.resident_role_is('resident')) then raise exception 'Active Resident role required'; end if;
  if p_assessment_date is null or p_assessment_date > (clock_timestamp() at time zone 'Asia/Bangkok')::date then raise exception 'Assessment date is invalid'; end if;
  if char_length(btrim(coalesce(p_procedure_or_activity, ''))) not between 1 and 240 then raise exception 'Activity is required'; end if;
  if char_length(coalesce(p_clinical_context, '')) > 500 then raise exception 'Clinical context is too long'; end if;
  if not exists (
    select 1 from public.resident_staff_directory directory
    join public.resident_user_roles role on role.user_id = directory.auth_user_id
    join public.resident_profiles profile on profile.user_id = role.user_id
    where directory.auth_user_id = p_staff_id and directory.active
      and role.active and role.role = 'staff' and profile.active
  ) then raise exception 'Selected Staff must match an active registered Staff account'; end if;
  select * into v_template from public.resident_template_definitions
    where id = p_template_id and active;
  if not found then raise exception 'Assessment template is unavailable'; end if;
  select full_name into v_resident_name from public.resident_profiles
    where user_id = (select auth.uid()) and active;
  if v_resident_name is null then raise exception 'Resident profile is unavailable'; end if;

  perform pg_advisory_xact_lock(hashtextextended((select auth.uid())::text || p_template_id::text, 0));
  if exists (select 1 from public.resident_assessment_requests
             where resident_id = (select auth.uid()) and template_id = p_template_id and status = 'pending')
  then raise exception 'This assessment already has a pending request'; end if;
  -- A Staff member may declare a period in which they are not accepting assessments.
  select availability.unavailable_until into v_unavailable_until
  from public.resident_staff_availability availability
  where availability.staff_id = p_staff_id and availability.unavailable_until >= v_today;
  if v_unavailable_until is not null
  then raise exception 'Selected Staff is not accepting assessments until %', v_unavailable_until; end if;

  -- Attempts already used = non-cancelled requests + assessments an Admin recorded directly (historical).
  select count(*), coalesce(max(attempt_number), 0) into v_requests, v_max_request
  from public.resident_assessment_requests
  where resident_id = (select auth.uid()) and template_id = p_template_id and status <> 'cancelled';
  select count(*) into v_hist from public.resident_assessments assessment
  where assessment.resident_id = (select auth.uid()) and assessment.template_id = p_template_id
    and not exists (select 1 from public.resident_assessment_requests linked where linked.assessment_id = assessment.id);
  v_used := v_requests + v_hist;
  -- The number shown to the Resident is the true count + 1, even if an Admin recorded a historical assessment later.
  v_attempt := greatest(v_max_request, v_used) + 1;

  -- Lifetime limit (an Admin may grant extra attempts to one Resident for one form).
  if v_template.max_attempts is not null then
    v_cap := v_template.max_attempts + (select count(*) from public.resident_attempt_grants grants
      where grants.resident_id = (select auth.uid()) and grants.template_id = p_template_id);
    if v_used + 1 > v_cap then raise exception 'Assessment attempt limit reached'; end if;
  end if;

  -- PBA topics are never repeated.
  if v_template.template_type = 'PBA' and v_used > 0
  then raise exception 'This PBA topic was already requested'; end if;

  -- Per academic year limit (the academic year starts on 1 July, Bangkok time, counted from the request time).
  if v_template.max_attempts_per_year is not null then
    v_ay_start := private.resident_academic_year_start(clock_timestamp());
    v_ay_start_at := v_ay_start::timestamp at time zone 'Asia/Bangkok';
    v_ay_end_at := (v_ay_start + interval '1 year')::timestamp at time zone 'Asia/Bangkok';
    select (select count(*) from public.resident_assessment_requests request
              where request.resident_id = (select auth.uid()) and request.template_id = p_template_id
                and request.status <> 'cancelled'
                and request.submitted_at >= v_ay_start_at and request.submitted_at < v_ay_end_at)
         + (select count(*) from public.resident_assessments assessment
              where assessment.resident_id = (select auth.uid()) and assessment.template_id = p_template_id
                and assessment.assessment_date >= v_ay_start and assessment.assessment_date < (v_ay_start + interval '1 year')::date
                and not exists (select 1 from public.resident_assessment_requests linked where linked.assessment_id = assessment.id))
    into v_year_used;
    if v_year_used >= v_template.max_attempts_per_year
    then raise exception 'Assessment already requested this academic year'; end if;
  end if;

  select profile.full_name into v_previous_staff
  from public.resident_assessments previous
  join public.resident_profiles profile on profile.user_id = previous.evaluator_id
  where previous.resident_id = (select auth.uid()) and previous.template_id = p_template_id
  order by previous.assessment_date desc, previous.created_at desc limit 1;

  if v_template.requires_self_assessment then
    if jsonb_typeof(p_self_scores) <> 'array' or
       jsonb_array_length(p_self_scores) <> (select count(*) from public.resident_template_criteria
                                                where template_id = p_template_id and active)
    then raise exception 'Every self-assessment criterion requires one score'; end if;
    if not (v_template.outcome_options ? coalesce(p_self_outcome, ''))
    then raise exception 'A valid self-assessment outcome is required'; end if;
  elsif p_self_scores is not null and p_self_scores <> '[]'::jsonb then
    raise exception 'This form does not have Resident self-assessment';
  end if;

  insert into public.resident_assessment_requests (
    template_id, resident_id, staff_id, assessment_date, clinical_context,
    procedure_or_activity, attempt_number, previous_staff_name,
    self_overall_outcome, self_comment, self_submitted_at
  ) values (
    p_template_id, (select auth.uid()), p_staff_id, p_assessment_date,
    coalesce(p_clinical_context, ''), btrim(p_procedure_or_activity), v_attempt,
    v_previous_staff, case when v_template.requires_self_assessment then p_self_outcome else null end,
    case when v_template.requires_self_assessment then coalesce(p_self_comment, '') else '' end,
    case when v_template.requires_self_assessment then now() else null end
  ) returning id into v_request_id;

  if v_template.requires_self_assessment then
    for v_criterion in select * from public.resident_template_criteria
      where template_id = p_template_id and active order by sort_order
    loop
      select value into v_score from jsonb_array_elements(p_self_scores)
        where value->>'criterionId' = v_criterion.id::text;
      if v_score is null or not (v_template.score_options ? coalesce(v_score->>'score', ''))
      then raise exception 'Missing or invalid self-assessment score'; end if;
      insert into public.resident_self_assessment_scores (request_id, criterion_id, score, comment)
      values (v_request_id, v_criterion.id, v_score->>'score', coalesce(v_score->>'comment', ''));
    end loop;
  end if;

  insert into public.resident_notifications (recipient_id, request_id, notification_type, title, message)
  values (p_staff_id, v_request_id, 'assessment_requested', 'มีคำขอประเมินใหม่',
          v_resident_name || ' ส่ง ' || v_template.template_code || ' ให้ประเมิน');
  return v_request_id;
end;
$function$;

-- public.complete_resident_assessment_request: full current definition from the repo migrations, edited only where marked RC-02a-1.
CREATE OR REPLACE FUNCTION public.complete_resident_assessment_request(p_request_id uuid, p_overall_outcome text, p_overall_comment text, p_scores jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
  v_request public.resident_assessment_requests%rowtype;
  v_template public.resident_template_definitions%rowtype;
  v_assessment_id uuid;
  v_criterion public.resident_template_criteria%rowtype;
  v_score jsonb;
begin
  -- RC-02a-1 lock order: account rows (actor + the request's Resident, ascending user_id), then the request row.
  select * into v_request from public.resident_assessment_requests where id = p_request_id;
  if not found then raise exception 'Assessment request was not found'; end if;
  perform 1 from public.resident_user_roles lock_role
    where lock_role.user_id in ((select auth.uid()), v_request.resident_id)
    order by lock_role.user_id
    for share;
  select * into v_request from public.resident_assessment_requests where id = p_request_id for update;
  if not found then raise exception 'Assessment request was not found'; end if;
  if v_request.staff_id <> (select auth.uid()) or not (select private.resident_role_is('staff'))
  then raise exception 'Only the selected active Staff may assess this request'; end if;
  if v_request.status <> 'pending' then raise exception 'Assessment request is no longer pending'; end if;
  select * into v_template from public.resident_template_definitions
    where id = v_request.template_id and active;
  if not found then raise exception 'Assessment template is unavailable'; end if;
  if v_template.requires_self_assessment and (
    v_request.self_submitted_at is null or
    (select count(*) from public.resident_self_assessment_scores where request_id = p_request_id) <>
    (select count(*) from public.resident_template_criteria where template_id = v_request.template_id and active)
  ) then raise exception 'Resident self-assessment must be complete first'; end if;
  if not (v_template.outcome_options ? coalesce(p_overall_outcome, ''))
  then raise exception 'A valid overall outcome is required'; end if;
  if jsonb_typeof(p_scores) <> 'array' or
     jsonb_array_length(p_scores) <> (select count(*) from public.resident_template_criteria
                                      where template_id = v_request.template_id and active)
  then raise exception 'Every criterion requires one Staff score'; end if;

  insert into public.resident_assessments (
    template_id, resident_id, evaluator_id, resident_pgy, assessment_date,
    clinical_context, procedure_or_activity, overall_outcome, overall_comment
  ) select v_request.template_id, v_request.resident_id, v_request.staff_id,
           profile.pgy, v_request.assessment_date, v_request.clinical_context,
           v_request.procedure_or_activity, p_overall_outcome, coalesce(p_overall_comment, '')
    from public.resident_profiles profile where profile.user_id = v_request.resident_id and profile.active
    returning id into v_assessment_id;
  if v_assessment_id is null then raise exception 'Resident profile is unavailable'; end if;
  for v_criterion in select * from public.resident_template_criteria
    where template_id = v_request.template_id and active order by sort_order
  loop
    select value into v_score from jsonb_array_elements(p_scores)
      where value->>'criterionId' = v_criterion.id::text;
    if v_score is null or not (v_template.score_options ? coalesce(v_score->>'score', ''))
    then raise exception 'Missing or invalid Staff score'; end if;
    insert into public.resident_assessment_scores (assessment_id, criterion_id, score, comment)
    values (v_assessment_id, v_criterion.id, v_score->>'score', coalesce(v_score->>'comment', ''));
  end loop;
  update public.resident_assessment_requests
    set status = 'completed', assessment_id = v_assessment_id, assessed_at = now()
    where id = p_request_id;
  insert into public.resident_notifications (recipient_id, request_id, notification_type, title, message)
  values (v_request.resident_id, p_request_id, 'assessment_completed', 'Staff ประเมินเรียบร้อยแล้ว',
          v_template.template_code || ' ได้รับการประเมินและบันทึกผลแล้ว');
  return v_assessment_id;
end;
$function$;

-- public.cancel_resident_assessment_request: full current definition from the repo migrations, edited only where marked RC-02a-1.
CREATE OR REPLACE FUNCTION public.cancel_resident_assessment_request(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request public.resident_assessment_requests%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  -- RC-02a-1 lock order: the actor's account row, then the request row.
  perform 1 from public.resident_user_roles lock_role
    where lock_role.user_id = (select auth.uid())
    for share;

  select * into v_request
  from public.resident_assessment_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Assessment request was not found';
  end if;
  if not (
       (v_request.resident_id = (select auth.uid()) and (select private.resident_account_active()))
       or (select private.resident_role_is('admin'))
     ) then
    raise exception 'Only the Resident who sent this request or an Admin can cancel it';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Only a pending request can be cancelled';
  end if;

  update public.resident_assessment_requests
  set status = 'cancelled'
  where id = p_request_id;

  -- Staff must not be asked to open a request that no longer exists.
  delete from public.resident_notifications
  where request_id = p_request_id
    and notification_type in ('assessment_requested', 'assessment_reminder');
end;
$function$;

-- public.list_registered_resident_staff: full current definition from the repo migrations, edited only where marked RC-02a-1.
CREATE OR REPLACE FUNCTION public.list_registered_resident_staff()
 RETURNS TABLE(user_id uuid, full_name text, unit_name text, unavailable_until date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare v_today date := (clock_timestamp() at time zone 'Asia/Bangkok')::date;
begin
  if not (select private.resident_account_active()) then raise exception 'Active Resident Surgery account required'; end if;

  return query
  select directory.auth_user_id, directory.full_name, directory.unit_name,
         case when availability.unavailable_until >= v_today then availability.unavailable_until end
  from public.resident_staff_directory directory
  join public.resident_user_roles role on role.user_id = directory.auth_user_id
  join public.resident_profiles profile on profile.user_id = directory.auth_user_id
  left join public.resident_staff_availability availability on availability.staff_id = directory.auth_user_id
  where directory.active and role.active and role.role = 'staff' and profile.active
  order by directory.unit_name, directory.full_name;
end;
$function$;

-- public.list_resident_counterpart_staff: full current definition from the repo migrations, edited only where marked RC-02a-1.
CREATE OR REPLACE FUNCTION public.list_resident_counterpart_staff()
 RETURNS TABLE(user_id uuid, full_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (select private.resident_account_active()) then
    raise exception 'Active Resident Surgery account required';
  end if;

  return query
  select profile.user_id, profile.full_name
  from public.resident_profiles profile
  where profile.user_id in (
    select request.staff_id from public.resident_assessment_requests request
    where request.resident_id = (select auth.uid())
    union
    select assessment.evaluator_id from public.resident_assessments assessment
    where assessment.resident_id = (select auth.uid())
  )
  order by profile.full_name, profile.user_id;
end;
$function$;

-- public.resolve_resident_assessment_qr: full current definition from the repo migrations, edited only where marked RC-02a-1.
CREATE OR REPLACE FUNCTION public.resolve_resident_assessment_qr(p_qr_token uuid)
 RETURNS TABLE(user_id uuid, full_name text, pgy smallint, pending_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
begin
  if not (select private.resident_role_is('staff')) then
    raise exception 'Active Staff account required';
  end if;

  return query
  select profile.user_id,
         profile.full_name,
         profile.pgy,
         count(request.id) filter (where request.status = 'pending')::bigint
  from public.resident_profiles profile
  join public.resident_user_roles role
    on role.user_id = profile.user_id
   and role.active
   and role.role = 'resident'
  left join public.resident_assessment_requests request
    on request.resident_id = profile.user_id
   and request.staff_id = (select auth.uid())
  where profile.active and profile.qr_token = p_qr_token
  group by profile.user_id, profile.full_name, profile.pgy;
end;
$function$;


-- ---------------------------------------------------------------- 6. policies: active check on writes and on reading other people's data
-- Own-row reads (a person reading their own profile, role, requests, results, notifications, attendance)
-- are intentionally unchanged in piece 1 (documented residual, spec 2.6).

drop policy if exists resident_notifications_recipient_update on public.resident_notifications;
create policy resident_notifications_recipient_update on public.resident_notifications
  for update to authenticated
  using (recipient_id = (select auth.uid()) and (select private.resident_account_active()))
  with check (recipient_id = (select auth.uid()) and (select private.resident_account_active()));

drop policy if exists resident_requests_party_select on public.resident_assessment_requests;
create policy resident_requests_party_select on public.resident_assessment_requests
  for select to authenticated
  using (
    resident_id = (select auth.uid())
    or (staff_id = (select auth.uid()) and (select private.resident_account_active()))
    or (select private.resident_role_is('admin'))
  );

drop policy if exists resident_assessments_select on public.resident_assessments;
create policy resident_assessments_select on public.resident_assessments
  for select to authenticated
  using (
    resident_id = (select auth.uid())
    or (evaluator_id = (select auth.uid()) and (select private.resident_account_active()))
    or (select private.resident_role_is('admin'))
  );

drop policy if exists resident_scores_select on public.resident_assessment_scores;
create policy resident_scores_select on public.resident_assessment_scores
  for select to authenticated
  using (exists (
    select 1 from public.resident_assessments a
    where a.id = resident_assessment_scores.assessment_id
      and (
        a.resident_id = (select auth.uid())
        or (a.evaluator_id = (select auth.uid()) and (select private.resident_account_active()))
        or (select private.resident_role_is('admin'))
      )
  ));

drop policy if exists resident_self_scores_party_select on public.resident_self_assessment_scores;
create policy resident_self_scores_party_select on public.resident_self_assessment_scores
  for select to authenticated
  using (exists (
    select 1 from public.resident_assessment_requests request
    where request.id = resident_self_assessment_scores.request_id
      and (
        request.resident_id = (select auth.uid())
        or (request.staff_id = (select auth.uid()) and (select private.resident_account_active()))
        or (select private.resident_role_is('admin'))
      )
  ));

drop policy if exists resident_assignments_select on public.resident_evaluator_assignments;
create policy resident_assignments_select on public.resident_evaluator_assignments
  for select to authenticated
  using (
    ((evaluator_id = (select auth.uid()) or resident_id = (select auth.uid())) and (select private.resident_account_active()))
    or (select private.resident_role_is('admin'))
  );

drop policy if exists resident_profiles_assessment_party_select on public.resident_profiles;
create policy resident_profiles_assessment_party_select on public.resident_profiles
  for select to authenticated
  using (
    (select private.resident_account_active())
    and exists (
      select 1 from public.resident_assessments assessment
      where assessment.evaluator_id = (select auth.uid()) and assessment.resident_id = resident_profiles.user_id
    )
  );

drop policy if exists resident_profiles_request_party_select on public.resident_profiles;
create policy resident_profiles_request_party_select on public.resident_profiles
  for select to authenticated
  using (
    (select private.resident_account_active())
    and exists (
      select 1 from public.resident_assessment_requests request
      where request.staff_id = (select auth.uid()) and request.resident_id = resident_profiles.user_id
    )
  );

-- ---------------------------------------------------------------- 5. close direct writes on the two account tables
-- Verified on production 2026-10-17: anon and authenticated held every table privilege. After this only
-- authenticated keeps SELECT (read policies unchanged); all writes go through the RPCs above or the
-- service-role Edge Function. REVOKE on the table also removes column-level privileges.
drop policy if exists resident_profiles_admin_write on public.resident_profiles;
drop policy if exists resident_roles_admin_write on public.resident_user_roles;
revoke all on table public.resident_profiles from public, anon, authenticated;
revoke all on table public.resident_user_roles from public, anon, authenticated;
grant select on table public.resident_profiles to authenticated;
grant select on table public.resident_user_roles to authenticated;
