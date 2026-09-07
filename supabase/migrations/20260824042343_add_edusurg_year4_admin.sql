begin;

insert into public.user_directory (email, full_name, role, active)
values ('edusurgcmu@gmail.com', 'Surgery CMU Year 4 Admin', 'admin', true)
on conflict (email) do update set
  full_name = excluded.full_name,
  role = excluded.role,
  active = true;

commit;
