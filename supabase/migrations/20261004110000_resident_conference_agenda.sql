-- Friday conference: a saved agenda per meeting date, and learning points tied to a meeting.
-- Additive: one nullable column on notes, one new table, three new functions. Existing data and
-- functions are not touched. Rehearse on the staging project before production.
begin;

-- Learning points can be tied to a meeting. Existing notes keep meeting_date = null (case-level notes).
alter table public.resident_case_notes add column if not exists meeting_date date;
create index if not exists resident_case_notes_meeting_idx
  on public.resident_case_notes (meeting_date, case_id) where meeting_date is not null;

-- One row per meeting date. Only the organiser's CHANGES are stored: which cases to leave out, which older
-- cases to add, and the order. Cases admitted in [range_from, range_to] join automatically (computed by the app).
create table if not exists public.resident_conference_sessions (
  meeting_date date primary key,
  range_from date not null,
  range_to date not null,
  excluded_case_ids uuid[] not null default '{}',
  added_case_ids uuid[] not null default '{}',
  case_order uuid[] not null default '{}',
  created_by uuid not null references public.resident_profiles(user_id),
  updated_by uuid not null references public.resident_profiles(user_id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (range_from <= range_to),
  check (range_to - range_from <= 62),
  check (cardinality(excluded_case_ids) <= 300 and cardinality(added_case_ids) <= 300 and cardinality(case_order) <= 600)
);

alter table public.resident_conference_sessions enable row level security;
drop policy if exists resident_conference_sessions_select on public.resident_conference_sessions;
create policy resident_conference_sessions_select on public.resident_conference_sessions
  for select to authenticated using ((select private.resident_case_member()));
revoke all on table public.resident_conference_sessions from public, anon, authenticated;
grant select on table public.resident_conference_sessions to authenticated;

-- Who may arrange the agenda. Today: any active Resident, Staff or Admin (as in the Corner v3 prototype).
-- The real rule is still undecided; to tighten it later, change ONLY this function.
create or replace function private.resident_can_manage_conference()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select private.resident_case_member());
$$;

-- Removes duplicates but keeps the first position of each id.
create or replace function private.resident_dedupe_ids(p_ids uuid[])
returns uuid[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(id order by first_pos), '{}'::uuid[])
  from (select id, min(pos) as first_pos from unnest(coalesce(p_ids, '{}'::uuid[])) with ordinality as t(id, pos) group by id) s;
$$;

