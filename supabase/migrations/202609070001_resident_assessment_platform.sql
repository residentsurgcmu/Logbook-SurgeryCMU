-- Resident Surgery EPA/PBA assessment platform.  This migration is additive:
-- it deliberately does not change legacy student, fellow, or Auth records.

create schema if not exists private;

do $$ begin
  create type public.resident_system_role as enum ('admin', 'evaluator', 'resident');
exception when duplicate_object then null;
end $$;

create table if not exists public.resident_user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.resident_system_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.resident_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 160),
  email text not null unique check (email = lower(email)),
  pgy smallint check (pgy between 1 and 4),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.resident_template_definitions (
  id uuid primary key default gen_random_uuid(),
  template_code text not null unique check (template_code ~ '^(EPA|PBA)-[0-9]{1,2}$'),
  template_type text not null check (template_type in ('EPA', 'PBA')),
  title text not null,
  source_file text not null,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  score_options jsonb not null check (jsonb_typeof(score_options) = 'array' and jsonb_array_length(score_options) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.resident_template_criteria (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.resident_template_definitions(id) on delete cascade,
  criterion_code text not null,
  section_title text not null default 'Assessment criteria',
  criterion_text text not null,
  sort_order integer not null check (sort_order > 0),
  active boolean not null default true,
  unique (template_id, criterion_code),
  unique (template_id, sort_order)
);

create table if not exists public.resident_evaluator_assignments (
  id uuid primary key default gen_random_uuid(),
  evaluator_id uuid not null references public.resident_profiles(user_id) on delete cascade,
  resident_id uuid not null references public.resident_profiles(user_id) on delete cascade,
  active boolean not null default true,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.resident_profiles(user_id),
  unique (evaluator_id, resident_id),
  check (evaluator_id <> resident_id)
);

create table if not exists public.resident_assessments (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.resident_template_definitions(id),
  resident_id uuid not null references public.resident_profiles(user_id),
  evaluator_id uuid not null references public.resident_profiles(user_id),
  resident_pgy smallint not null check (resident_pgy between 1 and 4),
  assessment_date date not null check (assessment_date <= current_date),
  clinical_context text not null default '' check (char_length(clinical_context) <= 500),
  procedure_or_activity text not null default '' check (char_length(procedure_or_activity) <= 240),
  overall_outcome text not null default '' check (char_length(overall_outcome) <= 80),
  overall_comment text not null default '' check (char_length(overall_comment) <= 2000),
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.resident_assessment_scores (
  assessment_id uuid not null references public.resident_assessments(id) on delete cascade,
  criterion_id uuid not null references public.resident_template_criteria(id),
  score text not null check (char_length(score) between 1 and 8),
  comment text not null default '' check (char_length(comment) <= 1000),
  primary key (assessment_id, criterion_id)
);

-- An Admin may create assignments, but cannot turn a Resident into an evaluator
-- by inserting an arbitrary row.  Role validation lives in the database so it
-- also protects direct API calls.
create or replace function private.validate_resident_assignment()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if not exists (
    select 1 from public.resident_user_roles
    where user_id = new.evaluator_id and active and role in ('admin', 'evaluator')
  ) then raise exception 'Evaluator assignment requires an active evaluator or admin'; end if;
  if not exists (
    select 1 from public.resident_user_roles
    where user_id = new.resident_id and active and role = 'resident'
  ) then raise exception 'Evaluator assignment requires an active resident'; end if;
  return new;
end;
$$;
revoke all on function private.validate_resident_assignment() from public, anon, authenticated;
drop trigger if exists resident_assignment_role_guard on public.resident_evaluator_assignments;
create trigger resident_assignment_role_guard before insert or update on public.resident_evaluator_assignments
  for each row execute function private.validate_resident_assignment();

create index if not exists resident_profiles_role_lookup_idx on public.resident_user_roles(role, active);
create index if not exists resident_assignments_evaluator_idx on public.resident_evaluator_assignments(evaluator_id, active);
create index if not exists resident_assignments_resident_idx on public.resident_evaluator_assignments(resident_id, active);
create index if not exists resident_assessments_resident_idx on public.resident_assessments(resident_id, assessment_date desc);
create index if not exists resident_assessments_evaluator_idx on public.resident_assessments(evaluator_id, assessment_date desc);
create index if not exists resident_criteria_template_idx on public.resident_template_criteria(template_id, sort_order);

create or replace function private.resident_role_is(expected_role public.resident_system_role)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.resident_user_roles
    where user_id = (select auth.uid()) and role = expected_role and active
  );
$$;
revoke all on function private.resident_role_is(public.resident_system_role) from public, anon, authenticated;

create or replace function private.resident_can_evaluate(target_resident uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select (select private.resident_role_is('admin')) or exists (
    select 1 from public.resident_evaluator_assignments
    where evaluator_id = (select auth.uid()) and resident_id = target_resident and active
  );
$$;
revoke all on function private.resident_can_evaluate(uuid) from public, anon, authenticated;

alter table public.resident_user_roles enable row level security;
alter table public.resident_profiles enable row level security;
alter table public.resident_template_definitions enable row level security;
alter table public.resident_template_criteria enable row level security;
alter table public.resident_evaluator_assignments enable row level security;
alter table public.resident_assessments enable row level security;
alter table public.resident_assessment_scores enable row level security;

create policy resident_roles_select on public.resident_user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select private.resident_role_is('admin')));
create policy resident_profiles_select on public.resident_profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select private.resident_role_is('admin')) or (select private.resident_can_evaluate(user_id)));
create policy resident_templates_select on public.resident_template_definitions for select to authenticated using (active or (select private.resident_role_is('admin')));
create policy resident_criteria_select on public.resident_template_criteria for select to authenticated
  using (exists (select 1 from public.resident_template_definitions where id = template_id and (active or (select private.resident_role_is('admin')))));
