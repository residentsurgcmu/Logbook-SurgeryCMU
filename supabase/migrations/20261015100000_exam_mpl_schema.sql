-- Exam scores + MPL (minimum passing level). Additive: legacy exams stay
-- scoring_mode = 'manual' and their RPCs are not changed by this file.
begin;

create table public.resident_exam_standards (
  id uuid primary key default gen_random_uuid(),
  exam_type text not null check (exam_type in ('xray_anatomy', 'mcq')),
  part_name text not null check (char_length(btrim(part_name)) between 1 and 120),
  max_score numeric(10,2) not null check (max_score > 0),
  updated_by uuid not null references public.resident_profiles(user_id),
  updated_at timestamptz not null default clock_timestamp()
);
create unique index resident_exam_standards_type_name_unique
  on public.resident_exam_standards(exam_type, lower(part_name));

create table public.resident_exam_standard_mpl (
  standard_id uuid not null references public.resident_exam_standards(id) on delete cascade,
  pgy smallint not null check (pgy between 1 and 4),
  mpl numeric(10,2) not null check (mpl >= 0),
  primary key (standard_id, pgy)
);

alter table public.resident_exam_events
  add column if not exists scoring_mode text not null default 'manual'
    check (scoring_mode in ('manual', 'mpl'));
alter table public.resident_exam_parts
  add column if not exists max_score numeric(10,2) check (max_score is null or max_score > 0);
alter table public.resident_exam_participants
  add column if not exists pgy_at_exam smallint check (pgy_at_exam between 1 and 4);
alter table public.resident_exam_results
  alter column outcome drop not null;
alter table public.resident_exam_results
  add column if not exists outcome_source text not null default 'manual'
    check (outcome_source in ('computed', 'manual'));

update public.resident_exam_participants participant
set pgy_at_exam = profile.pgy
from public.resident_profiles profile
where profile.user_id = participant.resident_id
  and participant.pgy_at_exam is null
  and profile.pgy between 1 and 4;

create table public.resident_exam_mpl (
  event_id uuid not null references public.resident_exam_events(id) on delete cascade,
  part_id uuid references public.resident_exam_parts(id) on delete cascade,
  pgy smallint not null check (pgy between 1 and 4),
  mpl numeric(10,2) not null check (mpl >= 0)
);
create unique index resident_exam_mpl_part_unique
  on public.resident_exam_mpl(event_id, part_id, pgy) where part_id is not null;
create unique index resident_exam_mpl_mcq_unique
  on public.resident_exam_mpl(event_id, pgy) where part_id is null;

alter table public.resident_exam_standards enable row level security;
alter table public.resident_exam_standard_mpl enable row level security;
alter table public.resident_exam_mpl enable row level security;
revoke all on public.resident_exam_standards, public.resident_exam_standard_mpl,
  public.resident_exam_mpl from public, anon, authenticated;
grant select on public.resident_exam_standards, public.resident_exam_standard_mpl, public.resident_exam_mpl to authenticated;

create policy resident_exam_standards_visible on public.resident_exam_standards
  for select to authenticated using (
    (select private.resident_role_is('admin')) or (select private.resident_role_is('staff'))
  );
create policy resident_exam_standard_mpl_visible on public.resident_exam_standard_mpl
  for select to authenticated using (
    (select private.resident_role_is('admin')) or (select private.resident_role_is('staff'))
  );
create policy resident_exam_mpl_visible on public.resident_exam_mpl
  for select to authenticated using (
    (select private.resident_role_is('admin'))
    or (
      private.resident_exam_is_published(event_id)
      and (
        (select private.resident_role_is('staff'))
        or private.resident_is_exam_participant(event_id)
      )
    )
  );

create or replace function private.resident_exam_parse_number(p_value text, p_max numeric, p_label text)
returns numeric
language plpgsql immutable set search_path = '' as $$
declare v numeric;
begin
  if coalesce(p_value, '') !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' then
    raise exception '% is invalid', p_label;
  end if;
  v := p_value::numeric;
  if p_max is not null and v > p_max then
    raise exception '% must not exceed the full score', p_label;
  end if;
  return v;
end;
$$;
revoke all on function private.resident_exam_parse_number(text, numeric, text) from public, anon;
grant execute on function private.resident_exam_parse_number(text, numeric, text) to authenticated;

-- An MPL exam's outcome is always computed on the server. The legacy save RPC
-- inserts outcome_source = 'manual' (the column default) and is refused here.
create or replace function private.resident_exam_results_mode_guard()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.resident_exam_events e
    where e.id = new.event_id and e.scoring_mode = 'mpl'
  ) and new.outcome_source <> 'computed' then
    raise exception 'MPL exams compute the outcome on the server';
  end if;
  return new;
end;
$$;
create trigger resident_exam_results_mode_guard
  before insert or update on public.resident_exam_results
  for each row execute function private.resident_exam_results_mode_guard();

create or replace function public.save_resident_exam_standards(p_standards jsonb)
returns void
language plpgsql security definer set search_path = public, private, auth as $$
declare
  v_item jsonb;
  v_type text;
  v_name text;
  v_max numeric;
  v_id uuid;
  v_pgy integer;
  v_text text;
  v_key text;
  v_seen text[] := array[]::text[];
  v_mcq_count integer := 0;
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  if coalesce(jsonb_typeof(p_standards), '') <> 'array' then
    raise exception 'Standards must be an array';
  end if;
  delete from public.resident_exam_standards where true;
  for v_item in select value from jsonb_array_elements(p_standards) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'Standard is invalid'; end if;
    v_type := v_item->>'examType';
    v_name := btrim(coalesce(v_item->>'partName', ''));
    if v_type not in ('xray_anatomy', 'mcq') or char_length(v_name) not between 1 and 120 then
      raise exception 'Standard is invalid';
    end if;
    v_key := v_type || ':' || lower(v_name);
    if v_key = any(v_seen) then raise exception 'Standard is duplicated'; end if;
    v_seen := array_append(v_seen, v_key);
    if v_type = 'mcq' then v_mcq_count := v_mcq_count + 1; end if;
    v_max := private.resident_exam_parse_number(v_item->>'maxScore', null, 'Full score');
    if v_max <= 0 then raise exception 'Full score must be greater than zero'; end if;
    insert into public.resident_exam_standards(exam_type, part_name, max_score, updated_by)
    values (v_type, v_name, v_max, (select auth.uid()))
    returning id into v_id;
    for v_pgy in 1..4 loop
      v_text := v_item->'mpl'->>(v_pgy::text);
      if coalesce(btrim(v_text), '') <> '' then
        insert into public.resident_exam_standard_mpl(standard_id, pgy, mpl)
        values (v_id, v_pgy, private.resident_exam_parse_number(v_text, v_max, 'MPL'));
      end if;
    end loop;
  end loop;
  if v_mcq_count > 1 then raise exception 'Only one MCQ standard is allowed'; end if;
end;
$$;
revoke all on function public.save_resident_exam_standards(jsonb) from public, anon;
grant execute on function public.save_resident_exam_standards(jsonb) to authenticated;

commit;
