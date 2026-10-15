-- Admin deletes an exam that is still a Draft. Published exams must be returned to
-- Draft first. Parts, participants, results and the MPL snapshot go with the event
-- through their existing ON DELETE CASCADE foreign keys. The results guard trigger
-- refuses a direct delete on an MPL exam unless app.exam_mpl_save is on. During the
-- cascade the parent row is already gone so the guard passes anyway; the transaction-
-- local flag is kept as a defence in case the guard's lookup ever changes.
begin;

create or replace function public.delete_resident_exam_event(p_event_id uuid)
returns void
language plpgsql security definer set search_path = public, private, auth as $$
declare
  v_event public.resident_exam_events%rowtype;
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  select * into v_event from public.resident_exam_events where id = p_event_id for update;
  if not found then raise exception 'Exam was not found'; end if;
  if v_event.status <> 'draft' then raise exception 'Return the exam to Draft before deleting it'; end if;
  perform set_config('app.exam_mpl_save', 'on', true);
  delete from public.resident_exam_events where id = p_event_id;
end;
$$;
revoke all on function public.delete_resident_exam_event(uuid) from public, anon;
grant execute on function public.delete_resident_exam_event(uuid) to authenticated;

commit;
