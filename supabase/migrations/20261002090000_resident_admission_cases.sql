-- New admissions + Friday conference (phase 1).
-- Additive only: a sequence, 3 tables, helper functions, RPCs, a private
-- bucket and policies. authenticated users get SELECT only (filtered by RLS);
-- every write goes through a SECURITY DEFINER function that checks the role.
-- Apply on its own: npx --yes supabase db query --linked --file <this file>
-- (never `supabase db push`). Verify with tests/resident-cases-db.sql.
begin;

create sequence if not exists public.resident_admission_case_seq;
revoke all on sequence public.resident_admission_case_seq from public, anon, authenticated;

create table if not exists public.resident_admission_cases (
  id uuid primary key default gen_random_uuid(),
  case_code text not null unique default ('ADM-' || lpad(nextval('public.resident_admission_case_seq')::text, 5, '0')),
  admit_date date not null check (admit_date >= date '2020-01-01' and admit_date <= ((now() at time zone 'Asia/Bangkok')::date)),
  age_years smallint not null check (age_years between 0 and 120),
  sex text not null check (sex in ('male', 'female', 'unspecified')),
  diagnosis text not null check (char_length(btrim(diagnosis)) between 1 and 180),
  management text not null default '' check (char_length(management) <= 1000),
  operation text not null default '' check (char_length(operation) <= 180),
  unit_name text not null check (unit_name in ('Upper GI', 'General surgery', 'HBP')),
  status text not null default 'admit' check (status in ('admit', 'discharged', 'pending_update')),
  owner_id uuid not null references public.resident_profiles(user_id),
  created_by uuid not null references public.resident_profiles(user_id),
  updated_by uuid not null references public.resident_profiles(user_id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz
);

create table if not exists public.resident_case_media (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.resident_admission_cases(id),
  storage_path text not null unique check (char_length(btrim(storage_path)) between 1 and 500),
  caption text not null default '' check (char_length(caption) <= 200),
  created_by uuid not null references public.resident_profiles(user_id),
  created_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz
);

create table if not exists public.resident_case_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.resident_admission_cases(id),
  author_id uuid not null references public.resident_profiles(user_id),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default clock_timestamp(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index if not exists resident_admission_cases_admit_date_idx on public.resident_admission_cases(admit_date desc);
create index if not exists resident_admission_cases_status_idx on public.resident_admission_cases(status);
create index if not exists resident_admission_cases_owner_idx on public.resident_admission_cases(owner_id);
create index if not exists resident_admission_cases_created_by_idx on public.resident_admission_cases(created_by);
create index if not exists resident_admission_cases_updated_by_idx on public.resident_admission_cases(updated_by);
create index if not exists resident_case_media_case_idx on public.resident_case_media(case_id);
create index if not exists resident_case_media_created_by_idx on public.resident_case_media(created_by);
create index if not exists resident_case_notes_case_idx on public.resident_case_notes(case_id, created_at);
create index if not exists resident_case_notes_author_idx on public.resident_case_notes(author_id);

-- Helpers -------------------------------------------------------------------
create or replace function private.resident_case_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.resident_user_roles r
    join public.resident_profiles p on p.user_id = r.user_id
    where r.user_id = (select auth.uid()) and r.active and p.active
  );
$$;

create or replace function private.resident_can_edit_case(p_case_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select private.resident_case_member()) and exists (
    select 1 from public.resident_admission_cases c
    join public.resident_user_roles r on r.user_id = (select auth.uid()) and r.active
    where c.id = p_case_id and c.deleted_at is null
      and (r.role in ('staff', 'admin') or c.created_by = r.user_id or c.owner_id = r.user_id)
  );
$$;

create or replace function private.resident_case_path_case_id(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(p_name))[1])::uuid
  end;
$$;

create or replace function private.resident_case_assert_owner(p_owner_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.resident_user_roles r
    join public.resident_profiles p on p.user_id = r.user_id
    where r.user_id = p_owner_id and r.role = 'resident' and r.active and p.active
  ) then
    raise exception 'Owner must be an active Resident';
  end if;
