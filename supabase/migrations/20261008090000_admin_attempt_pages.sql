-- Admin pages for EPA/PBA attempts (release piece 3). Additive only: nothing existing is changed.
--   * resident_user_roles.admin_tag: a short label such as "Admin หลัก (F)" / "Admin รอง (N)" shown next to an Admin's name
--     in history. It does NOT change any permission (every Admin has the same rights).
--   * private.resident_can_view_cohort_progress(): the one named capability that decides who may see everybody's progress
--     and the history of extra attempts (today: Admin; it can move to other roles later without rewriting the functions).
--   * admin_list_attempt_grants(): history of extra attempts an Admin granted (who, to whom, which form, reason, when).
--   * admin_list_epa_pba_progress(): one row per active Resident per active form with the numbers needed for the Excel export.
--     It uses the same rules as get_my_epa_progress() (attempts used, limit incl. granted attempts, this academic year,
--     "reached the level" = every criterion of ONE assessment at L4/L5, M/E for the F/M/E forms).
-- Safe to run again.

alter table public.resident_user_roles add column if not exists admin_tag text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'resident_user_roles_admin_tag_check' and conrelid = 'public.resident_user_roles'::regclass) then
    alter table public.resident_user_roles
      add constraint resident_user_roles_admin_tag_check check (admin_tag is null or char_length(btrim(admin_tag)) between 1 and 40);
  end if;
end $$;

create or replace function private.resident_can_view_cohort_progress()
returns boolean language sql stable security definer set search_path = public, private, auth as $$
  select private.resident_role_is('admin')
$$;
revoke all on function private.resident_can_view_cohort_progress() from public, anon;
grant execute on function private.resident_can_view_cohort_progress() to authenticated;

create or replace function public.admin_list_attempt_grants(p_resident_id uuid default null)
returns table (
  grant_id uuid, resident_id uuid, resident_name text, template_id uuid, template_code text, template_title text,
  reason text, granted_by uuid, granted_by_name text, granted_by_tag text, created_at timestamptz
)
language plpgsql stable security definer set search_path = public, private, auth as $$
#variable_conflict use_column
begin
  if not (select private.resident_can_view_cohort_progress()) then raise exception 'Active Admin account required'; end if;
  return query
  select g.id, g.resident_id, rp.full_name, g.template_id, t.template_code, t.title, g.reason, g.granted_by,
         gp.full_name, gr.admin_tag, g.created_at
  from public.resident_attempt_grants g
  join public.resident_profiles rp on rp.user_id = g.resident_id
  join public.resident_template_definitions t on t.id = g.template_id
  left join public.resident_profiles gp on gp.user_id = g.granted_by
  left join public.resident_user_roles gr on gr.user_id = g.granted_by and gr.role = 'admin'
  where p_resident_id is null or g.resident_id = p_resident_id
  order by g.created_at desc, g.id;
end;
$$;
revoke all on function public.admin_list_attempt_grants(uuid) from public, anon;
grant execute on function public.admin_list_attempt_grants(uuid) to authenticated;

create or replace function public.admin_list_epa_pba_progress()
returns table (
  resident_id uuid, resident_name text, resident_pgy integer, template_id uuid, template_code text, template_type text,
  template_title text, counts_for_board boolean, attempts_used integer, attempts_cap integer, attempts_this_year integer,
  met boolean, done boolean
)
language plpgsql stable security definer set search_path = public, private, auth as $$
#variable_conflict use_column
declare
  v_ay_start date := private.resident_academic_year_start(clock_timestamp());
  v_start_at timestamptz := v_ay_start::timestamp at time zone 'Asia/Bangkok';
  v_end_at timestamptz := (v_ay_start + interval '1 year')::timestamp at time zone 'Asia/Bangkok';
  v_end_date date := (v_ay_start + interval '1 year')::date;
begin
  if not (select private.resident_can_view_cohort_progress()) then raise exception 'Active Admin account required'; end if;
  return query
  with res as (
    select p.user_id, p.full_name, p.pgy::integer as pgy
    from public.resident_profiles p
    join public.resident_user_roles r on r.user_id = p.user_id
    where r.role = 'resident' and r.active and p.active
  ),
  tpl as (
    select t.id, t.template_code, t.template_type, t.title, t.max_attempts, t.score_options,
           case when t.score_options ? 'L5' then 4 else 2 end as need_rank
    from public.resident_template_definitions t where t.active
  ),
  req as (
    select q.resident_id, q.template_id, count(*) as used_req,
           count(*) filter (where q.submitted_at >= v_start_at and q.submitted_at < v_end_at) as year_req
    from public.resident_assessment_requests q where q.status <> 'cancelled' group by q.resident_id, q.template_id
  ),
  hist as (
    select a.resident_id, a.template_id, count(*) as used_hist,
           count(*) filter (where a.assessment_date >= v_ay_start and a.assessment_date < v_end_date) as year_hist
    from public.resident_assessments a
    where not exists (select 1 from public.resident_assessment_requests l where l.assessment_id = a.id)
    group by a.resident_id, a.template_id
  ),
  grants as (
    select g.resident_id, g.template_id, count(*) as n from public.resident_attempt_grants g group by g.resident_id, g.template_id
  ),
  graded as (
    select a.resident_id, a.template_id, a.id as assessment_id, min(coalesce(rk.ord, 0)) as min_rank
    from public.resident_assessments a
    join tpl on tpl.id = a.template_id and tpl.template_type = 'EPA'
    join public.resident_assessment_scores s on s.assessment_id = a.id
    left join lateral (
      select o.ord from jsonb_array_elements_text(tpl.score_options) with ordinality as o(val, ord) where o.val = s.score
    ) rk on true
    group by a.resident_id, a.template_id, a.id
  ),
  reached as (
    select gd.resident_id, gd.template_id, bool_or(gd.min_rank >= tpl.need_rank) as is_met
    from graded gd join tpl on tpl.id = gd.template_id group by gd.resident_id, gd.template_id
  )
  select res.user_id, res.full_name, res.pgy, tpl.id, tpl.template_code, tpl.template_type, tpl.title,
         (tpl.template_code <> 'EPA-8'),
         (coalesce(req.used_req, 0) + coalesce(hist.used_hist, 0))::integer,
         case when tpl.max_attempts is null then null else (tpl.max_attempts + coalesce(grants.n, 0))::integer end,
         (coalesce(req.year_req, 0) + coalesce(hist.year_hist, 0))::integer,
         case when tpl.template_type = 'EPA' then coalesce(reached.is_met, false) else null end,
         case when tpl.template_type = 'PBA' then (coalesce(req.used_req, 0) + coalesce(hist.used_hist, 0)) > 0 else null end
  from res cross join tpl
  left join req on req.resident_id = res.user_id and req.template_id = tpl.id
  left join hist on hist.resident_id = res.user_id and hist.template_id = tpl.id
  left join grants on grants.resident_id = res.user_id and grants.template_id = tpl.id
  left join reached on reached.resident_id = res.user_id and reached.template_id = tpl.id
  order by res.full_name, res.user_id, tpl.template_code;
end;
$$;
revoke all on function public.admin_list_epa_pba_progress() from public, anon;
grant execute on function public.admin_list_epa_pba_progress() to authenticated;
