-- RC-04 (B001) — managed X-ray & Anatomy / MPL exams: revisions, partial import, review, publish, correction,
-- pinned reads. Contract: RC04_Import_Contract_v2 (RC-04-C0-C002, P01 confirmed 19 Oct 16:23).
--
-- Model
--   * Identity/control of a managed exam stays in public.resident_exam_events (managed_by_rc04 = true,
--     published_revision_id). Its title/date/type are only a PUBLISHED PROJECTION written by rc04_publish_revision.
--   * Every managed snapshot (metadata, roster with name + PGY at exam, parts/max, MPL, results with value_state)
--     lives in rc04_* tables keyed by revision. Legacy child tables (participants/parts/results/mpl) never hold
--     rows of a managed exam.
--   * Legacy writers reject managed exams before any mutation; the legacy reader and the events SELECT policy
--     exclude managed exams on the server (old frontends never see them, RC04-STATE-READER-1 floor).
--   * New tables have no client/service-role privileges; access is only through the SECURITY DEFINER RPCs below.
-- Lock order of every managed mutation: auth → request receipt → exam (event row) → revisions (sequence asc) →
-- preview. No public mutation calls another public mutation.
-- Data: this migration changes no existing row (only adds columns with defaults).

set lock_timeout = '15s';

-- ================================================================ 1. tables
alter table public.resident_exam_events
  add column if not exists managed_by_rc04 boolean not null default false,
  add column if not exists published_revision_id uuid;

create table public.rc04_exam_revisions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.resident_exam_events(id),
  seq integer not null check (seq >= 1),
  state text not null check (state in ('working', 'published')),
  version integer not null default 1 check (version >= 1),
  base_published_revision_id uuid,
  academic_year integer not null check (academic_year between 2500 and 2700),
  exam_date date not null,
  exam_type text not null check (exam_type = 'xray_anatomy'),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  checked_version integer,
  checked_by uuid references public.resident_profiles(user_id),
  checked_at timestamptz,
  published_by uuid references public.resident_profiles(user_id),
  published_at timestamptz,
  created_by uuid not null references public.resident_profiles(user_id),
  created_at timestamptz not null default clock_timestamp(),
  correction_reason text check (correction_reason is null or char_length(correction_reason) <= 300),
  unique (exam_id, seq),
  unique (exam_id, id),
  foreign key (exam_id, base_published_revision_id) references public.rc04_exam_revisions(exam_id, id),
  check (state <> 'published' or (published_by is not null and published_at is not null and checked_version = version))
);
create unique index rc04_one_working_revision on public.rc04_exam_revisions (exam_id) where state = 'working';

alter table public.resident_exam_events
  add constraint resident_exam_events_published_revision_fk
  foreign key (id, published_revision_id) references public.rc04_exam_revisions(exam_id, id);
alter table public.resident_exam_events
  add constraint resident_exam_events_rc04_pointer_check check (managed_by_rc04 or published_revision_id is null);

create table public.rc04_revision_parts (
  revision_id uuid not null,
  exam_id uuid not null,
  part_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  sort_order smallint not null check (sort_order between 1 and 50),
  max_score numeric(10,2) not null check (max_score > 0),
  primary key (revision_id, part_id),
  unique (revision_id, sort_order),
  foreign key (exam_id, revision_id) references public.rc04_exam_revisions(exam_id, id)
);

create table public.rc04_revision_mpl (
  revision_id uuid not null,
  part_id uuid not null,
  pgy smallint not null check (pgy between 1 and 4),
  mpl numeric(10,2) not null check (mpl >= 0),
  primary key (revision_id, part_id, pgy),
  foreign key (revision_id, part_id) references public.rc04_revision_parts(revision_id, part_id) on delete cascade
);

create table public.rc04_revision_participants (
  revision_id uuid not null,
  exam_id uuid not null,
  resident_id uuid not null references public.resident_profiles(user_id),
  pgy_at_exam smallint not null check (pgy_at_exam between 1 and 4),
  reference_name text not null check (char_length(btrim(reference_name)) between 1 and 160),
  primary key (revision_id, resident_id),
  foreign key (exam_id, revision_id) references public.rc04_exam_revisions(exam_id, id)
);

create table public.rc04_revision_results (
  revision_id uuid not null,
  resident_id uuid not null,
  part_id uuid not null,
  value_state text not null check (value_state in ('scored', 'absent', 'awaiting', 'unknown')),
  score numeric(10,2),
  outcome text check (outcome in ('pass', 'fail')),
  source_batch_id uuid,
  updated_by uuid not null references public.resident_profiles(user_id),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (revision_id, resident_id, part_id),
  foreign key (revision_id, resident_id) references public.rc04_revision_participants(revision_id, resident_id) on delete cascade,
  foreign key (revision_id, part_id) references public.rc04_revision_parts(revision_id, part_id) on delete cascade,
  check ((value_state = 'scored' and score is not null and score >= 0)
      or (value_state <> 'scored' and score is null and outcome is null))
);

create table public.rc04_import_previews (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null,
  revision_id uuid not null,
  actor_id uuid not null references public.resident_profiles(user_id),
  expected_version integer not null,
  delta jsonb not null,
  delta_fingerprint text not null,
  diff jsonb not null,
  requires_reason boolean not null,
  file_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  foreign key (exam_id, revision_id) references public.rc04_exam_revisions(exam_id, id)
);

create table public.rc04_import_batches (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null,
  revision_id uuid not null,
  preview_id uuid not null references public.rc04_import_previews(id),
  actor_id uuid not null references public.resident_profiles(user_id),
  input_fingerprint text not null,
  file_hash text,
  before_version integer not null,
  after_version integer not null,
  changed_count integer not null,
  result_summary jsonb not null,         -- counts only, never scores
  created_at timestamptz not null default clock_timestamp(),
  foreign key (exam_id, revision_id) references public.rc04_exam_revisions(exam_id, id)
);
alter table public.rc04_revision_results
  add constraint rc04_results_batch_fk foreign key (source_batch_id) references public.rc04_import_batches(id);

create table public.rc04_request_receipts (
  actor_id uuid not null,
  operation text not null,
  request_id uuid not null,
  payload_fingerprint text not null,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  primary key (actor_id, operation, request_id)
);

create table public.rc04_audit (
  id bigint generated always as identity primary key,
  exam_id uuid not null references public.resident_exam_events(id),
  revision_id uuid,
  actor_id uuid not null,
  operation text not null,
  reason text check (reason is null or char_length(reason) <= 300),
  before_version integer,
  after_version integer,
  batch_id uuid,
  details jsonb not null default '{}'::jsonb,   -- counts / ids, never scores or names
  created_at timestamptz not null default clock_timestamp()
);

create table public.rc04_read_manifests (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  scope text not null check (scope in ('own', 'staff')),
  filter jsonb not null,
  entries jsonb not null,              -- [{exam_id, revision_id}] pinned at creation, ordered
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null
);

-- no client or service-role access to any rc04 table: everything goes through the RPCs
do $$
declare t text;
begin
  foreach t in array array['rc04_exam_revisions','rc04_revision_parts','rc04_revision_mpl','rc04_revision_participants',
    'rc04_revision_results','rc04_import_previews','rc04_import_batches','rc04_request_receipts','rc04_audit','rc04_read_manifests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
  end loop;
end $$;

-- ================================================================ 2. guards
create or replace function private.rc04_is_managed_exam(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select managed_by_rc04 from public.resident_exam_events where id = p_event_id), false);
$$;
revoke all on function private.rc04_is_managed_exam(uuid) from public, anon, authenticated, service_role;

create or replace function private.rc04_reject_managed_exam(p_event_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if private.rc04_is_managed_exam(p_event_id) then
    raise exception 'RC04_MANAGED_EXAM: this exam is managed by the import workflow; use the RC-04 functions';
  end if;
end;
$$;
revoke all on function private.rc04_reject_managed_exam(uuid) from public, anon, authenticated, service_role;

-- events: a managed row is never deleted; client roles never insert/update a managed row or flip the flag
create or replace function private.rc04_guard_exam_event()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.managed_by_rc04 then raise exception 'RC04_MANAGED_EXAM: a managed exam cannot be deleted'; end if;
    return old;
  end if;
  if current_user in ('anon', 'authenticated', 'authenticator', 'service_role')
     and (new.managed_by_rc04 or (tg_op = 'UPDATE' and old.managed_by_rc04)) then
    raise exception 'RC04_MANAGED_EXAM: direct writes to a managed exam are refused';
  end if;
  if tg_op = 'UPDATE' and old.managed_by_rc04 is distinct from new.managed_by_rc04 then
    raise exception 'RC04_MANAGED_EXAM: managed_by_rc04 cannot change';
  end if;
  return new;
end;
$$;
revoke all on function private.rc04_guard_exam_event() from public, anon, authenticated, service_role;
create trigger rc04_guard_exam_event before insert or update or delete on public.resident_exam_events
  for each row execute function private.rc04_guard_exam_event();

-- legacy child tables never hold rows of a managed exam (any role, any path)
create or replace function private.rc04_guard_legacy_child()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op <> 'INSERT' and private.rc04_is_managed_exam(old.event_id))
     or (tg_op <> 'DELETE' and private.rc04_is_managed_exam(new.event_id)) then
    raise exception 'RC04_MANAGED_EXAM: legacy exam tables cannot hold managed exam rows';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.rc04_guard_legacy_child() from public, anon, authenticated, service_role;
create trigger rc04_guard_legacy_child before insert or update or delete on public.resident_exam_participants
  for each row execute function private.rc04_guard_legacy_child();
create trigger rc04_guard_legacy_child before insert or update or delete on public.resident_exam_parts
  for each row execute function private.rc04_guard_legacy_child();
create trigger rc04_guard_legacy_child before insert or update or delete on public.resident_exam_results
  for each row execute function private.rc04_guard_legacy_child();
create trigger rc04_guard_legacy_child before insert or update or delete on public.resident_exam_mpl
  for each row execute function private.rc04_guard_legacy_child();

-- published revisions and their snapshot rows are immutable; audit is append-only
create or replace function private.rc04_guard_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_rev uuid; v_state text;
begin
  if tg_table_name = 'rc04_audit' then raise exception 'RC04_IMMUTABLE: audit is append-only'; end if;
  if tg_table_name = 'rc04_exam_revisions' then
    if tg_op = 'DELETE' or old.state = 'published' then raise exception 'RC04_IMMUTABLE: a published revision cannot change'; end if;
    return new;
  end if;
  v_rev := case when tg_op = 'INSERT' then new.revision_id else old.revision_id end;
  select state into v_state from public.rc04_exam_revisions where id = v_rev;
  if v_state = 'published' then raise exception 'RC04_IMMUTABLE: rows of a published revision cannot change'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.rc04_guard_immutable() from public, anon, authenticated, service_role;
create trigger rc04_immutable before update or delete on public.rc04_exam_revisions
  for each row execute function private.rc04_guard_immutable();
create trigger rc04_immutable before insert or update or delete on public.rc04_revision_parts
  for each row execute function private.rc04_guard_immutable();
create trigger rc04_immutable before insert or update or delete on public.rc04_revision_mpl
  for each row execute function private.rc04_guard_immutable();
create trigger rc04_immutable before insert or update or delete on public.rc04_revision_participants
  for each row execute function private.rc04_guard_immutable();
create trigger rc04_immutable before insert or update or delete on public.rc04_revision_results
  for each row execute function private.rc04_guard_immutable();
create trigger rc04_immutable before update or delete on public.rc04_audit
  for each row execute function private.rc04_guard_immutable();
create trigger rc04_immutable_truncate before truncate on public.rc04_audit
  for each statement execute function private.rc04_guard_immutable();

-- legacy SELECT on events excludes managed exams (managed data is read only through RC-04 RPCs)
drop policy if exists resident_exam_events_visible on public.resident_exam_events;
create policy resident_exam_events_visible on public.resident_exam_events
  for select to authenticated
  using (
    not managed_by_rc04
    and (
      (select private.resident_role_is('admin'))
      or (status = 'published' and ((select private.resident_role_is('staff')) or private.resident_is_exam_participant(id)))
    )
  );