end;
$$;

revoke all on function private.resident_case_member() from public, anon;
revoke all on function private.resident_can_edit_case(uuid) from public, anon;
revoke all on function private.resident_case_path_case_id(text) from public, anon;
revoke all on function private.resident_case_assert_owner(uuid) from public, anon, authenticated;
grant execute on function private.resident_case_member() to authenticated;
grant execute on function private.resident_can_edit_case(uuid) to authenticated;
grant execute on function private.resident_case_path_case_id(text) to authenticated;

-- RLS: SELECT only -----------------------------------------------------------
alter table public.resident_admission_cases enable row level security;
alter table public.resident_case_media enable row level security;
alter table public.resident_case_notes enable row level security;
revoke all on public.resident_admission_cases from public, anon, authenticated;
revoke all on public.resident_case_media from public, anon, authenticated;
revoke all on public.resident_case_notes from public, anon, authenticated;
grant select on public.resident_admission_cases to authenticated;
grant select on public.resident_case_media to authenticated;
grant select on public.resident_case_notes to authenticated;

drop policy if exists resident_admission_cases_select on public.resident_admission_cases;
create policy resident_admission_cases_select on public.resident_admission_cases
  for select to authenticated using (
    (select private.resident_case_member())
    and (deleted_at is null or (select private.resident_role_is('admin')))
  );

drop policy if exists resident_case_media_select on public.resident_case_media;
create policy resident_case_media_select on public.resident_case_media
  for select to authenticated using (
    (select private.resident_case_member())
    and (deleted_at is null or (select private.resident_role_is('admin')))
    and exists (select 1 from public.resident_admission_cases c where c.id = case_id)
  );

drop policy if exists resident_case_notes_select on public.resident_case_notes;
create policy resident_case_notes_select on public.resident_case_notes
  for select to authenticated using (
    (select private.resident_case_member())
    and (deleted_at is null or (select private.resident_role_is('admin')))
    and exists (select 1 from public.resident_admission_cases c where c.id = case_id)
  );

-- Storage: private bucket for case images -----------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resident-case-media',
  'resident-case-media',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists resident_case_media_objects_select on storage.objects;
create policy resident_case_media_objects_select on storage.objects
  for select to authenticated
  using (bucket_id = 'resident-case-media' and (select private.resident_case_member()));

drop policy if exists resident_case_media_objects_insert on storage.objects;
create policy resident_case_media_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'resident-case-media'
    and (select private.resident_can_edit_case(private.resident_case_path_case_id(name)))
  );

-- Admin may delete any object (purge). The uploader may delete only an object
-- that no media row references yet (cleanup after a failed attach).
drop policy if exists resident_case_media_objects_delete on storage.objects;
create policy resident_case_media_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'resident-case-media'
    and (
      (select private.resident_role_is('admin'))
      or (
        owner_id = (select auth.uid())::text
        and not exists (select 1 from public.resident_case_media m where m.storage_path = name)
      )
    )
  );

