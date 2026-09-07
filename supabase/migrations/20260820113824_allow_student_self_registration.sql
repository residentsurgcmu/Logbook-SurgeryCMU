-- Staff authorization remains directory-controlled. Any new email that is not
-- in the directory is provisioned only as a Student, so user-editable metadata
-- is never trusted to grant an elevated role.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  directory_entry public.user_directory%rowtype;
  submitted_name text;
  submitted_code text;
begin
  select * into directory_entry
  from public.user_directory
  where email = lower(new.email) and active = true;

  if found then
    insert into public.profiles (
      id, email, full_name, role, active, student_code, cohort_year
    ) values (
      new.id,
      directory_entry.email,
      directory_entry.full_name,
      directory_entry.role,
      true,
      directory_entry.student_code,
      directory_entry.cohort_year
    );
    return new;
  end if;

  submitted_name := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');
  submitted_code := nullif(trim(new.raw_user_meta_data ->> 'student_code'), '');

  if submitted_name is null then
    raise exception 'Student full name is required';
  end if;
  if submitted_code is null or submitted_code !~ '^[0-9]{6,20}$' then
    raise exception 'Student code must contain 6 to 20 digits';
  end if;

  insert into public.profiles (
    id, email, full_name, role, active, student_code, cohort_year
  ) values (
    new.id,
    lower(new.email),
    submitted_name,
    'student',
    true,
    submitted_code,
    coalesce(nullif(new.raw_user_meta_data ->> 'cohort_year', '')::integer, 2568)
  );
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
