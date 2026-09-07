begin;

create table if not exists public.student_promotion_batches (
  id uuid primary key default gen_random_uuid(),
  source_curriculum_id uuid not null references public.curricula(id),
  destination_curriculum_id uuid not null references public.curricula(id),
  actor_id uuid not null references public.profiles(id),
  student_count integer not null check (student_count > 0),
  override_count integer not null default 0 check (override_count >= 0),
  status text not null default 'completed' check (status in ('completed','rolled_back')),
  created_at timestamptz not null default now(),
  rolled_back_at timestamptz,
  rolled_back_by uuid references public.profiles(id),
  rollback_reason text
);

alter table public.student_promotion_audit
  add column if not exists promotion_batch_id uuid references public.student_promotion_batches(id);

create index if not exists student_promotion_audit_batch_idx
  on public.student_promotion_audit(promotion_batch_id,created_at);
create index if not exists student_promotion_batches_created_idx
  on public.student_promotion_batches(created_at desc);

alter table public.student_promotion_batches enable row level security;
drop policy if exists student_promotion_batches_admin_select on public.student_promotion_batches;
create policy student_promotion_batches_admin_select on public.student_promotion_batches
  for select to authenticated using ((select private.is_admin()));

revoke all on public.student_promotion_batches from anon,authenticated;
grant select on public.student_promotion_batches to authenticated;