-- RPCs ----------------------------------------------------------------------
create or replace function public.create_resident_admission_case(
  p_admit_date date, p_age_years smallint, p_sex text, p_diagnosis text,
  p_management text, p_operation text, p_unit_name text, p_status text, p_owner_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not (select private.resident_case_member()) then
    raise exception 'Active Resident, Staff or Admin account required';
  end if;
  perform private.resident_case_assert_owner(p_owner_id);
  insert into public.resident_admission_cases
    (admit_date, age_years, sex, diagnosis, management, operation, unit_name, status, owner_id, created_by, updated_by)
  values
    (p_admit_date, p_age_years, p_sex, btrim(p_diagnosis), coalesce(p_management, ''), coalesce(p_operation, ''),
     p_unit_name, p_status, p_owner_id, auth.uid(), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_resident_admission_case(
  p_case_id uuid, p_expected_updated_at timestamptz,
  p_admit_date date, p_age_years smallint, p_sex text, p_diagnosis text,
  p_management text, p_operation text, p_unit_name text, p_status text, p_owner_id uuid
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_case public.resident_admission_cases%rowtype;
  v_updated timestamptz;
begin
  if not (select private.resident_case_member()) then
    raise exception 'Active Resident, Staff or Admin account required';
  end if;
  select * into v_case from public.resident_admission_cases
  where id = p_case_id and deleted_at is null for update;
  if not found then raise exception 'Case not found'; end if;
  if not (select private.resident_can_edit_case(p_case_id)) then
    raise exception 'You cannot edit this case';
  end if;
  if v_case.updated_at is distinct from p_expected_updated_at then
    raise exception 'CASE_CONFLICT: this case was changed by someone else';
  end if;
  perform private.resident_case_assert_owner(p_owner_id);
  update public.resident_admission_cases set
    admit_date = p_admit_date, age_years = p_age_years, sex = p_sex,
    diagnosis = btrim(p_diagnosis), management = coalesce(p_management, ''),
    operation = coalesce(p_operation, ''), unit_name = p_unit_name, status = p_status,
    owner_id = p_owner_id, updated_by = auth.uid(), updated_at = clock_timestamp()
  where id = p_case_id
  returning updated_at into v_updated;
  return v_updated;
end;
$$;

create or replace function public.soft_delete_resident_admission_case(
  p_case_id uuid, p_expected_updated_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_case public.resident_admission_cases%rowtype;
begin
  if not (select private.resident_case_member()) then
    raise exception 'Active Resident, Staff or Admin account required';
  end if;
  select * into v_case from public.resident_admission_cases
  where id = p_case_id and deleted_at is null for update;
  if not found then raise exception 'Case not found'; end if;
  if not (
    (select private.resident_role_is('admin'))
    or ((select private.resident_role_is('resident')) and v_case.created_by = auth.uid())
  ) then
    raise exception 'You cannot delete this case';
  end if;
  if v_case.updated_at is distinct from p_expected_updated_at then
    raise exception 'CASE_CONFLICT: this case was changed by someone else';
  end if;
  update public.resident_admission_cases
  set deleted_at = clock_timestamp(), updated_by = auth.uid(), updated_at = clock_timestamp()
  where id = p_case_id;
end;
$$;

create or replace function public.admin_purge_resident_admission_case(p_case_id uuid)
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  v_paths text[];
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  if not exists (select 1 from public.resident_admission_cases where id = p_case_id) then
    raise exception 'Case not found';
  end if;
  select coalesce(array_agg(storage_path), '{}') into v_paths
  from public.resident_case_media where case_id = p_case_id;
  delete from public.resident_case_notes where case_id = p_case_id;
  delete from public.resident_case_media where case_id = p_case_id;
  delete from public.resident_admission_cases where id = p_case_id;
  return v_paths;
end;
$$;

create or replace function public.add_resident_case_media(
  p_case_id uuid, p_storage_path text, p_caption text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not (select private.resident_can_edit_case(p_case_id)) then
    raise exception 'You cannot edit this case';
  end if;
  if p_storage_path is null or left(p_storage_path, 37) <> p_case_id::text || '/' then
    raise exception 'Image path must be inside the case folder';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'resident-case-media' and o.name = p_storage_path) then
    raise exception 'Image file was not uploaded';
  end if;
  insert into public.resident_case_media (case_id, storage_path, caption, created_by)
  values (p_case_id, p_storage_path, left(btrim(coalesce(p_caption, '')), 200), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_resident_case_media(p_media_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.resident_case_media
  set deleted_at = clock_timestamp()
  where id = p_media_id and deleted_at is null
    and (select private.resident_case_member())
    and (created_by = auth.uid() or (select private.resident_role_is('admin')));
  if not found then raise exception 'Image not found or you cannot delete it'; end if;
end;
$$;

create or replace function public.add_resident_case_note(p_case_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if not (select private.resident_case_member()) then
    raise exception 'Active Resident, Staff or Admin account required';
  end if;
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'Note must be 1-2000 characters';
  end if;
  if not exists (select 1 from public.resident_admission_cases where id = p_case_id and deleted_at is null) then
    raise exception 'Case not found';
  end if;
  insert into public.resident_case_notes (case_id, author_id, body)
  values (p_case_id, auth.uid(), v_body)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.edit_resident_case_note(p_note_id uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
begin
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'Note must be 1-2000 characters';
  end if;
  update public.resident_case_notes
  set body = v_body, edited_at = clock_timestamp()
  where id = p_note_id and deleted_at is null and author_id = auth.uid()
    and (select private.resident_case_member());
  if not found then raise exception 'Note not found or you cannot change it'; end if;
end;
$$;

create or replace function public.delete_resident_case_note(p_note_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.resident_case_notes
  set deleted_at = clock_timestamp()
  where id = p_note_id and deleted_at is null
    and (select private.resident_case_member())
    and (author_id = auth.uid() or (select private.resident_role_is('admin')));
  if not found then raise exception 'Note not found or you cannot change it'; end if;
end;
$$;

create or replace function public.list_resident_case_people()
returns table (user_id uuid, full_name text, role text, active boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.resident_case_member()) then
    raise exception 'Active Resident, Staff or Admin account required';
  end if;
  return query
    select p.user_id, p.full_name, r.role::text, (r.active and p.active)
    from public.resident_profiles p
    join public.resident_user_roles r on r.user_id = p.user_id
    order by p.full_name, p.user_id;
end;
$$;

revoke all on function public.create_resident_admission_case(date, smallint, text, text, text, text, text, text, uuid) from public, anon;
revoke all on function public.update_resident_admission_case(uuid, timestamptz, date, smallint, text, text, text, text, text, text, uuid) from public, anon;
revoke all on function public.soft_delete_resident_admission_case(uuid, timestamptz) from public, anon;
revoke all on function public.admin_purge_resident_admission_case(uuid) from public, anon;
revoke all on function public.add_resident_case_media(uuid, text, text) from public, anon;
revoke all on function public.delete_resident_case_media(uuid) from public, anon;
revoke all on function public.add_resident_case_note(uuid, text) from public, anon;
revoke all on function public.edit_resident_case_note(uuid, text) from public, anon;
revoke all on function public.delete_resident_case_note(uuid) from public, anon;
revoke all on function public.list_resident_case_people() from public, anon;
grant execute on function public.create_resident_admission_case(date, smallint, text, text, text, text, text, text, uuid) to authenticated;
grant execute on function public.update_resident_admission_case(uuid, timestamptz, date, smallint, text, text, text, text, text, text, uuid) to authenticated;
grant execute on function public.soft_delete_resident_admission_case(uuid, timestamptz) to authenticated;
grant execute on function public.admin_purge_resident_admission_case(uuid) to authenticated;
grant execute on function public.add_resident_case_media(uuid, text, text) to authenticated;
grant execute on function public.delete_resident_case_media(uuid) to authenticated;
grant execute on function public.add_resident_case_note(uuid, text) to authenticated;
grant execute on function public.edit_resident_case_note(uuid, text) to authenticated;
grant execute on function public.delete_resident_case_note(uuid) to authenticated;
grant execute on function public.list_resident_case_people() to authenticated;

-- Fail the migration if a grant is wrong.
do $$
begin
  if has_function_privilege('anon', 'public.create_resident_admission_case(date, smallint, text, text, text, text, text, text, uuid)'::regprocedure, 'EXECUTE')
    or has_function_privilege('anon', 'public.list_resident_case_people()'::regprocedure, 'EXECUTE')
    or has_table_privilege('authenticated', 'public.resident_admission_cases', 'INSERT')
    or has_table_privilege('authenticated', 'public.resident_case_notes', 'UPDATE')
  then
    raise exception 'Resident case grant regression';
  end if;
end;
$$;

commit;