create policy resident_assignments_select on public.resident_evaluator_assignments for select to authenticated
  using (evaluator_id = (select auth.uid()) or resident_id = (select auth.uid()) or (select private.resident_role_is('admin')));
create policy resident_assessments_select on public.resident_assessments for select to authenticated
  using (resident_id = (select auth.uid()) or evaluator_id = (select auth.uid()) or (select private.resident_role_is('admin')));
create policy resident_scores_select on public.resident_assessment_scores for select to authenticated
  using (exists (select 1 from public.resident_assessments where id = assessment_id and (resident_id = (select auth.uid()) or evaluator_id = (select auth.uid()) or (select private.resident_role_is('admin')))));

create policy resident_roles_admin_write on public.resident_user_roles for all to authenticated
  using ((select private.resident_role_is('admin'))) with check ((select private.resident_role_is('admin')));
create policy resident_profiles_admin_write on public.resident_profiles for all to authenticated
  using ((select private.resident_role_is('admin'))) with check ((select private.resident_role_is('admin')));
create policy resident_templates_admin_write on public.resident_template_definitions for all to authenticated
  using ((select private.resident_role_is('admin'))) with check ((select private.resident_role_is('admin')));
create policy resident_criteria_admin_write on public.resident_template_criteria for all to authenticated
  using ((select private.resident_role_is('admin'))) with check ((select private.resident_role_is('admin')));
create policy resident_assignments_admin_write on public.resident_evaluator_assignments for all to authenticated
  using ((select private.resident_role_is('admin'))) with check ((select private.resident_role_is('admin')));

create or replace function public.create_resident_assessment(
  p_template_id uuid,
  p_resident_id uuid,
  p_assessment_date date,
  p_clinical_context text,
  p_procedure_or_activity text,
  p_overall_outcome text,
  p_overall_comment text,
  p_scores jsonb
) returns uuid language plpgsql security definer set search_path = public, private, auth as $$
declare
  assessment_id uuid;
  template_row public.resident_template_definitions%rowtype;
  criterion_row public.resident_template_criteria%rowtype;
  score_row jsonb;
  score_value text;
begin
  if not (select private.resident_can_evaluate(p_resident_id)) then raise exception 'Not permitted to assess this resident'; end if;
  select * into template_row from public.resident_template_definitions where id = p_template_id and active;
  if not found then raise exception 'Assessment template is unavailable'; end if;
  if p_assessment_date > current_date then raise exception 'Assessment date cannot be in the future'; end if;
  if jsonb_typeof(p_scores) <> 'array' then raise exception 'Scores must be an array'; end if;
  if (select count(*) from public.resident_template_criteria where template_id = p_template_id and active) <> jsonb_array_length(p_scores) then raise exception 'Every active criterion must have one score'; end if;
  insert into public.resident_assessments (template_id,resident_id,evaluator_id,resident_pgy,assessment_date,clinical_context,procedure_or_activity,overall_outcome,overall_comment)
  select p_template_id,p_resident_id,(select auth.uid()),p.pgy,p_assessment_date,coalesce(p_clinical_context,''),coalesce(p_procedure_or_activity,''),coalesce(p_overall_outcome,''),coalesce(p_overall_comment,'') from public.resident_profiles p where p.user_id = p_resident_id and p.active
  returning id into assessment_id;
  if assessment_id is null then raise exception 'Resident is inactive or unavailable'; end if;
  for criterion_row in select * from public.resident_template_criteria where template_id = p_template_id and active order by sort_order loop
    select value into score_row from jsonb_array_elements(p_scores) where value->>'criterionId' = criterion_row.id::text limit 1;
    if score_row is null then raise exception 'A criterion score is missing'; end if;
    score_value := score_row->>'score';
    if score_value is null or not (template_row.score_options ? score_value) then raise exception 'Invalid score option'; end if;
    insert into public.resident_assessment_scores (assessment_id,criterion_id,score,comment)
    values (assessment_id,criterion_row.id,score_value,coalesce(score_row->>'comment',''));
  end loop;
  return assessment_id;
end;
$$;
revoke all on function public.create_resident_assessment(uuid,uuid,date,text,text,text,text,jsonb) from public, anon;
grant execute on function public.create_resident_assessment(uuid,uuid,date,text,text,text,text,jsonb) to authenticated;

-- Bootstrap the dedicated owner only when that verified Auth account exists.
insert into public.resident_user_roles (user_id, role, active)
select id, 'admin'::public.resident_system_role, true from auth.users where lower(email) = 'resident.surgcmu@gmail.com'
on conflict (user_id) do update set role = excluded.role, active = true, updated_at = now();
insert into public.resident_profiles (user_id, full_name, email, active)
select id, coalesce(raw_user_meta_data->>'full_name', 'Resident Surgery Admin'), lower(email), true from auth.users where lower(email) = 'resident.surgcmu@gmail.com'
on conflict (user_id) do update set email = excluded.email, active = true, updated_at = now();