create or replace function public.admin_promote_student_batch(
  p_actor_id uuid,
  p_destination_curriculum_id uuid,
  p_assignments jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  destination public.curricula%rowtype;
  source public.student_enrollments%rowtype;
  assignment jsonb;
  student uuid;
  rotation uuid;
  destination_group text;
  override_value boolean;
  override_reason text;
  source_curriculum_id uuid;
  destination_enrollment uuid;
  batch_id uuid;
  promoted integer := 0;
  override_total integer := 0;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin' and active=true) then
    raise exception 'Admin authorization required';
  end if;
  if jsonb_typeof(p_assignments) <> 'array' or jsonb_array_length(p_assignments)=0 then
    raise exception 'Promotion assignments are required';
  end if;
  if exists(
    select 1 from jsonb_array_elements(p_assignments) item
    group by item->>'studentId' having count(*) > 1
  ) then raise exception 'Duplicate student in promotion batch'; end if;

  select * into destination from public.curricula
  where id=p_destination_curriculum_id and status='published';
  if not found then raise exception 'Destination curriculum must be published'; end if;

  -- Validate and lock every source enrollment before any enrollment is changed.
  for assignment in select value from jsonb_array_elements(p_assignments) loop
    begin student := (assignment->>'studentId')::uuid;
    exception when others then raise exception 'Invalid studentId in promotion assignment'; end;
    destination_group := nullif(trim(assignment->>'destinationGroup'),'');
    begin rotation := (assignment->>'destinationRotationId')::uuid;
    exception when others then raise exception 'Invalid destinationRotationId for student %',student; end;
    override_value := coalesce((assignment->>'override')::boolean,false);
    override_reason := nullif(trim(assignment->>'overrideReason'),'');

    if destination_group is null or rotation is null then
      raise exception 'Destination group and rotation are required for student %',student;
    end if;
    if override_value and override_reason is null then
      raise exception 'Override reason is required for student %',student;
    end if;
    select enrollment.* into source from public.student_enrollments enrollment
      where enrollment.student_id=student and enrollment.status='active' for update;
    if not found then raise exception 'Student % has no active enrollment',student; end if;
    if source_curriculum_id is null then source_curriculum_id := source.curriculum_id;
    elsif source_curriculum_id <> source.curriculum_id then
      raise exception 'All students in a batch must share one source curriculum';
    end if;
    if destination.class_year <> (select class_year+1 from public.curricula where id=source.curriculum_id)
      or destination.academic_year <> (select academic_year+1 from public.curricula where id=source.curriculum_id) then
      raise exception 'Destination must be the next class year and next academic year';
    end if;
    if exists(select 1 from public.student_enrollments where student_id=student and curriculum_id=destination.id and status='active') then
      raise exception 'Student % is already active in destination curriculum',student;
    end if;
    if not exists(
      select 1 from public.curriculum_rotations
      where id=rotation and curriculum_id=destination.id and group_code=destination_group and status<>'archived'
    ) then raise exception 'Rotation does not match destination curriculum and group for student %',student; end if;
    if not exists(
      select 1 from public.year4_logbook_certifications where enrollment_id=source.id and status='certified'
    ) and not override_value then raise exception 'Student % logbook is not certified',student; end if;
  end loop;

  insert into public.student_promotion_batches(
    source_curriculum_id,destination_curriculum_id,actor_id,student_count,override_count
  ) values(
    source_curriculum_id,destination.id,p_actor_id,jsonb_array_length(p_assignments),
    (select count(*) from jsonb_array_elements(p_assignments) item where coalesce((item->>'override')::boolean,false))
  ) returning id,override_count into batch_id,override_total;

  for assignment in select value from jsonb_array_elements(p_assignments) loop
    student := (assignment->>'studentId')::uuid;
    destination_group := trim(assignment->>'destinationGroup');
    rotation := (assignment->>'destinationRotationId')::uuid;
    override_value := coalesce((assignment->>'override')::boolean,false);
    override_reason := nullif(trim(assignment->>'overrideReason'),'');
    select enrollment.* into source from public.student_enrollments enrollment
      where enrollment.student_id=student and enrollment.status='active';

    update public.student_enrollments set status='completed',completed_at=statement_timestamp()
      where id=source.id;
    insert into public.student_enrollments(student_id,curriculum_id,group_code,rotation_id,status,created_by)
    values(student,destination.id,destination_group,rotation,'active',p_actor_id)
    on conflict(student_id,curriculum_id) do update set
      group_code=excluded.group_code,rotation_id=excluded.rotation_id,status='active',
      activated_at=statement_timestamp(),completed_at=null,created_by=p_actor_id
    returning id into destination_enrollment;
    insert into public.student_promotion_audit(
      student_id,from_enrollment_id,to_enrollment_id,action,override_used,reason,actor_id,promotion_batch_id
    ) values(
      student,source.id,destination_enrollment,'promote',override_value,override_reason,p_actor_id,batch_id
    );
    promoted := promoted+1;
  end loop;
  return jsonb_build_object('ok',true,'batchId',batch_id,'promotedCount',promoted,'overrideCount',override_total);
end;
$$;
revoke all on function public.admin_promote_student_batch(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admin_promote_student_batch(uuid,uuid,jsonb) to service_role;

create or replace function public.admin_rollback_promotion_batch(
  p_actor_id uuid,p_batch_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare batch public.student_promotion_batches%rowtype; promotion public.student_promotion_audit%rowtype; restored integer:=0;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin' and active=true) then
    raise exception 'Admin authorization required';
  end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Rollback reason is required'; end if;
  select * into batch from public.student_promotion_batches where id=p_batch_id for update;
  if not found or batch.status<>'completed' then raise exception 'Completed promotion batch not found'; end if;
  if exists(
    select 1 from public.student_promotion_audit audit
    join public.year4_logbook_entries entry on entry.enrollment_id=audit.to_enrollment_id
    where audit.promotion_batch_id=p_batch_id and audit.action='promote'
  ) then raise exception 'Cannot rollback batch after any destination logbook entry exists'; end if;

  for promotion in select * from public.student_promotion_audit
    where promotion_batch_id=p_batch_id and action='promote' order by created_at for update
  loop
    update public.student_enrollments set status='archived' where id=promotion.to_enrollment_id;
    update public.student_enrollments set status='active',completed_at=null where id=promotion.from_enrollment_id;
    insert into public.student_promotion_audit(
      student_id,from_enrollment_id,to_enrollment_id,action,reason,actor_id,related_promotion_id,promotion_batch_id
    ) values(
      promotion.student_id,promotion.from_enrollment_id,promotion.to_enrollment_id,'rollback',trim(p_reason),p_actor_id,promotion.id,p_batch_id
    );
    restored:=restored+1;
  end loop;
  update public.student_promotion_batches set
    status='rolled_back',rolled_back_at=statement_timestamp(),rolled_back_by=p_actor_id,rollback_reason=trim(p_reason)
    where id=p_batch_id;
  return jsonb_build_object('ok',true,'batchId',p_batch_id,'restoredCount',restored);
end;
$$;
revoke all on function public.admin_rollback_promotion_batch(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_rollback_promotion_batch(uuid,uuid,text) to service_role;

commit;
