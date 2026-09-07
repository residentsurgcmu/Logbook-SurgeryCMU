insert into public.user_directory (email, full_name, role, active)
values ('obuea.homchan@cmu.ac.th', 'obuea.homchan@cmu.ac.th', 'staff', true)
on conflict (email) do update set
  full_name = excluded.full_name,
  role = 'staff',
  active = true;
