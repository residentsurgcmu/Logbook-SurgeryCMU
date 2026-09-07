create or replace function private.validate_year4_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  definition public.year4_activity_definitions%rowtype;
  staff_name text;
begin
  if new.status = 'draft' then
    new.submitted_at = null;
    new.approved_at = null;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'submitted' then
      new.submitted_at = statement_timestamp();
    end if;
  elsif tg_op = 'UPDATE' then
    if new.status = 'submitted' and old.status is distinct from 'submitted' then
      new.submitted_at = statement_timestamp();
    end if;
    if new.status = 'approved' and old.status is distinct from 'approved' then
      new.approved_at = statement_timestamp();
    end if;
  end if;

  select * into definition
  from public.year4_activity_definitions
  where id = new.activity_type and active = true;
  if not found then
    raise exception 'Activity definition is not active';
  end if;

  select full_name into staff_name
  from public.profiles
  where id = new.selected_approver_id and role = 'staff' and active = true;
  if staff_name is null then
    raise exception 'Selected approver must be an active Staff account';
  end if;
  if nullif(trim(new.detail), '') is null then
    raise exception 'Activity detail is required before submission';
  end if;
  if definition.requires_week and new.week_number is null then
    raise exception 'Week number is required for this activity';
  end if;
  if definition.requires_patient and nullif(trim(new.patient_reference), '') is null then
    raise exception 'Patient reference is required for this activity';
  end if;
  if definition.requires_procedure and nullif(trim(new.procedure_name), '') is null then
    raise exception 'Procedure is required for this activity';
  end if;

  new.supervisor_name = staff_name;
  return new;
end;
$$;

revoke all on function private.validate_year4_submission() from public, anon, authenticated;

