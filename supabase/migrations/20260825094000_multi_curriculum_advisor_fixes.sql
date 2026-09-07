begin;

drop policy curriculum_activities_admin_write on public.curriculum_activities;
create policy curriculum_activities_admin_insert on public.curriculum_activities for insert to authenticated with check ((select private.is_admin()));
create policy curriculum_activities_admin_update on public.curriculum_activities for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy curriculum_activities_admin_delete on public.curriculum_activities for delete to authenticated using ((select private.is_admin()));

drop policy curriculum_staff_approvers_admin_write on public.curriculum_staff_approvers;
create policy curriculum_staff_approvers_admin_insert on public.curriculum_staff_approvers for insert to authenticated with check ((select private.is_admin()));
create policy curriculum_staff_approvers_admin_update on public.curriculum_staff_approvers for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy curriculum_staff_approvers_admin_delete on public.curriculum_staff_approvers for delete to authenticated using ((select private.is_admin()));

drop policy curriculum_rotations_admin_write on public.curriculum_rotations;
create policy curriculum_rotations_admin_insert on public.curriculum_rotations for insert to authenticated with check ((select private.is_admin()));
create policy curriculum_rotations_admin_update on public.curriculum_rotations for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy curriculum_rotations_admin_delete on public.curriculum_rotations for delete to authenticated using ((select private.is_admin()));

create or replace function public.admin_replace_curriculum_activities(p_curriculum_id uuid,p_activities jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare imported_count integer;
begin
  if not exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin' and active=true) then raise exception 'Admin authorization required'; end if;
  if not exists(select 1 from public.curricula where id=p_curriculum_id and status='draft') then raise exception 'Only draft curriculum can be imported'; end if;
  if jsonb_typeof(p_activities)<>'array' or jsonb_array_length(p_activities)=0 then raise exception 'Curriculum activities are required'; end if;
  delete from public.curriculum_activities where curriculum_id=p_curriculum_id;
  insert into public.curriculum_activities(
    curriculum_id,activity_code,title_th,group_name,target_count,target_unit,sort_order,
    requires_patient,requires_procedure,requires_week,allowed_approver_roles,active
  )
  select p_curriculum_id,trim(row.activity_code),trim(row.title_th),trim(row.group_name),row.target_count,
         coalesce(nullif(trim(row.target_unit),''),'ครั้ง'),row.sort_order,row.requires_patient,
         row.requires_procedure,row.requires_week,array['staff']::text[],true
  from jsonb_to_recordset(p_activities) as row(
    activity_code text,title_th text,group_name text,target_count integer,target_unit text,sort_order integer,
    requires_patient boolean,requires_procedure boolean,requires_week boolean
  );
  get diagnostics imported_count=row_count;
  return jsonb_build_object('ok',true,'importedCount',imported_count);
end;
$$;

commit;
