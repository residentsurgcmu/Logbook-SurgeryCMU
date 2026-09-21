-- The verified Resident Surgery owner account is an existing Auth user. Keep
-- its application role and profile active so it can administer attendance.
insert into public.resident_user_roles (user_id, role, active)
select id, 'admin'::public.resident_system_role, true
from auth.users
where lower(email) = 'resident.surgcmu@gmail.com'
on conflict (user_id) do update
set role = excluded.role, active = true, updated_at = clock_timestamp();

update public.resident_profiles p
set email = lower(u.email), active = true, updated_at = clock_timestamp()
from auth.users u
where p.user_id = u.id
  and lower(u.email) = 'resident.surgcmu@gmail.com';
