-- 1) resident-admin: find an existing Auth user by email.
--    Staff seeded from the old Year 4 directory usually already have an Auth
--    account, so inviteUserByEmail fails with "already registered". The edge
--    function (service_role) uses this to link that account instead.
create or replace function public.admin_find_auth_user_id(p_email text)
returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u
  where lower(u.email) = lower(btrim(p_email))
  limit 1;
$$;
revoke all on function public.admin_find_auth_user_id(text) from public, anon, authenticated;
grant execute on function public.admin_find_auth_user_id(text) to service_role;

-- 2) Exam RLS: events <-> participants policies referenced each other, so a
--    direct SELECT on any resident_exam_* table failed with "infinite
--    recursion detected in policy". Move the cross-table checks into
--    SECURITY DEFINER helpers that read the tables without RLS.
create or replace function private.resident_exam_is_published(p_event_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.resident_exam_events e
    where e.id = p_event_id and e.status = 'published'
  );
$$;

create or replace function private.resident_is_exam_participant(p_event_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.resident_exam_participants p
    where p.event_id = p_event_id and p.resident_id = (select auth.uid())
  );
$$;

revoke all on function private.resident_exam_is_published(uuid) from public, anon;
revoke all on function private.resident_is_exam_participant(uuid) from public, anon;
grant execute on function private.resident_exam_is_published(uuid) to authenticated;
grant execute on function private.resident_is_exam_participant(uuid) to authenticated;

drop policy if exists resident_exam_events_visible on public.resident_exam_events;
create policy resident_exam_events_visible on public.resident_exam_events
  for select to authenticated using (
    (select private.resident_role_is('admin'))
    or (
      status = 'published' and (
        (select private.resident_role_is('staff'))
        or private.resident_is_exam_participant(id)
      )
    )
  );

drop policy if exists resident_exam_participants_visible on public.resident_exam_participants;
create policy resident_exam_participants_visible on public.resident_exam_participants
  for select to authenticated using (
    (select private.resident_role_is('admin'))
    or (
      private.resident_exam_is_published(event_id)
      and (resident_id = (select auth.uid()) or (select private.resident_role_is('staff')))
    )
  );

drop policy if exists resident_exam_parts_visible on public.resident_exam_parts;
create policy resident_exam_parts_visible on public.resident_exam_parts
  for select to authenticated using (
    (select private.resident_role_is('admin'))
    or (
      private.resident_exam_is_published(event_id)
      and ((select private.resident_role_is('staff')) or private.resident_is_exam_participant(event_id))
    )
  );

drop policy if exists resident_exam_results_visible on public.resident_exam_results;
create policy resident_exam_results_visible on public.resident_exam_results
  for select to authenticated using (
    (select private.resident_role_is('admin'))
    or (
      private.resident_exam_is_published(event_id)
      and ((select private.resident_role_is('staff')) or resident_id = (select auth.uid()))
    )
  );