create or replace function public.save_resident_conference_agenda(
  p_meeting_date date, p_range_from date, p_range_to date,
  p_excluded uuid[], p_added uuid[], p_order uuid[],
  p_expected_updated_at timestamptz default null
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_row public.resident_conference_sessions%rowtype;
  v_excluded uuid[] := private.resident_dedupe_ids(p_excluded);
  v_added uuid[] := private.resident_dedupe_ids(p_added);
  v_order uuid[] := private.resident_dedupe_ids(p_order);
  v_now timestamptz := clock_timestamp();
begin
  if not (select private.resident_case_member()) then
    raise exception 'Active Resident, Staff or Admin account required';
  end if;
  if not (select private.resident_can_manage_conference()) then
    raise exception 'You cannot arrange the conference agenda';
  end if;
  if p_meeting_date is null or p_range_from is null or p_range_to is null then
    raise exception 'Meeting date and date range are required';
  end if;
  if p_range_from > p_range_to or p_range_to - p_range_from > 62 then
    raise exception 'Invalid date range (start must not be after end; at most 63 days)';
  end if;
  if cardinality(v_excluded) > 300 or cardinality(v_added) > 300 or cardinality(v_order) > 600 then
    raise exception 'Agenda is too large';
  end if;
  if exists (select 1 from unnest(v_excluded || v_order) as t(id) where not exists (select 1 from public.resident_admission_cases c where c.id = t.id))
     or exists (select 1 from unnest(v_added) as t(id) where not exists (select 1 from public.resident_admission_cases c where c.id = t.id and c.deleted_at is null)) then
    raise exception 'Agenda refers to an unknown case';
  end if;

  select * into v_row from public.resident_conference_sessions where meeting_date = p_meeting_date for update;
  if found then
    if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
      raise exception 'CONFERENCE_CONFLICT: the agenda was changed by someone else';
    end if;
    update public.resident_conference_sessions
    set range_from = p_range_from, range_to = p_range_to, excluded_case_ids = v_excluded, added_case_ids = v_added,
        case_order = v_order, updated_by = auth.uid(), updated_at = v_now
    where meeting_date = p_meeting_date;
  else
    if p_expected_updated_at is not null then
      raise exception 'CONFERENCE_CONFLICT: the agenda was reset by someone else';
    end if;
    begin
      insert into public.resident_conference_sessions
        (meeting_date, range_from, range_to, excluded_case_ids, added_case_ids, case_order, created_by, updated_by, created_at, updated_at)
      values (p_meeting_date, p_range_from, p_range_to, v_excluded, v_added, v_order, auth.uid(), auth.uid(), v_now, v_now);
    exception when unique_violation then
      raise exception 'CONFERENCE_CONFLICT: the agenda was created by someone else';
    end;
  end if;
  return v_now;
end;
$$;

-- Back to the automatic agenda for that meeting date (deletes the saved changes only, never any case).
create or replace function public.reset_resident_conference_agenda(p_meeting_date date, p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.resident_conference_sessions%rowtype;
begin
  if not (select private.resident_case_member()) then
    raise exception 'Active Resident, Staff or Admin account required';
  end if;
  if not (select private.resident_can_manage_conference()) then
    raise exception 'You cannot arrange the conference agenda';
  end if;
  select * into v_row from public.resident_conference_sessions where meeting_date = p_meeting_date for update;
  if not found then return; end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'CONFERENCE_CONFLICT: the agenda was changed by someone else';
  end if;
  delete from public.resident_conference_sessions where meeting_date = p_meeting_date;
end;
$$;

-- A learning point for one case at one meeting (same rules as a normal case note).
create or replace function public.add_resident_conference_note(p_case_id uuid, p_meeting_date date, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if not (select private.resident_case_member()) then
    raise exception 'Active Resident, Staff or Admin account required';
  end if;
  if p_meeting_date is null then raise exception 'Meeting date is required'; end if;
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'Note must be 1-2000 characters';
  end if;
  if not exists (select 1 from public.resident_admission_cases where id = p_case_id and deleted_at is null) then
    raise exception 'Case not found';
  end if;
  insert into public.resident_case_notes (case_id, author_id, body, meeting_date)
  values (p_case_id, auth.uid(), v_body, p_meeting_date)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function private.resident_can_manage_conference() from public, anon, authenticated;
revoke all on function private.resident_dedupe_ids(uuid[]) from public, anon, authenticated;
revoke all on function public.save_resident_conference_agenda(date, date, date, uuid[], uuid[], uuid[], timestamptz) from public, anon;
revoke all on function public.reset_resident_conference_agenda(date, timestamptz) from public, anon;
revoke all on function public.add_resident_conference_note(uuid, date, text) from public, anon;
grant execute on function public.save_resident_conference_agenda(date, date, date, uuid[], uuid[], uuid[], timestamptz) to authenticated;
grant execute on function public.reset_resident_conference_agenda(date, timestamptz) to authenticated;
grant execute on function public.add_resident_conference_note(uuid, date, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.save_resident_conference_agenda(date, date, date, uuid[], uuid[], uuid[], timestamptz)'::regprocedure, 'EXECUTE')
    or has_function_privilege('anon', 'public.reset_resident_conference_agenda(date, timestamptz)'::regprocedure, 'EXECUTE')
    or has_function_privilege('anon', 'public.add_resident_conference_note(uuid, date, text)'::regprocedure, 'EXECUTE')
    or has_table_privilege('anon', 'public.resident_conference_sessions', 'SELECT')
    or has_table_privilege('authenticated', 'public.resident_conference_sessions', 'INSERT')
    or has_table_privilege('authenticated', 'public.resident_conference_sessions', 'UPDATE')
    or has_table_privilege('authenticated', 'public.resident_conference_sessions', 'DELETE')
    or not (select relrowsecurity from pg_class where oid = 'public.resident_conference_sessions'::regclass)
  then
    raise exception 'Conference agenda migration check failed';
  end if;
end $$;

commit;
