create index if not exists year4_events_actor_idx
  on public.year4_approval_events(actor_id);
create index if not exists year4_events_student_idx
  on public.year4_approval_events(student_id);
create index if not exists year4_entries_approved_by_idx
  on public.year4_logbook_entries(approved_by)
  where approved_by is not null;
create index if not exists year4_entries_recorded_by_idx
  on public.year4_logbook_entries(recorded_by);

drop policy if exists year4_entries_student_update on public.year4_logbook_entries;
drop policy if exists year4_entries_staff_update on public.year4_logbook_entries;

create policy year4_entries_authorized_update on public.year4_logbook_entries
for update to authenticated
using (
  (select private.is_staff())
  or (
    (select auth.uid()) = student_id
    and status in ('draft', 'rejected')
  )
)
with check (
  (select private.is_staff())
  or (
    (select auth.uid()) = student_id
    and recorded_by = (select auth.uid())
    and status in ('draft', 'submitted')
    and approved_by is null
  )
);
