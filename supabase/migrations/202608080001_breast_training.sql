-- Breast Surgery Training production schema
-- Source documents remain in Google Drive; operational data is stored in Supabase.

create table public.user_directory (
  email text primary key,
  full_name text not null,
  role text not null check (role in ('staff', 'fellow')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint user_directory_email_lowercase check (email = lower(email))
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role text not null check (role in ('staff', 'fellow')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_lowercase check (email = lower(email))
);

create table public.essential_procedures (
  id text primary key,
  category text not null,
  operation text not null,
  sort_order integer not null check (sort_order > 0),
  created_at timestamptz not null default now()
);

create table public.essential_targets (
  id bigint generated always as identity primary key,
  procedure_id text not null references public.essential_procedures(id) on delete cascade,
  participation text not null check (participation in ('Surgeon', 'Supervisor', 'Assist', 'Observe')),
  target_count integer not null check (target_count > 0),
  unique (procedure_id, participation)
);

create table public.logbook_entries (
  id bigint generated always as identity primary key,
  fellow_id uuid not null references public.profiles(id) on delete cascade,
  recorded_by uuid not null references public.profiles(id),
  procedure_id text not null references public.essential_procedures(id),
  operation text not null,
  procedure_date date not null,
  patient_reference text,
  diagnosis text,
  participation text not null check (participation in ('Surgeon', 'Supervisor', 'Assist', 'Observe')),
  supervisor_name text not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.epa_assessments (
  id bigint generated always as identity primary key,
  fellow_id uuid not null references public.profiles(id) on delete cascade,
  assessor_id uuid not null references public.profiles(id),
  supervisor_name text not null,
  template_id text not null check (template_id in ('EPA 1', 'EPA 2', 'EPA 3', 'EPA 4', 'EPA 5', 'EPA 6', 'EPA 7')),
  template_title text not null,
  assessment_date date not null,
  activity_reference text,
  scores jsonb not null default '{}'::jsonb,
  item_comments jsonb not null default '{}'::jsonb,
  global_level smallint not null check (global_level between 1 and 5),
  comments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pba_assessments (
  id bigint generated always as identity primary key,
  fellow_id uuid not null references public.profiles(id) on delete cascade,
  assessor_id uuid not null references public.profiles(id),
  supervisor_name text not null,
  template_id text not null check (template_id in ('PBA 1', 'PBA 2', 'PBA 3')),
  template_title text not null,
  assessment_date date not null,
  activity_reference text,
  scores jsonb not null default '{}'::jsonb,
  item_comments jsonb not null default '{}'::jsonb,
  global_level smallint not null check (global_level between 1 and 5),
  comments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.topics (
  id bigint generated always as identity primary key,
  fellow_id uuid not null references public.profiles(id) on delete cascade,
  recorded_by uuid not null references public.profiles(id),
  topic_date date not null,
  title text not null,
  detail text,
  status text not null default 'In progress' check (status in ('Planned', 'In progress', 'Completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_idx on public.profiles(role);
create index logbook_entries_fellow_date_idx on public.logbook_entries(fellow_id, procedure_date desc);
create index logbook_entries_procedure_participation_idx on public.logbook_entries(procedure_id, participation);
create index epa_assessments_fellow_date_idx on public.epa_assessments(fellow_id, assessment_date desc);
create index epa_assessments_assessor_idx on public.epa_assessments(assessor_id);
create index pba_assessments_fellow_date_idx on public.pba_assessments(fellow_id, assessment_date desc);
create index pba_assessments_assessor_idx on public.pba_assessments(assessor_id);
create index topics_fellow_date_idx on public.topics(fellow_id, topic_date desc);

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid()) and active = true
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select public.current_user_role()) = 'staff', false)
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  directory_entry public.user_directory%rowtype;
begin
  select * into directory_entry
  from public.user_directory
  where email = lower(new.email) and active = true;

  if not found then
    raise exception 'This email is not authorized for Breast Surgery Training';
  end if;

  insert into public.profiles (id, email, full_name, role, active)
  values (new.id, directory_entry.email, directory_entry.full_name, directory_entry.role, true);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();
create trigger logbook_touch_updated_at before update on public.logbook_entries
for each row execute function public.touch_updated_at();
create trigger epa_touch_updated_at before update on public.epa_assessments
for each row execute function public.touch_updated_at();
create trigger pba_touch_updated_at before update on public.pba_assessments
for each row execute function public.touch_updated_at();
create trigger topics_touch_updated_at before update on public.topics
for each row execute function public.touch_updated_at();

alter table public.user_directory enable row level security;
alter table public.profiles enable row level security;
alter table public.essential_procedures enable row level security;
alter table public.essential_targets enable row level security;
alter table public.logbook_entries enable row level security;
alter table public.epa_assessments enable row level security;
alter table public.pba_assessments enable row level security;
alter table public.topics enable row level security;

create policy profiles_select_authorized on public.profiles
for select to authenticated
using ((select auth.uid()) = id or (select public.is_staff()));

create policy essential_procedures_select on public.essential_procedures
for select to authenticated using (true);
create policy essential_targets_select on public.essential_targets
for select to authenticated using (true);

create policy logbook_select on public.logbook_entries
for select to authenticated
using ((select auth.uid()) = fellow_id or (select public.is_staff()));
create policy logbook_insert on public.logbook_entries
for insert to authenticated
with check (
  recorded_by = (select auth.uid())
  and ((select auth.uid()) = fellow_id or (select public.is_staff()))
);
create policy logbook_update on public.logbook_entries
for update to authenticated
using ((select auth.uid()) = fellow_id or (select public.is_staff()))
with check ((select auth.uid()) = fellow_id or (select public.is_staff()));

create policy epa_select on public.epa_assessments
for select to authenticated
using ((select auth.uid()) = fellow_id or (select public.is_staff()));
create policy epa_staff_insert on public.epa_assessments
for insert to authenticated
with check ((select public.is_staff()) and assessor_id = (select auth.uid()));
create policy epa_staff_update on public.epa_assessments
for update to authenticated
using ((select public.is_staff()) and assessor_id = (select auth.uid()))
with check ((select public.is_staff()) and assessor_id = (select auth.uid()));

create policy pba_select on public.pba_assessments
for select to authenticated
using ((select auth.uid()) = fellow_id or (select public.is_staff()));
create policy pba_staff_insert on public.pba_assessments
for insert to authenticated
with check ((select public.is_staff()) and assessor_id = (select auth.uid()));
create policy pba_staff_update on public.pba_assessments
for update to authenticated
using ((select public.is_staff()) and assessor_id = (select auth.uid()))
with check ((select public.is_staff()) and assessor_id = (select auth.uid()));

create policy topics_select on public.topics
for select to authenticated
using ((select auth.uid()) = fellow_id or (select public.is_staff()));
create policy topics_insert on public.topics
for insert to authenticated
with check (
  recorded_by = (select auth.uid())
  and ((select auth.uid()) = fellow_id or (select public.is_staff()))
);
create policy topics_update on public.topics
for update to authenticated
using ((select auth.uid()) = fellow_id or (select public.is_staff()))
with check ((select auth.uid()) = fellow_id or (select public.is_staff()));

revoke all on public.user_directory from anon, authenticated;
revoke all on public.profiles, public.essential_procedures, public.essential_targets,
  public.logbook_entries, public.epa_assessments, public.pba_assessments, public.topics from anon;
grant select on public.profiles, public.essential_procedures, public.essential_targets,
  public.logbook_entries, public.epa_assessments, public.pba_assessments, public.topics to authenticated;
grant insert, update on public.logbook_entries, public.epa_assessments, public.pba_assessments, public.topics to authenticated;
grant usage, select on all sequences in schema public to authenticated;

insert into public.essential_procedures (id, category, operation, sort_order) values
  ('breast-ultrasound', 'Essential — Common', 'Breast ultrasound', 1),
  ('percutaneous', 'Essential — Common', 'Percutaneous procedures', 2),
  ('duct-excision', 'Essential — Common', 'Major ductal exploration / excision', 3),
  ('partial-mastectomy', 'Essential — Common', 'Partial mastectomy / diagnostic excision', 4),
  ('oncoplastic', 'Essential — Common', 'Oncoplastic partial mastectomy', 5),
  ('total-mastectomy', 'Essential — Common', 'Total mastectomy', 6),
  ('skin-sparing', 'Essential — Common', 'Skin-sparing mastectomy', 7),
  ('nipple-sparing', 'Essential — Common', 'Nipple / areolar-sparing mastectomy', 8),
  ('pedicle-flap', 'Essential — Common', 'Pedicle flap reconstruction', 9),
  ('breast-implant', 'Essential — Common', 'Breast implant reconstruction', 10),
  ('sentinel-node', 'Essential — Common', 'Sentinel node biopsy', 11),
  ('axillary-dissection', 'Essential — Common', 'Level 1–2 axillary node dissection', 12),
  ('level-3-node', 'Essential — Uncommon', 'Level 3 node dissection', 13),
  ('palliative-mastectomy', 'Essential — Uncommon', 'Palliative mastectomy for stage 4 disease', 14),
  ('chest-wall', 'Essential — Uncommon', 'Chest wall recurrence / radical resection', 15),
  ('local-flap', 'Essential — Uncommon', 'Local tissue flap closure', 16),
  ('free-flap', 'Essential — Uncommon', 'Free flap reconstruction (TRAM / DIEP)', 17),
  ('vacuum-biopsy', 'Complex — As available', 'Vacuum-assisted core biopsy', 18),
  ('wire-localization', 'Complex — As available', 'Wire / seed / clip localization', 19),
  ('tumor-ablation', 'Complex — As available', 'Tumor ablation', 20),
  ('gynecomastia', 'Complex — As available', 'Subcutaneous mastectomy for gynecomastia', 21),
  ('radical-mastectomy', 'Complex — As available', 'Radical mastectomy', 22);

insert into public.essential_targets (procedure_id, participation, target_count) values
  ('breast-ultrasound', 'Surgeon', 30),
  ('percutaneous', 'Supervisor', 10), ('percutaneous', 'Surgeon', 15),
  ('duct-excision', 'Surgeon', 1),
  ('partial-mastectomy', 'Supervisor', 5), ('partial-mastectomy', 'Surgeon', 10),
  ('oncoplastic', 'Supervisor', 5), ('oncoplastic', 'Surgeon', 10),
  ('total-mastectomy', 'Supervisor', 5), ('total-mastectomy', 'Surgeon', 10),
  ('skin-sparing', 'Surgeon', 1), ('skin-sparing', 'Assist', 5),
  ('nipple-sparing', 'Surgeon', 1), ('nipple-sparing', 'Assist', 5),
  ('pedicle-flap', 'Assist', 2), ('pedicle-flap', 'Observe', 5),
  ('breast-implant', 'Assist', 2), ('breast-implant', 'Observe', 5),
  ('sentinel-node', 'Supervisor', 5), ('sentinel-node', 'Surgeon', 10),
  ('axillary-dissection', 'Supervisor', 2), ('axillary-dissection', 'Surgeon', 5);