-- ================================================================ 3. legacy functions: reject managed exams / exclude them
-- public.save_resident_exam_scores: current definition (from the migrations at Base), edited only where marked RC-04
CREATE OR REPLACE FUNCTION public.save_resident_exam_scores(p_event_id uuid, p_results jsonb, p_mpl jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
  v_event public.resident_exam_events%rowtype;
  v_result jsonb;
  v_resident_id uuid;
  v_part_id uuid;
  v_max numeric;
  v_score numeric;
  v_pgy smallint;
  v_mpl numeric;
  v_key text;
  v_seen text[] := array[]::text[];
begin
  perform private.rc04_reject_managed_exam(p_event_id);  -- RC-04: legacy writers never touch a managed exam
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  if coalesce(jsonb_typeof(p_results), '') <> 'array' then raise exception 'Results must be an array'; end if;
  select * into v_event from public.resident_exam_events where id = p_event_id for update;
  if not found then raise exception 'Exam was not found'; end if;
  if v_event.scoring_mode <> 'mpl' then raise exception 'This exam records outcomes by hand'; end if;
  if v_event.status <> 'draft' then raise exception 'Return the exam to Draft before editing results'; end if;

  -- The MPL rows (when the Admin changed them) are replaced in the same transaction
  -- as the scores, so a failed score save never leaves a half-applied MPL edit.
  if p_mpl is not null then
    perform private.resident_exam_replace_mpl(p_event_id, p_mpl);
  end if;
  perform set_config('app.exam_mpl_save', 'on', true);
  delete from public.resident_exam_results where event_id = p_event_id;
  for v_result in select value from jsonb_array_elements(p_results) loop
    if jsonb_typeof(v_result) <> 'object'
      or coalesce(v_result->>'residentId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'Exam result is invalid';
    end if;
    v_resident_id := (v_result->>'residentId')::uuid;
    select pgy_at_exam into v_pgy from public.resident_exam_participants
    where event_id = p_event_id and resident_id = v_resident_id;
    if not found then raise exception 'Exam result includes a Resident outside this exam'; end if;

    if v_event.exam_type = 'mcq' then
      if v_result->>'partId' is not null then raise exception 'MCQ result is invalid'; end if;
      v_part_id := null;
      v_max := v_event.max_score;
      v_key := v_resident_id::text;
    else
      if coalesce(v_result->>'partId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'X-ray or Anatomy result is invalid';
      end if;
      v_part_id := (v_result->>'partId')::uuid;
      select max_score into v_max from public.resident_exam_parts
      where id = v_part_id and event_id = p_event_id;
      if not found or v_max is null then raise exception 'X-ray or Anatomy part is invalid'; end if;
      v_key := v_resident_id::text || ':' || v_part_id::text;
    end if;
    if v_key = any(v_seen) then raise exception 'Exam result is duplicated'; end if;
    v_seen := array_append(v_seen, v_key);

    v_score := private.resident_exam_parse_number(v_result->>'score', v_max, 'Score');
    v_mpl := null;
    select mpl into v_mpl from public.resident_exam_mpl
    where event_id = p_event_id and part_id is not distinct from v_part_id and pgy = v_pgy;

    insert into public.resident_exam_results(
      event_id, resident_id, part_id, score, outcome, outcome_source, updated_by, updated_at)
    values (
      p_event_id, v_resident_id, v_part_id, v_score,
      case
        when v_mpl is null then null
        when v_score >= v_mpl then 'pass'
        else 'remediation'
      end,
      'computed', (select auth.uid()), clock_timestamp());
  end loop;
  update public.resident_exam_events
  set updated_by = (select auth.uid()), updated_at = clock_timestamp()
  where id = p_event_id;
end;
$function$;

-- public.save_resident_exam_results: current definition (from the migrations at Base), edited only where marked RC-04
CREATE OR REPLACE FUNCTION public.save_resident_exam_results(p_event_id uuid, p_results jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
  v_event public.resident_exam_events%rowtype;
  v_result jsonb;
  v_resident_id uuid;
  v_part_id uuid;
  v_score numeric;
  v_key text;
  v_seen_keys text[] := array[]::text[];
begin
  perform private.rc04_reject_managed_exam(p_event_id);  -- RC-04: legacy writers never touch a managed exam
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  if coalesce(jsonb_typeof(p_results), '') <> 'array' then raise exception 'Results must be an array'; end if;
  select * into v_event from public.resident_exam_events where id = p_event_id for update;
  if not found then raise exception 'Exam was not found'; end if;
  if v_event.status <> 'draft' then raise exception 'Return the exam to Draft before editing results'; end if;

  for v_result in select value from jsonb_array_elements(p_results) loop
    if jsonb_typeof(v_result) <> 'object'
      or coalesce(v_result->>'residentId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(v_result->>'outcome', '') not in ('pass', 'remediation') then
      raise exception 'Exam result is invalid';
    end if;
    v_resident_id := (v_result->>'residentId')::uuid;
    if not exists (
      select 1 from public.resident_exam_participants
      where event_id = p_event_id and resident_id = v_resident_id
    ) then raise exception 'Exam result includes a Resident outside this exam'; end if;

    if v_event.exam_type = 'mcq' then
      if v_result->>'partId' is not null
        or coalesce(v_result->>'score', '') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
        raise exception 'MCQ score is invalid';
      end if;
      v_score := (v_result->>'score')::numeric;
      if v_score < 0 or v_score > v_event.max_score then raise exception 'MCQ score must be between zero and full score'; end if;
      v_part_id := null;
      v_key := v_resident_id::text;
    else
      if coalesce(v_result->>'partId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or v_result->>'score' is not null then
        raise exception 'X-ray or Anatomy result is invalid';
      end if;
      v_part_id := (v_result->>'partId')::uuid;
      if not exists (select 1 from public.resident_exam_parts where id = v_part_id and event_id = p_event_id) then
        raise exception 'X-ray or Anatomy part is invalid';
      end if;
      v_score := null;
      v_key := v_resident_id::text || ':' || v_part_id::text;
    end if;
    if v_key = any(v_seen_keys) then raise exception 'Exam result is duplicated'; end if;
    v_seen_keys := array_append(v_seen_keys, v_key);
  end loop;

  delete from public.resident_exam_results where event_id = p_event_id;
  for v_result in select value from jsonb_array_elements(p_results) loop
    v_resident_id := (v_result->>'residentId')::uuid;
    if v_event.exam_type = 'mcq' then
      v_part_id := null;
      v_score := (v_result->>'score')::numeric;
    else
      v_part_id := (v_result->>'partId')::uuid;
      v_score := null;
    end if;
    insert into public.resident_exam_results(event_id, resident_id, part_id, score, outcome, updated_by, updated_at)
    values (p_event_id, v_resident_id, v_part_id, v_score, v_result->>'outcome', (select auth.uid()), clock_timestamp());
  end loop;
  update public.resident_exam_events
  set updated_by = (select auth.uid()), updated_at = clock_timestamp()
  where id = p_event_id;
end;
$function$;

-- public.set_resident_exam_publication: current definition (from the migrations at Base), edited only where marked RC-04
CREATE OR REPLACE FUNCTION public.set_resident_exam_publication(p_event_id uuid, p_publish boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
  v_event public.resident_exam_events%rowtype;
  v_expected_count integer;
  v_result_count integer;
begin
  perform private.rc04_reject_managed_exam(p_event_id);  -- RC-04: legacy writers never touch a managed exam
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  select * into v_event from public.resident_exam_events where id = p_event_id for update;
  if not found then raise exception 'Exam was not found'; end if;
  if p_publish then
    if v_event.status <> 'draft' then raise exception 'Exam is already published'; end if;
    select count(*) into v_expected_count from public.resident_exam_participants where event_id = p_event_id;
    if v_event.exam_type = 'xray_anatomy' then
      v_expected_count := v_expected_count * (select count(*) from public.resident_exam_parts where event_id = p_event_id);
    end if;
    select count(*) into v_result_count from public.resident_exam_results where event_id = p_event_id;
    if v_result_count <> v_expected_count then
      raise exception 'Complete every scheduled Resident result before publishing';
    end if;
    update public.resident_exam_events
    set status = 'published', published_by = (select auth.uid()), published_at = clock_timestamp(),
      updated_by = (select auth.uid()), updated_at = clock_timestamp()
    where id = p_event_id;
  else
    if v_event.status <> 'published' then raise exception 'Exam is already Draft'; end if;
    update public.resident_exam_events
    set status = 'draft', updated_by = (select auth.uid()), updated_at = clock_timestamp()
    where id = p_event_id;
  end if;
end;
$function$;

-- public.update_resident_exam_mpl: current definition (from the migrations at Base), edited only where marked RC-04
CREATE OR REPLACE FUNCTION public.update_resident_exam_mpl(p_event_id uuid, p_mpl jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
  v_event public.resident_exam_events%rowtype;
begin
  perform private.rc04_reject_managed_exam(p_event_id);  -- RC-04: legacy writers never touch a managed exam
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  if coalesce(jsonb_typeof(p_mpl), '') <> 'array' then raise exception 'MPL rows must be an array'; end if;
  select * into v_event from public.resident_exam_events where id = p_event_id for update;
  if not found then raise exception 'Exam was not found'; end if;
  if v_event.scoring_mode <> 'mpl' then raise exception 'This exam records outcomes by hand'; end if;
  if v_event.status <> 'draft' then raise exception 'Return the exam to Draft before editing MPL'; end if;

  perform private.resident_exam_replace_mpl(p_event_id, p_mpl);

  update public.resident_exam_events
  set updated_by = (select auth.uid()), updated_at = clock_timestamp()
  where id = p_event_id;
end;
$function$;

-- private.resident_exam_replace_mpl: current definition (from the migrations at Base), edited only where marked RC-04
CREATE OR REPLACE FUNCTION private.resident_exam_replace_mpl(p_event_id uuid, p_mpl jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
  v_event public.resident_exam_events%rowtype;
  v_item jsonb;
  v_part_id uuid;
  v_max numeric;
  v_pgy integer;
  v_key text;
  v_seen text[] := array[]::text[];
begin
  perform private.rc04_reject_managed_exam(p_event_id);  -- RC-04: legacy writers never touch a managed exam
  if coalesce(jsonb_typeof(p_mpl), '') <> 'array' then raise exception 'MPL rows must be an array'; end if;
  select * into v_event from public.resident_exam_events where id = p_event_id;
  if not found then raise exception 'Exam was not found'; end if;

  delete from public.resident_exam_mpl where event_id = p_event_id;
  for v_item in select value from jsonb_array_elements(p_mpl) loop
    if jsonb_typeof(v_item) <> 'object' or coalesce(v_item->>'pgy', '') !~ '^[1-4]$' then
      raise exception 'MPL row is invalid';
    end if;
    v_pgy := (v_item->>'pgy')::integer;
    if v_event.exam_type = 'mcq' then
      if v_item->>'partId' is not null then raise exception 'MPL row is invalid'; end if;
      v_part_id := null;
      v_max := v_event.max_score;
      v_key := v_pgy::text;
    else
      if coalesce(v_item->>'partId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'MPL row is invalid';
      end if;
      v_part_id := (v_item->>'partId')::uuid;
      select max_score into v_max from public.resident_exam_parts
      where id = v_part_id and event_id = p_event_id;
      if not found or v_max is null then raise exception 'MPL row is invalid'; end if;
      v_key := v_part_id::text || ':' || v_pgy::text;
    end if;
    if v_key = any(v_seen) then raise exception 'MPL row is duplicated'; end if;
    v_seen := array_append(v_seen, v_key);
    insert into public.resident_exam_mpl(event_id, part_id, pgy, mpl)
    values (p_event_id, v_part_id, v_pgy, private.resident_exam_parse_number(v_item->>'mpl', v_max, 'MPL'));
  end loop;

  update public.resident_exam_results result
  set outcome = (
        select case when result.score >= m.mpl then 'pass' else 'remediation' end
        from public.resident_exam_mpl m
        where m.event_id = result.event_id
          and m.part_id is not distinct from result.part_id
          and m.pgy = participant.pgy_at_exam
      ),
      outcome_source = 'computed',
      updated_by = (select auth.uid()),
      updated_at = clock_timestamp()
  from public.resident_exam_participants participant
  where result.event_id = p_event_id
    and participant.event_id = result.event_id
    and participant.resident_id = result.resident_id;
end;
$function$;

-- public.delete_resident_exam_event: current definition (from the migrations at Base), edited only where marked RC-04
CREATE OR REPLACE FUNCTION public.delete_resident_exam_event(p_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
  v_event public.resident_exam_events%rowtype;
begin
  perform private.rc04_reject_managed_exam(p_event_id);  -- RC-04: legacy writers never touch a managed exam
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  select * into v_event from public.resident_exam_events where id = p_event_id for update;
  if not found then raise exception 'Exam was not found'; end if;
  if v_event.status <> 'draft' then raise exception 'Return the exam to Draft before deleting it'; end if;
  perform set_config('app.exam_mpl_save', 'on', true);
  delete from public.resident_exam_events where id = p_event_id;
end;
$function$;

-- public.list_resident_exam_records: current definition (from the migrations at Base), edited only where marked RC-04
CREATE OR REPLACE FUNCTION public.list_resident_exam_records()
 RETURNS TABLE(event_id uuid, exam_type text, exam_date date, title text, max_score numeric, status text, participant_id uuid, resident_name text, resident_pgy smallint, part_id uuid, part_name text, part_sort_order smallint, score numeric, outcome text, result_updated_at timestamp with time zone, scoring_mode text, part_max_score numeric, pgy_at_exam smallint, mpl numeric, outcome_source text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'auth'
AS $function$
begin
  if not (
    (select private.resident_role_is('admin'))
    or (select private.resident_role_is('staff'))
    or (select private.resident_role_is('resident'))
  ) then raise exception 'Active Resident, Staff, or Admin account required'; end if;
  return query
    select event.id, event.exam_type, event.exam_date, event.title, event.max_score,
      event.status, participant.resident_id, profile.full_name, profile.pgy,
      part.id, part.part_name, part.sort_order, result.score, result.outcome, result.updated_at,
      event.scoring_mode, part.max_score, participant.pgy_at_exam, mpl_row.mpl, result.outcome_source
    from public.resident_exam_events event
    join public.resident_exam_participants participant on participant.event_id = event.id
    join public.resident_profiles profile on profile.user_id = participant.resident_id
    left join public.resident_exam_parts part on part.event_id = event.id
    left join public.resident_exam_results result
      on result.event_id = event.id and result.resident_id = participant.resident_id
        and result.part_id is not distinct from part.id
    left join public.resident_exam_mpl mpl_row
      on mpl_row.event_id = event.id and mpl_row.part_id is not distinct from part.id
        and mpl_row.pgy = participant.pgy_at_exam
    where not event.managed_by_rc04  -- RC-04: legacy reader has no value_state; managed exams are read via RC-04 RPCs
      and (
        (select private.resident_role_is('admin'))
        or (
          event.status = 'published'
          and (
            (select private.resident_role_is('staff'))
            or participant.resident_id = (select auth.uid())
          )
        )
      )
    order by event.exam_date desc, event.created_at desc, profile.full_name, part.sort_order nulls first;
end;
$function$;


-- ================================================================ 4. private helpers (not callable by any client role)
create or replace function private.rc04_require_admin()
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'RC04_FORBIDDEN: Active Admin account required';
  end if;
  return (select auth.uid());
end;
$$;

create or replace function private.rc04_fp(p jsonb)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p, 'null'::jsonb)::text, 'UTF8')), 'hex');
$$;

-- Receipt reservation: INSERT ... ON CONFLICT DO NOTHING waits for an in-flight transaction holding the same key,
-- so two identical requests serialise; the loser then reads the committed receipt. Same key + different payload
-- = IDEMPOTENCY_KEY_REUSED. Returns the stored result (replay) or NULL (new request, continue).
create or replace function private.rc04_receipt_begin(p_actor uuid, p_operation text, p_request_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_fp text := private.rc04_fp(p_payload); v_row public.rc04_request_receipts%rowtype; v_new boolean;
begin
  if p_request_id is null then raise exception 'RC04_INVALID_INPUT: request_id is required'; end if;
  insert into public.rc04_request_receipts (actor_id, operation, request_id, payload_fingerprint)
  values (p_actor, p_operation, p_request_id, v_fp)
  on conflict do nothing
  returning true into v_new;
  if v_new then return null; end if;
  select * into v_row from public.rc04_request_receipts
   where actor_id = p_actor and operation = p_operation and request_id = p_request_id;
  if v_row.payload_fingerprint <> v_fp then
    raise exception 'RC04_IDEMPOTENCY_KEY_REUSED: this request_id was already used with a different payload';
  end if;
  return v_row.result || jsonb_build_object('replayed', true);
end;
$$;

create or replace function private.rc04_receipt_finish(p_actor uuid, p_operation text, p_request_id uuid, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update public.rc04_request_receipts set result = p_result
   where actor_id = p_actor and operation = p_operation and request_id = p_request_id;
  return p_result || jsonb_build_object('replayed', false);
end;
$$;

create or replace function private.rc04_lock_exam(p_exam_id uuid)
returns public.resident_exam_events language plpgsql security definer set search_path = '' as $$
declare v public.resident_exam_events%rowtype;
begin
  select * into v from public.resident_exam_events where id = p_exam_id for no key update;
  if not found or not v.managed_by_rc04 then raise exception 'RC04_NOT_FOUND: managed exam not found'; end if;
  return v;
end;
$$;

-- lock every revision of the exam in sequence order and return the requested one
create or replace function private.rc04_lock_revision(p_exam_id uuid, p_revision_id uuid)
returns public.rc04_exam_revisions language plpgsql security definer set search_path = '' as $$
declare v public.rc04_exam_revisions%rowtype; r record;
begin
  for r in select id from public.rc04_exam_revisions where exam_id = p_exam_id order by seq for no key update loop null; end loop;
  select * into v from public.rc04_exam_revisions where id = p_revision_id and exam_id = p_exam_id;
  if not found then raise exception 'RC04_NOT_FOUND: revision not found for this exam'; end if;
  return v;
end;
$$;

create or replace function private.rc04_require_working(p_rev public.rc04_exam_revisions, p_expected_version integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_rev.state <> 'working' then raise exception 'RC04_NOT_WORKING: only the working revision can change'; end if;
  if p_expected_version is null or p_rev.version <> p_expected_version then
    raise exception 'RC04_REVISION_CONFLICT: the revision is at version % (you sent %); reload and preview again', p_rev.version, p_expected_version;
  end if;
end;
$$;

-- recompute outcome of scored rows from the revision's own MPL snapshot (criteria missing => outcome null)
create or replace function private.rc04_recompute(p_revision_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update public.rc04_revision_results r
     set outcome = x.new_outcome
    from (
      select res.resident_id, res.part_id,
             case when m.mpl is null then null when res.score >= m.mpl then 'pass' else 'fail' end as new_outcome
        from public.rc04_revision_results res
        join public.rc04_revision_participants p on p.revision_id = res.revision_id and p.resident_id = res.resident_id
        left join public.rc04_revision_mpl m on m.revision_id = res.revision_id and m.part_id = res.part_id and m.pgy = p.pgy_at_exam
       where res.revision_id = p_revision_id and res.value_state = 'scored'
    ) x
   where r.revision_id = p_revision_id and r.resident_id = x.resident_id and r.part_id = x.part_id
     and r.outcome is distinct from x.new_outcome;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- any change to a working revision: new version, review cleared, open previews expired
create or replace function private.rc04_bump(p_revision_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  update public.rc04_exam_revisions
     set version = version + 1, checked_version = null, checked_by = null, checked_at = null
   where id = p_revision_id returning version into v;
  update public.rc04_import_previews set expires_at = least(expires_at, clock_timestamp())
   where revision_id = p_revision_id and consumed_at is null;
  return v;
end;
$$;

-- validation used by review, publish and the Admin view (P01 rules)
create or replace function private.rc04_validation(p_revision_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with cells as (
    select r.value_state, r.score, pa.max_score, p.pgy_at_exam, m.mpl
      from public.rc04_revision_results r
      join public.rc04_revision_participants p on p.revision_id = r.revision_id and p.resident_id = r.resident_id
      join public.rc04_revision_parts pa on pa.revision_id = r.revision_id and pa.part_id = r.part_id
      left join public.rc04_revision_mpl m on m.revision_id = r.revision_id and m.part_id = r.part_id and m.pgy = p.pgy_at_exam
     where r.revision_id = p_revision_id
  ), crit as (
    select count(*) as missing
      from (select distinct p.pgy_at_exam from public.rc04_revision_participants p where p.revision_id = p_revision_id) g
      cross join public.rc04_revision_parts pa
      left join public.rc04_revision_mpl m on m.revision_id = pa.revision_id and m.part_id = pa.part_id and m.pgy = g.pgy_at_exam
     where pa.revision_id = p_revision_id and m.mpl is null
  ), c as (
    select count(*) as cells,
           count(*) filter (where value_state = 'scored') as scored,
           count(*) filter (where value_state = 'absent') as absent,
           count(*) filter (where value_state = 'awaiting') as awaiting,
           count(*) filter (where value_state = 'unknown') as unknown,
           count(*) filter (where value_state = 'scored' and score > max_score) as over_max,
           count(*) filter (where mpl is not null and mpl > max_score) as mpl_over_max
      from cells
  )
  select jsonb_build_object(
    'counts', jsonb_build_object('cells', c.cells, 'scored', c.scored, 'absent', c.absent, 'awaiting', c.awaiting,
                                 'unknown', c.unknown, 'criteria_missing', crit.missing),
    'blockers', (select coalesce(jsonb_agg(b), '[]'::jsonb) from (
        select jsonb_build_object('code', 'UNKNOWN_CELLS', 'count', c.unknown) b where c.unknown > 0
        union all select jsonb_build_object('code', 'CRITERIA_MISSING', 'count', crit.missing) where crit.missing > 0
        union all select jsonb_build_object('code', 'SCORE_EXCEEDS_MAX', 'count', c.over_max) where c.over_max > 0
        union all select jsonb_build_object('code', 'MPL_EXCEEDS_MAX', 'count', c.mpl_over_max) where c.mpl_over_max > 0
        union all select jsonb_build_object('code', 'EMPTY_ROSTER_OR_PARTS', 'count', 0) where c.cells = 0) x))
  from c, crit;
$$;

-- overall for one resident in one revision (§5.3): completeness and failed parts are reported separately
create or replace function private.rc04_overall(p_revision_id uuid, p_resident_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with x as (
    select pa.part_id, pa.sort_order, r.value_state, r.outcome, m.mpl
      from public.rc04_revision_results r
      join public.rc04_revision_participants p on p.revision_id = r.revision_id and p.resident_id = r.resident_id
      join public.rc04_revision_parts pa on pa.revision_id = r.revision_id and pa.part_id = r.part_id
      left join public.rc04_revision_mpl m on m.revision_id = r.revision_id and m.part_id = r.part_id and m.pgy = p.pgy_at_exam
     where r.revision_id = p_revision_id and r.resident_id = p_resident_id
  )
  select jsonb_build_object(
    'status', case
      when bool_or(value_state = 'unknown' or mpl is null) then 'not_ready'
      when bool_or(value_state in ('absent', 'awaiting')) then 'incomplete'
      when bool_or(outcome = 'fail') then 'failed_some'
      else 'all_passed' end,
    'failed_part_ids', coalesce(jsonb_agg(part_id order by sort_order) filter (where outcome = 'fail'), '[]'::jsonb),
    'absent_part_ids', coalesce(jsonb_agg(part_id order by sort_order) filter (where value_state = 'absent'), '[]'::jsonb),
    'awaiting_part_ids', coalesce(jsonb_agg(part_id order by sort_order) filter (where value_state = 'awaiting'), '[]'::jsonb),
    'unknown_part_ids', coalesce(jsonb_agg(part_id order by sort_order) filter (where value_state = 'unknown'), '[]'::jsonb),
    'criteria_missing_part_ids', coalesce(jsonb_agg(part_id order by sort_order) filter (where mpl is null), '[]'::jsonb))
  from x;
$$;

create or replace function private.rc04_audit(p_exam uuid, p_rev uuid, p_actor uuid, p_op text, p_reason text,
  p_before integer, p_after integer, p_batch uuid, p_details jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.rc04_audit (exam_id, revision_id, actor_id, operation, reason, before_version, after_version, batch_id, details)
  values (p_exam, p_rev, p_actor, p_op, p_reason, p_before, p_after, p_batch, coalesce(p_details, '{}'::jsonb));
$$;

-- strict score from a JSON value: a JSON number, finite, 0..max, at most 2 decimals; returns error code or null
create or replace function private.rc04_score_error(p_value jsonb, p_max numeric)
returns text language plpgsql immutable set search_path = '' as $$
declare v numeric;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'number' then return 'INVALID_SCORE_TYPE'; end if;
  v := (p_value #>> '{}')::numeric;
  if v < 0 then return 'SCORE_NEGATIVE'; end if;
  if v > p_max then return 'SCORE_EXCEEDS_MAX'; end if;
  if v <> round(v, 2) then return 'SCORE_TOO_PRECISE'; end if;
  return null;
end;
$$;

-- B002-B02: what the file reports about itself. SQL NULL (argument omitted) = no file metadata sent (allowed; it does
-- NOT prove anything about an XLSX). Otherwise it must be a JSON object with the required keys, correct types and no
-- nulls; values are compared with IS DISTINCT FROM. Returns a JSON array of validation errors (empty = ok).
create or replace function private.rc04_file_reported_errors(p jsonb, p_exam_id uuid, p_revision_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  e jsonb := '[]'::jsonb; v_rev public.rc04_exam_revisions%rowtype; k text; x jsonb; v_ok boolean;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_seen text[] := '{}';
begin
  if p is null then return e; end if;
  if jsonb_typeof(p) <> 'object' then
    return jsonb_build_array(jsonb_build_object('code', 'FILE_REPORTED_NOT_OBJECT', 'found', jsonb_typeof(p)));
  end if;
  select * into v_rev from public.rc04_exam_revisions where id = p_revision_id;
  for k in select jsonb_object_keys(p) loop
    if k not in ('template_version', 'exam_id', 'revision_id', 'version', 'academic_year', 'roster', 'parts') then
      e := e || jsonb_build_object('code', 'FILE_REPORTED_UNKNOWN_KEY', 'key', k);
    end if;
  end loop;
  -- required scalars: key present, not null, right type
  foreach k in array array['template_version', 'exam_id', 'revision_id', 'version', 'academic_year'] loop
    if not p ? k then e := e || jsonb_build_object('code', 'FILE_REPORTED_MISSING_KEY', 'key', k); continue; end if;
    if jsonb_typeof(p->k) = 'null' then e := e || jsonb_build_object('code', 'FILE_REPORTED_NULL', 'key', k); continue; end if;
    v_ok := case
      when k = 'template_version' then jsonb_typeof(p->k) = 'string'
      when k in ('exam_id', 'revision_id') then jsonb_typeof(p->k) = 'string' and (p->>k) ~ v_uuid
      else jsonb_typeof(p->k) = 'number' and (p->>k) ~ '^[0-9]{1,9}$' end;
    if not v_ok then e := e || jsonb_build_object('code', 'FILE_REPORTED_WRONG_TYPE', 'key', k); end if;
  end loop;
  -- optional arrays: absent is fine (partial file); present must be an array of well-typed objects
  foreach k in array array['roster', 'parts'] loop
    if p ? k and jsonb_typeof(p->k) <> 'array' then e := e || jsonb_build_object('code', 'FILE_REPORTED_WRONG_TYPE', 'key', k); end if;
  end loop;
  if jsonb_array_length(e) > 0 then return e; end if;

  if p->>'template_version' is distinct from 'RC04-TEMPLATE-1' then e := e || jsonb_build_object('code', 'TEMPLATE_VERSION_MISMATCH'); end if;
  if (p->>'exam_id')::uuid is distinct from p_exam_id then e := e || jsonb_build_object('code', 'EXAM_MISMATCH'); end if;
  if (p->>'revision_id')::uuid is distinct from p_revision_id then e := e || jsonb_build_object('code', 'REVISION_MISMATCH'); end if;
  if (p->>'version')::integer is distinct from v_rev.version then e := e || jsonb_build_object('code', 'TEMPLATE_OUTDATED'); end if;
  if (p->>'academic_year')::integer is distinct from v_rev.academic_year then e := e || jsonb_build_object('code', 'ACADEMIC_YEAR_MISMATCH'); end if;

  for x in select * from jsonb_array_elements(coalesce(p->'roster', '[]'::jsonb)) loop
    if jsonb_typeof(x) <> 'object' or jsonb_typeof(x->'resident_id') is distinct from 'string' or (x->>'resident_id') !~ v_uuid
       or jsonb_typeof(x->'pgy_at_exam') is distinct from 'number' or (x->>'pgy_at_exam') !~ '^[0-9]{1,4}$'
       or (x ? 'cell_ref' and jsonb_typeof(x->'cell_ref') not in ('string', 'null')) then
      e := e || jsonb_build_object('code', 'FILE_REPORTED_WRONG_TYPE', 'key', 'roster', 'item', x); continue;
    end if;
    if ('r' || (x->>'resident_id')) = any (v_seen) then e := e || jsonb_build_object('code', 'FILE_REPORTED_DUPLICATE', 'resident_id', x->>'resident_id'); continue; end if;
    v_seen := v_seen || ('r' || (x->>'resident_id'));
    if not exists (select 1 from public.rc04_revision_participants where revision_id = p_revision_id
                    and resident_id = (x->>'resident_id')::uuid and pgy_at_exam = (x->>'pgy_at_exam')::integer) then
      e := e || jsonb_build_object('code', 'ROSTER_OR_PGY_MISMATCH', 'resident_id', x->>'resident_id', 'cell_ref', x->>'cell_ref');
    end if;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p->'parts', '[]'::jsonb)) loop
    if jsonb_typeof(x) <> 'object' or jsonb_typeof(x->'part_id') is distinct from 'string' or (x->>'part_id') !~ v_uuid
       or jsonb_typeof(x->'max_score') is distinct from 'number' or jsonb_typeof(x->'mpl') is distinct from 'object'
       or exists (select 1 from jsonb_each(x->'mpl') m where m.key !~ '^[1-4]$' or jsonb_typeof(m.value) <> 'number')
       or (x ? 'cell_ref' and jsonb_typeof(x->'cell_ref') not in ('string', 'null')) then
      e := e || jsonb_build_object('code', 'FILE_REPORTED_WRONG_TYPE', 'key', 'parts', 'item', x); continue;
    end if;
    if ('p' || (x->>'part_id')) = any (v_seen) then e := e || jsonb_build_object('code', 'FILE_REPORTED_DUPLICATE', 'part_id', x->>'part_id'); continue; end if;
    v_seen := v_seen || ('p' || (x->>'part_id'));
    if not exists (select 1 from public.rc04_revision_parts pa where pa.revision_id = p_revision_id
                    and pa.part_id = (x->>'part_id')::uuid and pa.max_score = (x->>'max_score')::numeric
                    and (select coalesce(jsonb_object_agg(m.pgy::text, m.mpl), '{}'::jsonb) from public.rc04_revision_mpl m
                          where m.revision_id = pa.revision_id and m.part_id = pa.part_id)
                        = (select coalesce(jsonb_object_agg(f.key, (f.value::text)::numeric), '{}'::jsonb) from jsonb_each(x->'mpl') f)) then
      e := e || jsonb_build_object('code', 'PART_OR_CRITERIA_MISMATCH', 'part_id', x->>'part_id', 'cell_ref', x->>'cell_ref');
    end if;
  end loop;
  return e;
end;
$$;

do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private' and p.proname like 'rc04\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
end $$;

-- ================================================================ 5. Admin write RPCs
-- create managed exam: everything in one transaction (event + revision 1 + parts + MPL + roster + unknown cells)
create or replace function public.rc04_create_managed_exam(p_request_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.rc04_require_admin();
  v_replay jsonb; v_exam uuid := gen_random_uuid(); v_rev uuid := gen_random_uuid();
  v_title text := btrim(coalesce(p_payload->>'title', ''));
  v_date date; v_year integer; v_part jsonb; v_r jsonb; v_part_id uuid; v_k text; v_name text;
  v_roster integer; v_parts integer; v_result jsonb;
begin
  v_replay := private.rc04_receipt_begin(v_actor, 'create_managed_exam', p_request_id, p_payload);
  if v_replay is not null then return v_replay; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'RC04_INVALID_INPUT: payload must be an object'; end if;
  if coalesce(p_payload->>'exam_type', '') <> 'xray_anatomy' then raise exception 'RC04_INVALID_INPUT: exam_type must be xray_anatomy'; end if;
  if char_length(v_title) not between 1 and 160 then raise exception 'RC04_INVALID_INPUT: title must be 1-160 characters'; end if;
  begin v_date := (p_payload->>'exam_date')::date; v_year := (p_payload->>'academic_year')::integer;
  exception when others then raise exception 'RC04_INVALID_INPUT: exam_date (YYYY-MM-DD) and academic_year (Buddhist year) are required'; end;
  if v_date is null or v_year is null or v_year not between 2500 and 2700 then
    raise exception 'RC04_INVALID_INPUT: exam_date and academic_year (2500-2700) are required';
  end if;
  v_roster := jsonb_array_length(coalesce(p_payload->'roster', '[]'::jsonb));
  v_parts := jsonb_array_length(coalesce(p_payload->'parts', '[]'::jsonb));
  if v_roster not between 1 and 200 then raise exception 'RC04_LIMIT: roster must have 1-200 residents'; end if;
  if v_parts not between 1 and 50 then raise exception 'RC04_LIMIT: an exam must have 1-50 parts'; end if;
  if (select count(distinct r->>'resident_id') from jsonb_array_elements(p_payload->'roster') r) <> v_roster then
    raise exception 'RC04_INVALID_INPUT: a resident appears twice in the roster';
  end if;

  insert into public.resident_exam_events (id, exam_type, exam_date, title, max_score, status, created_by, updated_by, scoring_mode, managed_by_rc04)
  values (v_exam, 'xray_anatomy', v_date, v_title, null, 'draft', v_actor, v_actor, 'mpl', true);
  insert into public.rc04_exam_revisions (id, exam_id, seq, state, version, academic_year, exam_date, exam_type, title, created_by)
  values (v_rev, v_exam, 1, 'working', 1, v_year, v_date, 'xray_anatomy', v_title, v_actor);

  for v_part in select * from jsonb_array_elements(p_payload->'parts') loop
    v_part_id := gen_random_uuid();
    begin
      insert into public.rc04_revision_parts (revision_id, exam_id, part_id, name, sort_order, max_score)
      values (v_rev, v_exam, v_part_id, btrim(v_part->>'name'), (v_part->>'sort_order')::smallint, (v_part->>'max_score')::numeric);
    exception when others then raise exception 'RC04_INVALID_INPUT: part % is invalid (name, sort_order 1-50 unique, max_score > 0)', v_part->>'sort_order'; end;
    for v_k in select jsonb_object_keys(coalesce(v_part->'mpl', '{}'::jsonb)) loop
      begin
        insert into public.rc04_revision_mpl (revision_id, part_id, pgy, mpl)
        values (v_rev, v_part_id, v_k::smallint, (v_part->'mpl'->>v_k)::numeric);
      exception when others then raise exception 'RC04_INVALID_INPUT: MPL of part % for PGY % is invalid', v_part->>'sort_order', v_k; end;
    end loop;
  end loop;

  for v_r in select * from jsonb_array_elements(p_payload->'roster') loop
    select p.full_name into v_name from public.resident_profiles p
      join public.resident_user_roles ur on ur.user_id = p.user_id and ur.role = 'resident'
     where p.user_id = (v_r->>'resident_id')::uuid;
    if not found then raise exception 'RC04_INVALID_INPUT: % is not a Resident account', v_r->>'resident_id'; end if;
    begin
      insert into public.rc04_revision_participants (revision_id, exam_id, resident_id, pgy_at_exam, reference_name)
      values (v_rev, v_exam, (v_r->>'resident_id')::uuid, (v_r->>'pgy_at_exam')::smallint,
              coalesce(nullif(btrim(v_r->>'reference_name'), ''), v_name));
    exception when others then raise exception 'RC04_INVALID_INPUT: roster entry % needs pgy_at_exam 1-4 (confirmed by the Admin)', v_r->>'resident_id'; end;
  end loop;

  insert into public.rc04_revision_results (revision_id, resident_id, part_id, value_state, updated_by)
  select v_rev, p.resident_id, pa.part_id, 'unknown', v_actor
    from public.rc04_revision_participants p cross join public.rc04_revision_parts pa
   where p.revision_id = v_rev and pa.revision_id = v_rev;
  if exists (select 1 from public.rc04_revision_mpl m join public.rc04_revision_parts pa using (revision_id, part_id)
              where m.revision_id = v_rev and m.mpl > pa.max_score) then
    raise exception 'RC04_INVALID_INPUT: an MPL is higher than the part maximum';
  end if;

  perform private.rc04_audit(v_exam, v_rev, v_actor, 'exam.create', null, null, 1, null,
    jsonb_build_object('participants', v_roster, 'parts', v_parts));
  v_result := jsonb_build_object('exam_id', v_exam, 'revision_id', v_rev, 'version', 1, 'state', 'working');
  return private.rc04_receipt_finish(v_actor, 'create_managed_exam', p_request_id, v_result);
end;
$$;

-- edit the working revision snapshot (metadata, roster, PGY, names, part name/max, MPL). Only values that really
-- change count (B002-B03): if nothing changes the call is a no-op that keeps version, review and previews.
-- A real change bumps version, clears review, expires previews and recomputes outcomes. Final roster 1-200 (B002-B01).
-- Published rows are never touched.
create or replace function public.rc04_update_working_revision(p_request_id uuid, p_exam_id uuid, p_revision_id uuid,
  p_expected_version integer, p_changes jsonb, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.rc04_require_admin();
  v_replay jsonb; v_rev public.rc04_exam_revisions%rowtype; v_x jsonb; v_k text; v_before integer; v_after integer;
  v_needs_reason boolean := false; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_result jsonb;
  v_name text; v_n integer := 0; v_rc integer; v_title text; v_date date; v_year integer; v_pgy smallint; v_ref text;
  v_pname text; v_max numeric; v_mpl numeric; v_roster integer; v_changed_keys text[] := '{}';
begin
  v_replay := private.rc04_receipt_begin(v_actor, 'update_working_revision', p_request_id,
    jsonb_build_object('exam_id', p_exam_id, 'revision_id', p_revision_id, 'expected_version', p_expected_version, 'changes', p_changes, 'reason', p_reason));
  if v_replay is not null then return v_replay; end if;
  perform private.rc04_lock_exam(p_exam_id);
  v_rev := private.rc04_lock_revision(p_exam_id, p_revision_id);
  perform private.rc04_require_working(v_rev, p_expected_version);
  v_before := v_rev.version;
  if jsonb_typeof(p_changes) is distinct from 'object' then raise exception 'RC04_INVALID_INPUT: changes must be an object'; end if;
  for v_k in select jsonb_object_keys(p_changes) loop
    if v_k not in ('title', 'exam_date', 'academic_year', 'participants', 'add_participants', 'remove_participants', 'parts') then
      raise exception 'RC04_INVALID_INPUT: % cannot be changed here', v_k;
    end if;
    if v_k in ('participants', 'add_participants', 'remove_participants', 'parts') and jsonb_typeof(p_changes->v_k) is distinct from 'array' then
      raise exception 'RC04_INVALID_INPUT: % must be an array', v_k;
    end if;
  end loop;

  -- metadata: compare normalized values
  begin
    v_title := case when p_changes ? 'title' then btrim(p_changes->>'title') else v_rev.title end;
    v_date := case when p_changes ? 'exam_date' then (p_changes->>'exam_date')::date else v_rev.exam_date end;
    v_year := case when p_changes ? 'academic_year' then (p_changes->>'academic_year')::integer else v_rev.academic_year end;
  exception when others then raise exception 'RC04_INVALID_INPUT: title 1-160, exam_date YYYY-MM-DD, academic_year 2500-2700'; end;
  if v_title is null or v_date is null or v_year is null or char_length(v_title) not between 1 and 160 or v_year not between 2500 and 2700 then
    raise exception 'RC04_INVALID_INPUT: title 1-160, exam_date YYYY-MM-DD, academic_year 2500-2700';
  end if;
  if (v_title, v_date, v_year) is distinct from (v_rev.title, v_rev.exam_date, v_rev.academic_year) then
    update public.rc04_exam_revisions set title = v_title, exam_date = v_date, academic_year = v_year where id = p_revision_id;
    v_n := v_n + 1; v_changed_keys := array_append(v_changed_keys, 'metadata');
  end if;

  for v_x in select * from jsonb_array_elements(p_changes->'participants') loop
    if not exists (select 1 from public.rc04_revision_participants where revision_id = p_revision_id and resident_id::text = v_x->>'resident_id') then
      raise exception 'RC04_INVALID_INPUT: % is not in this roster', v_x->>'resident_id';
    end if;
    begin
      v_pgy := (v_x->>'pgy_at_exam')::smallint; v_ref := nullif(btrim(v_x->>'reference_name'), '');
      update public.rc04_revision_participants set
        pgy_at_exam = coalesce(v_pgy, pgy_at_exam), reference_name = coalesce(v_ref, reference_name)
      where revision_id = p_revision_id and resident_id = (v_x->>'resident_id')::uuid
        and (pgy_at_exam is distinct from coalesce(v_pgy, pgy_at_exam) or reference_name is distinct from coalesce(v_ref, reference_name));
      get diagnostics v_rc = row_count;
    exception when others then raise exception 'RC04_INVALID_INPUT: participant % has an invalid PGY or name', v_x->>'resident_id'; end;
    if v_rc > 0 then v_n := v_n + 1; v_changed_keys := array_append(v_changed_keys, 'participants'); end if;
  end loop;

  -- remove/add always change results and provenance (a removed-then-added resident starts again as unknown)
  for v_x in select * from jsonb_array_elements(p_changes->'remove_participants') loop
    if exists (select 1 from public.rc04_revision_results where revision_id = p_revision_id
                and resident_id::text = v_x #>> '{}' and value_state <> 'unknown') then
      v_needs_reason := true;
    end if;
    delete from public.rc04_revision_participants where revision_id = p_revision_id and resident_id::text = v_x #>> '{}';
    if not found then raise exception 'RC04_INVALID_INPUT: % is not in this roster', v_x #>> '{}'; end if;
    v_n := v_n + 1; v_changed_keys := array_append(v_changed_keys, 'remove_participants');
  end loop;

  for v_x in select * from jsonb_array_elements(p_changes->'add_participants') loop
    select p.full_name into v_name from public.resident_profiles p
      join public.resident_user_roles ur on ur.user_id = p.user_id and ur.role = 'resident'
     where p.user_id::text = v_x->>'resident_id';
    if not found then raise exception 'RC04_INVALID_INPUT: % is not a Resident account', v_x->>'resident_id'; end if;
    begin
      insert into public.rc04_revision_participants (revision_id, exam_id, resident_id, pgy_at_exam, reference_name)
      values (p_revision_id, p_exam_id, (v_x->>'resident_id')::uuid, (v_x->>'pgy_at_exam')::smallint,
              coalesce(nullif(btrim(v_x->>'reference_name'), ''), v_name));
    exception when unique_violation then raise exception 'RC04_INVALID_INPUT: % is already in the roster', v_x->>'resident_id';
              when others then raise exception 'RC04_INVALID_INPUT: % needs pgy_at_exam 1-4', v_x->>'resident_id'; end;
    insert into public.rc04_revision_results (revision_id, resident_id, part_id, value_state, updated_by)
    select p_revision_id, (v_x->>'resident_id')::uuid, part_id, 'unknown', v_actor from public.rc04_revision_parts where revision_id = p_revision_id;
    v_n := v_n + 1; v_changed_keys := array_append(v_changed_keys, 'add_participants');
  end loop;

  for v_x in select * from jsonb_array_elements(p_changes->'parts') loop
    if not exists (select 1 from public.rc04_revision_parts where revision_id = p_revision_id and part_id::text = v_x->>'part_id') then
      raise exception 'RC04_INVALID_INPUT: part % is not in this revision', v_x->>'part_id';
    end if;
    begin
      v_pname := nullif(btrim(v_x->>'name'), ''); v_max := (v_x->>'max_score')::numeric;
    exception when others then raise exception 'RC04_INVALID_INPUT: part % name or max_score is invalid', v_x->>'part_id'; end;
    if v_max is not null and exists (select 1 from public.rc04_revision_results where revision_id = p_revision_id
          and part_id::text = v_x->>'part_id' and value_state = 'scored' and score > v_max) then
      raise exception 'RC04_SCORE_EXCEEDS_NEW_MAX: a recorded score is higher than the new maximum of part %', v_x->>'part_id';
    end if;
    begin
      update public.rc04_revision_parts set name = coalesce(v_pname, name), max_score = coalesce(v_max, max_score)
      where revision_id = p_revision_id and part_id = (v_x->>'part_id')::uuid
        and (name is distinct from coalesce(v_pname, name) or max_score is distinct from coalesce(v_max, max_score));
      get diagnostics v_rc = row_count;
    exception when others then raise exception 'RC04_INVALID_INPUT: part % name or max_score is invalid', v_x->>'part_id'; end;
    if v_rc > 0 then v_n := v_n + 1; v_changed_keys := array_append(v_changed_keys, 'parts'); end if;
    if v_x ? 'mpl' and jsonb_typeof(v_x->'mpl') is distinct from 'object' then
      raise exception 'RC04_INVALID_INPUT: mpl of part % must be an object', v_x->>'part_id';
    end if;
    for v_k in select jsonb_object_keys(coalesce(v_x->'mpl', '{}'::jsonb)) loop
      if jsonb_typeof(v_x->'mpl'->v_k) = 'null' then
        begin
          delete from public.rc04_revision_mpl where revision_id = p_revision_id and part_id = (v_x->>'part_id')::uuid and pgy = v_k::smallint;
          get diagnostics v_rc = row_count;
        exception when others then raise exception 'RC04_INVALID_INPUT: MPL of part % for PGY % is invalid', v_x->>'part_id', v_k; end;
      else
        begin
          v_mpl := (v_x->'mpl'->>v_k)::numeric;
          insert into public.rc04_revision_mpl (revision_id, part_id, pgy, mpl)
          values (p_revision_id, (v_x->>'part_id')::uuid, v_k::smallint, v_mpl)
          on conflict (revision_id, part_id, pgy) do update set mpl = excluded.mpl
            where public.rc04_revision_mpl.mpl is distinct from excluded.mpl;
          get diagnostics v_rc = row_count;
        exception when others then raise exception 'RC04_INVALID_INPUT: MPL of part % for PGY % is invalid', v_x->>'part_id', v_k; end;
      end if;
      if v_rc > 0 then v_n := v_n + 1; v_changed_keys := array_append(v_changed_keys, 'mpl'); end if;
    end loop;
  end loop;

  if exists (select 1 from public.rc04_revision_mpl m join public.rc04_revision_parts pa using (revision_id, part_id)
              where m.revision_id = p_revision_id and m.mpl > pa.max_score) then
    raise exception 'RC04_INVALID_INPUT: an MPL is higher than the part maximum';
  end if;
  select count(*) into v_roster from public.rc04_revision_participants where revision_id = p_revision_id;
  if v_roster = 0 then raise exception 'RC04_INVALID_INPUT: the roster cannot become empty'; end if;
  if v_roster > 200 then raise exception 'RC04_LIMIT: the roster would have % residents (maximum 200)', v_roster; end if;
  if v_needs_reason and v_reason is null then raise exception 'RC04_REASON_REQUIRED: removing a resident with recorded results needs a reason'; end if;
  if v_reason is not null and char_length(v_reason) > 300 then raise exception 'RC04_INVALID_INPUT: reason is longer than 300 characters'; end if;
  if v_n = 0 then
    v_result := jsonb_build_object('exam_id', p_exam_id, 'revision_id', p_revision_id, 'version', v_before, 'noop', true);
    return private.rc04_receipt_finish(v_actor, 'update_working_revision', p_request_id, v_result);
  end if;

  perform private.rc04_recompute(p_revision_id);
  v_after := private.rc04_bump(p_revision_id);
  perform private.rc04_audit(p_exam_id, p_revision_id, v_actor, 'revision.update', v_reason, v_before, v_after, null,
    jsonb_build_object('changed_keys', (select jsonb_agg(distinct k) from unnest(v_changed_keys) k), 'items', v_n));
  v_result := jsonb_build_object('exam_id', p_exam_id, 'revision_id', p_revision_id, 'version', v_after, 'noop', false,
    'validation', private.rc04_validation(p_revision_id));
  return private.rc04_receipt_finish(v_actor, 'update_working_revision', p_request_id, v_result);
end;
$$;

-- template snapshot for building the XLSX (server-authored; no write)
create or replace function public.rc04_get_import_template(p_exam_id uuid, p_revision_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_rev public.rc04_exam_revisions%rowtype;
begin
  perform private.rc04_require_admin();
  select * into v_rev from public.rc04_exam_revisions where id = p_revision_id and exam_id = p_exam_id;
  if not found then raise exception 'RC04_NOT_FOUND: revision not found for this exam'; end if;
  return jsonb_build_object(
    'template_version', 'RC04-TEMPLATE-1',
    'importable', v_rev.state = 'working',
    'exam', jsonb_build_object('exam_id', v_rev.exam_id, 'revision_id', v_rev.id, 'revision_seq', v_rev.seq,
      'version', v_rev.version, 'state', v_rev.state, 'academic_year', v_rev.academic_year,
      'exam_date', v_rev.exam_date, 'exam_type', v_rev.exam_type, 'title', v_rev.title),
    'parts', (select coalesce(jsonb_agg(jsonb_build_object(
        'part_id', pa.part_id, 'column_key', 'part_' || pa.sort_order, 'name', pa.name, 'sort_order', pa.sort_order,
        'max_score', pa.max_score,
        'mpl', (select coalesce(jsonb_object_agg(m.pgy::text, m.mpl), '{}'::jsonb) from public.rc04_revision_mpl m
                 where m.revision_id = pa.revision_id and m.part_id = pa.part_id))
        order by pa.sort_order), '[]'::jsonb)
      from public.rc04_revision_parts pa where pa.revision_id = v_rev.id),
    'roster', (select coalesce(jsonb_agg(jsonb_build_object('resident_id', p.resident_id, 'reference_name', p.reference_name,
        'pgy_at_exam', p.pgy_at_exam) order by p.reference_name, p.resident_id), '[]'::jsonb)
      from public.rc04_revision_participants p where p.revision_id = v_rev.id),
    'cells', (select coalesce(jsonb_agg(jsonb_build_object('resident_id', r.resident_id, 'part_id', r.part_id,
        'value_state', r.value_state, 'score', r.score, 'outcome', r.outcome) order by r.resident_id, pa.sort_order), '[]'::jsonb)
      from public.rc04_revision_results r join public.rc04_revision_parts pa using (revision_id, part_id)
      where r.revision_id = v_rev.id),
    'allowed_states', jsonb_build_array('scored', 'absent', 'awaiting'),
    'limits', jsonb_build_object('max_cells_per_import', 10000, 'score_decimals', 2, 'preview_ttl_minutes', 30));
end;
$$;

-- preview: validates every cell against the authoritative snapshot, returns before/after diff; writes no result
create or replace function public.rc04_preview_import(p_exam_id uuid, p_revision_id uuid, p_expected_version integer,
  p_cells jsonb, p_file_evidence jsonb default '{}'::jsonb, p_file_reported jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.rc04_require_admin();
  v_rev public.rc04_exam_revisions%rowtype; v_c jsonb; v_ref text; v_state text; v_err text; v_max numeric;
  v_rid uuid; v_pid uuid; v_errors jsonb := '[]'::jsonb; v_warn jsonb := '[]'::jsonb; v_delta jsonb := '[]'::jsonb;
  v_diff jsonb := '[]'::jsonb; v_cur record; v_score numeric; v_new_outcome text; v_mpl numeric; v_fp text;
  v_seen text[] := '{}'; v_preview uuid; v_requires boolean := false; v_unchanged integer := 0; v_x jsonb; v_n integer;
  v_expires timestamptz := clock_timestamp() + interval '30 minutes';
begin
  select * into v_rev from public.rc04_exam_revisions where id = p_revision_id and exam_id = p_exam_id;
  if not found then raise exception 'RC04_NOT_FOUND: revision not found for this exam'; end if;
  perform private.rc04_require_working(v_rev, p_expected_version);
  if jsonb_typeof(p_cells) is distinct from 'array' then raise exception 'RC04_INVALID_INPUT: cells must be an array'; end if;
  v_n := jsonb_array_length(p_cells);
  if v_n > 10000 then raise exception 'RC04_LIMIT: at most 10000 cells per import (got %)', v_n; end if;

  -- what the file says about itself (B002-B02): strict object/required keys/types/null checks, then values
  v_errors := private.rc04_file_reported_errors(p_file_reported, p_exam_id, p_revision_id);

  for v_c in select * from jsonb_array_elements(p_cells) loop
    v_ref := v_c->>'cell_ref'; v_state := v_c->>'state'; v_err := null; v_rid := null; v_pid := null;
    begin v_rid := (v_c->>'resident_id')::uuid; v_pid := (v_c->>'part_id')::uuid; exception when others then v_err := 'INVALID_ID'; end;
    if v_err is null and not exists (select 1 from public.rc04_revision_participants where revision_id = p_revision_id and resident_id = v_rid) then
      v_err := 'UNKNOWN_RESIDENT'; end if;
    if v_err is null then
      select max_score into v_max from public.rc04_revision_parts where revision_id = p_revision_id and part_id = v_pid;
      if not found then v_err := 'UNKNOWN_PART'; end if;
    end if;
    if v_err is null and (v_rid::text || '/' || v_pid::text) = any (v_seen) then v_err := 'DUPLICATE_CELL'; end if;
    if v_err is null and (v_state is null or v_state not in ('scored', 'absent', 'awaiting')) then v_err := 'INVALID_STATE'; end if;
    if v_err is null and v_state = 'scored' then v_err := private.rc04_score_error(v_c->'score', v_max); end if;
    if v_err is null and v_state <> 'scored' and v_c ? 'score' and jsonb_typeof(v_c->'score') <> 'null' then v_err := 'STATE_WITH_SCORE'; end if;
    if v_err is not null then
      v_errors := v_errors || jsonb_build_object('code', v_err, 'cell_ref', v_ref, 'resident_id', v_c->>'resident_id', 'part_id', v_c->>'part_id');
      continue;
    end if;
    v_seen := v_seen || (v_rid::text || '/' || v_pid::text);
    v_score := case when v_state = 'scored' then round((v_c->>'score')::numeric, 2) end;
    v_delta := v_delta || jsonb_build_object('resident_id', v_rid, 'part_id', v_pid, 'value_state', v_state, 'score', v_score);
    select r.value_state, r.score, r.outcome into v_cur from public.rc04_revision_results r
     where r.revision_id = p_revision_id and r.resident_id = v_rid and r.part_id = v_pid;
    if v_cur.value_state = v_state and v_cur.score is not distinct from v_score then
      v_unchanged := v_unchanged + 1; continue;
    end if;
    select m.mpl into v_mpl from public.rc04_revision_mpl m
      join public.rc04_revision_participants p on p.revision_id = m.revision_id and p.pgy_at_exam = m.pgy
     where m.revision_id = p_revision_id and m.part_id = v_pid and p.resident_id = v_rid;
    v_new_outcome := case when v_state <> 'scored' or v_mpl is null then null when v_score >= v_mpl then 'pass' else 'fail' end;
    if v_cur.value_state <> 'unknown' then v_requires := true; end if;
    v_diff := v_diff || jsonb_build_object('resident_id', v_rid, 'part_id', v_pid, 'cell_ref', v_ref,
      'overwrites_recorded_value', v_cur.value_state <> 'unknown',
      'before', jsonb_build_object('value_state', v_cur.value_state, 'score', v_cur.score, 'outcome', v_cur.outcome),
      'after', jsonb_build_object('value_state', v_state, 'score', v_score, 'outcome', v_new_outcome));
  end loop;

  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('ok', false, 'preview_id', null, 'errors', v_errors,
      'counts', jsonb_build_object('submitted', v_n, 'errors', jsonb_array_length(v_errors)));
  end if;

  -- scope: residents/parts not in the file are kept as they are (reported, not an error)
  v_warn := (select coalesce(jsonb_agg(w), '[]'::jsonb) from (
    select jsonb_build_object('code', 'RESIDENTS_NOT_IN_FILE', 'count', count(*)) w
      from public.rc04_revision_participants p where p.revision_id = p_revision_id
       and not exists (select 1 from jsonb_array_elements(v_delta) d where d->>'resident_id' = p.resident_id::text)
    having count(*) > 0
    union all
    select jsonb_build_object('code', 'PARTS_NOT_IN_FILE', 'count', count(*))
      from public.rc04_revision_parts pa where pa.revision_id = p_revision_id
       and not exists (select 1 from jsonb_array_elements(v_delta) d where d->>'part_id' = pa.part_id::text)
    having count(*) > 0) x);

  v_delta := (select coalesce(jsonb_agg(d order by d->>'resident_id', d->>'part_id'), '[]'::jsonb) from jsonb_array_elements(v_delta) d);
  v_fp := private.rc04_fp(jsonb_build_object('exam_id', p_exam_id, 'revision_id', p_revision_id, 'version', v_rev.version, 'delta', v_delta));
  insert into public.rc04_import_previews (exam_id, revision_id, actor_id, expected_version, delta, delta_fingerprint, diff,
    requires_reason, file_evidence, expires_at)
  values (p_exam_id, p_revision_id, v_actor, v_rev.version, v_delta, v_fp, v_diff, v_requires, coalesce(p_file_evidence, '{}'::jsonb), v_expires)
  returning id into v_preview;
  return jsonb_build_object('ok', true, 'preview_id', v_preview, 'expires_at', v_expires, 'expected_version', v_rev.version,
    'delta_fingerprint', v_fp, 'requires_reason', v_requires, 'diff', v_diff, 'errors', '[]'::jsonb, 'warnings', v_warn,
    'counts', jsonb_build_object('submitted', v_n, 'changed', jsonb_array_length(v_diff), 'unchanged', v_unchanged, 'errors', 0));
end;
$$;

-- commit: merges the previewed delta into the working revision (cells not sent are untouched); all or nothing
create or replace function public.rc04_commit_import(p_request_id uuid, p_preview_id uuid, p_expected_version integer,
  p_delta_fingerprint text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.rc04_require_admin();
  v_replay jsonb; v_p public.rc04_import_previews%rowtype; v_rev public.rc04_exam_revisions%rowtype; v_d jsonb;
  v_changed integer := 0; v_batch uuid; v_after integer; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_result jsonb; v_exam uuid; v_cur record;
begin
  v_replay := private.rc04_receipt_begin(v_actor, 'commit_import', p_request_id,
    jsonb_build_object('preview_id', p_preview_id, 'expected_version', p_expected_version, 'delta_fingerprint', p_delta_fingerprint, 'reason', p_reason));
  if v_replay is not null then return v_replay; end if;
  select exam_id into v_exam from public.rc04_import_previews where id = p_preview_id and actor_id = v_actor;
  if not found then raise exception 'RC04_PREVIEW_NOT_FOUND: preview not found'; end if;
  perform private.rc04_lock_exam(v_exam);
  select * into v_p from public.rc04_import_previews where id = p_preview_id;
  v_rev := private.rc04_lock_revision(v_exam, v_p.revision_id);
  select * into v_p from public.rc04_import_previews where id = p_preview_id for update;
  if v_p.consumed_at is not null then raise exception 'RC04_PREVIEW_CONSUMED: this preview was already used; preview again'; end if;
  perform private.rc04_require_working(v_rev, p_expected_version);
  if v_p.expected_version <> v_rev.version then raise exception 'RC04_REVISION_CONFLICT: the revision changed after this preview'; end if;
  if v_p.expires_at <= clock_timestamp() then raise exception 'RC04_PREVIEW_EXPIRED: preview again'; end if;
  if p_delta_fingerprint is distinct from v_p.delta_fingerprint then raise exception 'RC04_PREVIEW_MISMATCH: the confirmed delta is not the previewed one'; end if;
  if v_p.requires_reason and v_reason is null then raise exception 'RC04_REASON_REQUIRED: this import changes values already recorded; give a reason'; end if;
  if v_reason is not null and char_length(v_reason) > 300 then raise exception 'RC04_INVALID_INPUT: reason is longer than 300 characters'; end if;

  update public.rc04_import_previews set consumed_at = clock_timestamp() where id = p_preview_id;
  for v_d in select * from jsonb_array_elements(v_p.delta) loop
    select value_state, score into v_cur from public.rc04_revision_results
     where revision_id = v_rev.id and resident_id = (v_d->>'resident_id')::uuid and part_id = (v_d->>'part_id')::uuid for update;
    if v_cur.value_state = v_d->>'value_state' and v_cur.score is not distinct from (v_d->>'score')::numeric then continue; end if;
    v_changed := v_changed + 1;
  end loop;

  if v_changed = 0 then
    perform private.rc04_audit(v_exam, v_rev.id, v_actor, 'import.noop', v_reason, v_rev.version, v_rev.version, null,
      jsonb_build_object('preview_id', p_preview_id, 'cells', jsonb_array_length(v_p.delta)));
    v_result := jsonb_build_object('batch_id', null, 'changed_count', 0, 'version', v_rev.version, 'noop', true,
      'exam_id', v_exam, 'revision_id', v_rev.id);
    return private.rc04_receipt_finish(v_actor, 'commit_import', p_request_id, v_result);
  end if;

  insert into public.rc04_import_batches (exam_id, revision_id, preview_id, actor_id, input_fingerprint, file_hash,
    before_version, after_version, changed_count, result_summary)
  values (v_exam, v_rev.id, p_preview_id, v_actor, v_p.delta_fingerprint, v_p.file_evidence->>'file_hash',
    v_rev.version, v_rev.version + 1, v_changed,
    jsonb_build_object('cells_in_file', jsonb_array_length(v_p.delta), 'changed', v_changed))
  returning id into v_batch;
  update public.rc04_revision_results r
     set value_state = d.value_state, score = d.score, outcome = null, source_batch_id = v_batch,
         updated_by = v_actor, updated_at = clock_timestamp()
    from jsonb_to_recordset(v_p.delta) as d(resident_id uuid, part_id uuid, value_state text, score numeric)
   where r.revision_id = v_rev.id and r.resident_id = d.resident_id and r.part_id = d.part_id
     and (r.value_state <> d.value_state or r.score is distinct from d.score);
  perform private.rc04_recompute(v_rev.id);
  v_after := private.rc04_bump(v_rev.id);
  perform private.rc04_audit(v_exam, v_rev.id, v_actor, 'import.commit', v_reason, v_rev.version, v_after, v_batch,
    jsonb_build_object('preview_id', p_preview_id, 'changed', v_changed, 'cells_in_file', jsonb_array_length(v_p.delta)));
  v_result := jsonb_build_object('batch_id', v_batch, 'changed_count', v_changed, 'version', v_after, 'noop', false,
    'exam_id', v_exam, 'revision_id', v_rev.id);
  return private.rc04_receipt_finish(v_actor, 'commit_import', p_request_id, v_result);
end;
$$;

-- mark reviewed (separate from publish): exact version, no blockers, Admin confirms absent/awaiting counts (P01)
create or replace function public.rc04_mark_reviewed(p_request_id uuid, p_exam_id uuid, p_revision_id uuid,
  p_expected_version integer, p_confirm jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.rc04_require_admin(); v_replay jsonb; v_rev public.rc04_exam_revisions%rowtype; v_val jsonb; v_result jsonb;
begin
  v_replay := private.rc04_receipt_begin(v_actor, 'mark_reviewed', p_request_id,
    jsonb_build_object('exam_id', p_exam_id, 'revision_id', p_revision_id, 'expected_version', p_expected_version, 'confirm', p_confirm));
  if v_replay is not null then return v_replay; end if;
  perform private.rc04_lock_exam(p_exam_id);
  v_rev := private.rc04_lock_revision(p_exam_id, p_revision_id);
  perform private.rc04_require_working(v_rev, p_expected_version);
  v_val := private.rc04_validation(p_revision_id);
  if jsonb_array_length(v_val->'blockers') > 0 then
    raise exception 'RC04_NOT_READY: %', v_val->'blockers';
  end if;
  if (p_confirm->>'absent') is distinct from (v_val->'counts'->>'absent') or (p_confirm->>'awaiting') is distinct from (v_val->'counts'->>'awaiting') then
    raise exception 'RC04_CONFIRMATION_MISMATCH: confirm the current absent/awaiting counts (absent %, awaiting %)', v_val->'counts'->>'absent', v_val->'counts'->>'awaiting';
  end if;
  update public.rc04_exam_revisions set checked_version = version, checked_by = v_actor, checked_at = clock_timestamp() where id = p_revision_id;
  perform private.rc04_audit(p_exam_id, p_revision_id, v_actor, 'revision.reviewed', null, v_rev.version, v_rev.version, null, v_val->'counts');
  v_result := jsonb_build_object('exam_id', p_exam_id, 'revision_id', p_revision_id, 'checked_version', v_rev.version, 'counts', v_val->'counts');
  return private.rc04_receipt_finish(v_actor, 'mark_reviewed', p_request_id, v_result);
end;
$$;

-- publish: the reviewed version becomes the immutable published revision; pointer + projection change together
create or replace function public.rc04_publish_revision(p_request_id uuid, p_exam_id uuid, p_revision_id uuid,
  p_expected_version integer, p_expected_published_revision_id uuid, p_confirm jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.rc04_require_admin(); v_replay jsonb; v_ev public.resident_exam_events%rowtype;
  v_rev public.rc04_exam_revisions%rowtype; v_val jsonb; v_now timestamptz := clock_timestamp(); v_result jsonb;
begin
  v_replay := private.rc04_receipt_begin(v_actor, 'publish_revision', p_request_id,
    jsonb_build_object('exam_id', p_exam_id, 'revision_id', p_revision_id, 'expected_version', p_expected_version,
      'expected_published_revision_id', p_expected_published_revision_id, 'confirm', p_confirm));
  if v_replay is not null then return v_replay; end if;
  v_ev := private.rc04_lock_exam(p_exam_id);
  v_rev := private.rc04_lock_revision(p_exam_id, p_revision_id);
  perform private.rc04_require_working(v_rev, p_expected_version);
  if v_ev.published_revision_id is distinct from p_expected_published_revision_id then
    raise exception 'RC04_PUBLISHED_REVISION_CONFLICT: the published revision changed; reload';
  end if;
  if v_rev.base_published_revision_id is distinct from v_ev.published_revision_id then
    raise exception 'RC04_PUBLISHED_REVISION_CONFLICT: this correction was not started from the current published revision';
  end if;
  if v_rev.checked_version is distinct from v_rev.version then raise exception 'RC04_NOT_REVIEWED: mark this version as reviewed first'; end if;
  v_val := private.rc04_validation(p_revision_id);
  if jsonb_array_length(v_val->'blockers') > 0 then raise exception 'RC04_NOT_READY: %', v_val->'blockers'; end if;
  if (p_confirm->>'absent') is distinct from (v_val->'counts'->>'absent') or (p_confirm->>'awaiting') is distinct from (v_val->'counts'->>'awaiting') then
    raise exception 'RC04_CONFIRMATION_MISMATCH: confirm the current absent/awaiting counts (absent %, awaiting %)', v_val->'counts'->>'absent', v_val->'counts'->>'awaiting';
  end if;
  update public.rc04_exam_revisions set state = 'published', published_by = v_actor, published_at = v_now where id = p_revision_id;
  update public.resident_exam_events
     set published_revision_id = p_revision_id, title = v_rev.title, exam_date = v_rev.exam_date, exam_type = v_rev.exam_type,
         status = 'published', published_by = v_actor, published_at = v_now, updated_by = v_actor, updated_at = v_now
   where id = p_exam_id;
  perform private.rc04_audit(p_exam_id, p_revision_id, v_actor, 'revision.publish', null, v_rev.version, v_rev.version, null,
    jsonb_build_object('previous_published_revision_id', v_ev.published_revision_id, 'counts', v_val->'counts',
      'source_batch_ids', (select coalesce(jsonb_agg(distinct source_batch_id), '[]'::jsonb) from public.rc04_revision_results
                            where revision_id = p_revision_id and source_batch_id is not null)));
  v_result := jsonb_build_object('exam_id', p_exam_id, 'published_revision_id', p_revision_id,
    'previous_published_revision_id', v_ev.published_revision_id, 'published_at', v_now, 'counts', v_val->'counts');
  return private.rc04_receipt_finish(v_actor, 'publish_revision', p_request_id, v_result);
end;
$$;

-- begin a correction: a new working revision cloned from the exact published revision; readers keep the old one
create or replace function public.rc04_begin_correction(p_request_id uuid, p_exam_id uuid, p_expected_published_revision_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.rc04_require_admin(); v_replay jsonb; v_ev public.resident_exam_events%rowtype;
  v_base public.rc04_exam_revisions%rowtype; v_new uuid := gen_random_uuid(); v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_result jsonb;
begin
  v_replay := private.rc04_receipt_begin(v_actor, 'begin_correction', p_request_id,
    jsonb_build_object('exam_id', p_exam_id, 'expected_published_revision_id', p_expected_published_revision_id, 'reason', p_reason));
  if v_replay is not null then return v_replay; end if;
  if v_reason is null or char_length(v_reason) > 300 then raise exception 'RC04_REASON_REQUIRED: a correction needs a reason (max 300 characters)'; end if;
  v_ev := private.rc04_lock_exam(p_exam_id);
  if v_ev.published_revision_id is null then raise exception 'RC04_NOT_PUBLISHED: nothing to correct yet'; end if;
  v_base := private.rc04_lock_revision(p_exam_id, v_ev.published_revision_id);
  if v_ev.published_revision_id is distinct from p_expected_published_revision_id then
    raise exception 'RC04_PUBLISHED_REVISION_CONFLICT: the published revision changed; reload';
  end if;
  if exists (select 1 from public.rc04_exam_revisions where exam_id = p_exam_id and state = 'working') then
    raise exception 'RC04_WORKING_REVISION_EXISTS: finish or publish the open working revision first';
  end if;
  insert into public.rc04_exam_revisions (id, exam_id, seq, state, version, base_published_revision_id, academic_year, exam_date,
    exam_type, title, created_by, correction_reason)
  select v_new, p_exam_id, (select max(seq) + 1 from public.rc04_exam_revisions where exam_id = p_exam_id), 'working', 1, v_base.id,
         v_base.academic_year, v_base.exam_date, v_base.exam_type, v_base.title, v_actor, v_reason;
  insert into public.rc04_revision_parts (revision_id, exam_id, part_id, name, sort_order, max_score)
  select v_new, exam_id, part_id, name, sort_order, max_score from public.rc04_revision_parts where revision_id = v_base.id;
  insert into public.rc04_revision_mpl (revision_id, part_id, pgy, mpl)
  select v_new, part_id, pgy, mpl from public.rc04_revision_mpl where revision_id = v_base.id;
  insert into public.rc04_revision_participants (revision_id, exam_id, resident_id, pgy_at_exam, reference_name)
  select v_new, exam_id, resident_id, pgy_at_exam, reference_name from public.rc04_revision_participants where revision_id = v_base.id;
  insert into public.rc04_revision_results (revision_id, resident_id, part_id, value_state, score, outcome, source_batch_id, updated_by, updated_at)
  select v_new, resident_id, part_id, value_state, score, outcome, source_batch_id, updated_by, updated_at
    from public.rc04_revision_results where revision_id = v_base.id;
  perform private.rc04_audit(p_exam_id, v_new, v_actor, 'correction.begin', v_reason, null, 1, null,
    jsonb_build_object('base_published_revision_id', v_base.id));
  v_result := jsonb_build_object('exam_id', p_exam_id, 'revision_id', v_new, 'version', 1, 'state', 'working',
    'base_published_revision_id', v_base.id);
  return private.rc04_receipt_finish(v_actor, 'begin_correction', p_request_id, v_result);
end;
$$;

-- ================================================================ 6. reads
-- Admin: list managed exams with their working/published revisions and validation
create or replace function public.rc04_admin_list_exams(p_academic_year integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.rc04_require_admin();
  return (select coalesce(jsonb_agg(x order by x->>'sort_key' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'sort_key', coalesce(w.exam_date, p.exam_date)::text || e.id::text,
      'exam_id', e.id, 'published_revision_id', e.published_revision_id,
      'published', case when p.id is null then null else jsonb_build_object('revision_id', p.id, 'seq', p.seq,
          'academic_year', p.academic_year, 'exam_date', p.exam_date, 'title', p.title, 'published_at', p.published_at) end,
      'working', case when w.id is null then null else jsonb_build_object('revision_id', w.id, 'seq', w.seq, 'version', w.version,
          'reviewed', w.checked_version = w.version, 'academic_year', w.academic_year, 'exam_date', w.exam_date, 'title', w.title,
          'base_published_revision_id', w.base_published_revision_id, 'validation', private.rc04_validation(w.id)) end) x
    from public.resident_exam_events e
    left join public.rc04_exam_revisions p on p.id = e.published_revision_id
    left join public.rc04_exam_revisions w on w.exam_id = e.id and w.state = 'working'
    where e.managed_by_rc04
      and (p_academic_year is null or coalesce(w.academic_year, p.academic_year) = p_academic_year)) q);
end;
$$;

-- Admin: one revision (working or any published) with cells, validation and overall per resident
create or replace function public.rc04_admin_get_revision(p_exam_id uuid, p_revision_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_t jsonb;
begin
  perform private.rc04_require_admin();
  v_t := public.rc04_get_import_template(p_exam_id, p_revision_id);
  return v_t
    || jsonb_build_object('validation', private.rc04_validation(p_revision_id),
         'reviewed', (select checked_version = version from public.rc04_exam_revisions where id = p_revision_id),
         'overall', (select coalesce(jsonb_object_agg(p.resident_id::text, private.rc04_overall(p_revision_id, p.resident_id)), '{}'::jsonb)
                       from public.rc04_revision_participants p where p.revision_id = p_revision_id));
end;
$$;

-- Readers (R03): open a read set = manifest pinning exam → published revision at this moment; then page through it.
-- scope 'own': Active Resident, own published results of every year. scope 'staff': Active Staff or Admin, all published.
-- p_revision_id: pin an older published revision of p_exam_id (history); drafts are never readable.
create or replace function public.rc04_open_read_set(p_scope text, p_exam_id uuid default null,
  p_academic_year integer default null, p_revision_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_entries jsonb; v_id uuid; v_exp timestamptz := clock_timestamp() + interval '30 minutes';
begin
  if p_scope = 'own' then
    if not (select private.resident_role_is('resident')) then raise exception 'RC04_FORBIDDEN: Active Resident account required'; end if;
  elsif p_scope = 'staff' then
    if not ((select private.resident_role_is('staff')) or (select private.resident_role_is('admin'))) then
      raise exception 'RC04_FORBIDDEN: Active Staff or Admin account required'; end if;
  else raise exception 'RC04_INVALID_INPUT: scope must be own or staff'; end if;
  if p_revision_id is not null and (p_exam_id is null or not exists (select 1 from public.rc04_exam_revisions
       where id = p_revision_id and exam_id = p_exam_id and state = 'published')) then
    raise exception 'RC04_NOT_FOUND: published revision not found';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('exam_id', r.exam_id, 'revision_id', r.id, 'revision_seq', r.seq,
           'academic_year', r.academic_year, 'exam_date', r.exam_date, 'title', r.title, 'exam_type', r.exam_type,
           'published_at', r.published_at, 'is_current', r.id = e.published_revision_id)
         order by r.academic_year desc, r.exam_date desc, r.exam_id), '[]'::jsonb)
    into v_entries
    from public.resident_exam_events e
    join public.rc04_exam_revisions r on r.exam_id = e.id and r.id = coalesce(p_revision_id, e.published_revision_id)
   where e.managed_by_rc04 and r.state = 'published'
     and (p_exam_id is null or e.id = p_exam_id)
     and (p_academic_year is null or r.academic_year = p_academic_year)
     and (p_scope = 'staff' or exists (select 1 from public.rc04_revision_participants p where p.revision_id = r.id and p.resident_id = v_uid));
  delete from public.rc04_read_manifests where actor_id = v_uid and expires_at < clock_timestamp();
  insert into public.rc04_read_manifests (actor_id, scope, filter, entries, expires_at)
  values (v_uid, p_scope, jsonb_build_object('exam_id', p_exam_id, 'academic_year', p_academic_year, 'revision_id', p_revision_id), v_entries, v_exp)
  returning id into v_id;
  return jsonb_build_object('manifest_id', v_id, 'scope', p_scope, 'expires_at', v_exp, 'entries', v_entries,
    'page_size_default', 200, 'page_size_max', 500);
end;
$$;

-- one page of a read set. Order (unique): entry index, resident_id, part sort_order, part_id. Cursor = opaque jsonb from the
-- previous page, bound to this manifest. Auth is checked on EVERY page (role still active, owner of the manifest).
create or replace function public.rc04_read_page(p_manifest_id uuid, p_cursor jsonb default null, p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_m public.rc04_read_manifests%rowtype; v_lim integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_k_idx integer := -1; v_k_res uuid := '00000000-0000-0000-0000-000000000000'; v_k_sort integer := -1;
  v_k_part uuid := '00000000-0000-0000-0000-000000000000'; v_rows jsonb; v_n integer; v_last jsonb;
begin
  select * into v_m from public.rc04_read_manifests where id = p_manifest_id;
  if not found or v_m.actor_id is distinct from v_uid then raise exception 'RC04_READ_SET_NOT_FOUND: start the read again'; end if;
  if v_m.expires_at <= clock_timestamp() then raise exception 'RC04_READ_SET_EXPIRED: start the read again (whole set)'; end if;
  if v_m.scope = 'own' and not (select private.resident_role_is('resident')) then raise exception 'RC04_FORBIDDEN: Active Resident account required'; end if;
  if v_m.scope = 'staff' and not ((select private.resident_role_is('staff')) or (select private.resident_role_is('admin'))) then
    raise exception 'RC04_FORBIDDEN: Active Staff or Admin account required'; end if;
  -- cursor (B002 §5.2): SQL NULL = first page; otherwise an object with exactly manifest_id, i, r, s, p — all non-null,
  -- right types, in range — checked BEFORE any query.
  if p_cursor is not null then
    if jsonb_typeof(p_cursor) <> 'object'
       or (select count(*) from jsonb_object_keys(p_cursor)) <> 5
       or not (p_cursor ?& array['manifest_id', 'i', 'r', 's', 'p'])
       or jsonb_typeof(p_cursor->'manifest_id') is distinct from 'string'
       or jsonb_typeof(p_cursor->'i') is distinct from 'number' or (p_cursor->>'i') !~ '^[0-9]{1,6}$'
       or jsonb_typeof(p_cursor->'s') is distinct from 'number' or (p_cursor->>'s') !~ '^[0-9]{1,3}$'
       or jsonb_typeof(p_cursor->'r') is distinct from 'string' or (p_cursor->>'r') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or jsonb_typeof(p_cursor->'p') is distinct from 'string' or (p_cursor->>'p') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'RC04_INVALID_CURSOR: malformed cursor (expected {manifest_id, i, r, s, p})';
    end if;
    if p_cursor->>'manifest_id' is distinct from p_manifest_id::text then raise exception 'RC04_INVALID_CURSOR: cursor belongs to another read set'; end if;
    v_k_idx := (p_cursor->>'i')::integer; v_k_res := (p_cursor->>'r')::uuid; v_k_sort := (p_cursor->>'s')::integer; v_k_part := (p_cursor->>'p')::uuid;
    if v_k_idx >= jsonb_array_length(v_m.entries) then raise exception 'RC04_INVALID_CURSOR: cursor is outside this read set'; end if;
  end if;
  with ent as (
    select (e.ord - 1)::integer as idx, (e.v->>'exam_id')::uuid as exam_id, (e.v->>'revision_id')::uuid as revision_id
      from jsonb_array_elements(v_m.entries) with ordinality as e(v, ord)
  ), rows as (
    select ent.idx, rv.exam_id, rv.id as revision_id, rv.seq, rv.academic_year, rv.exam_date, rv.title, rv.exam_type,
           p.resident_id, p.reference_name, p.pgy_at_exam, pa.part_id, pa.name as part_name, pa.sort_order, pa.max_score,
           m.mpl, r.value_state, r.score, r.outcome
      from ent
      join public.rc04_exam_revisions rv on rv.id = ent.revision_id and rv.exam_id = ent.exam_id and rv.state = 'published'
      join public.rc04_revision_participants p on p.revision_id = rv.id
      join public.rc04_revision_parts pa on pa.revision_id = rv.id
      join public.rc04_revision_results r on r.revision_id = rv.id and r.resident_id = p.resident_id and r.part_id = pa.part_id
      left join public.rc04_revision_mpl m on m.revision_id = rv.id and m.part_id = pa.part_id and m.pgy = p.pgy_at_exam
     where (v_m.scope = 'staff' or p.resident_id = v_uid)
       and (ent.idx, p.resident_id, pa.sort_order::integer, pa.part_id) > (v_k_idx, v_k_res, v_k_sort, v_k_part)
     order by ent.idx, p.resident_id, pa.sort_order, pa.part_id
     limit v_lim
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'entry_index', idx, 'exam_id', exam_id, 'revision_id', revision_id, 'revision_seq', seq,
           'academic_year', academic_year, 'exam_date', exam_date, 'title', title, 'exam_type', exam_type,
           'resident_id', resident_id, 'reference_name', reference_name, 'pgy_at_exam', pgy_at_exam,
           'part_id', part_id, 'part_name', part_name, 'part_sort_order', sort_order, 'max_score', max_score,
           'mpl', mpl, 'criteria_status', case when mpl is null then 'missing' else 'complete' end,
           'value_state', value_state, 'score', score, 'outcome', outcome,
           'overall', private.rc04_overall(revision_id, resident_id))
         order by idx, resident_id, sort_order, part_id), '[]'::jsonb), count(*)
    into v_rows, v_n
    from rows;
  v_last := case when v_n > 0 then v_rows->(v_n - 1) end;
  return jsonb_build_object('manifest_id', p_manifest_id, 'rows', v_rows, 'row_count', v_n, 'done', v_n < v_lim,
    'next_cursor', case when v_n = v_lim then jsonb_build_object('manifest_id', p_manifest_id, 'i', v_last->'entry_index',
      'r', v_last->>'resident_id', 's', v_last->'part_sort_order', 'p', v_last->>'part_id') end);
end;
$$;

do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'rc04\_%' loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
-- helpers created above in private are revoked again (functions added after section 4)
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private' and p.proname like 'rc04\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
