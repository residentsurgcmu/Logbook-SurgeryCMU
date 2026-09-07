begin;

do $$
begin
  if exists (select 1 from public.student_promotion_audit) then
    raise exception 'Cannot remove promotion system while promotion audit rows exist';
  end if;
  if exists (select 1 from public.student_promotion_batches) then
    raise exception 'Cannot remove promotion system while promotion batch rows exist';
  end if;
end;
$$;

drop function if exists public.admin_promote_student_batch(uuid,uuid,jsonb);
drop function if exists public.admin_rollback_promotion_batch(uuid,uuid,text);
drop function if exists public.admin_promote_students(uuid,uuid[],uuid,text,uuid,boolean,text);
drop function if exists public.admin_rollback_promotion(uuid,uuid,text);

drop table if exists public.student_promotion_audit;
drop table if exists public.student_promotion_batches;

commit;
