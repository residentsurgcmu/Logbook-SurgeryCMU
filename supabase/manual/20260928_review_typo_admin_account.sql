-- Review the admin role granted by migration 20260921033316 to
-- 'resident.surgerycmu@gmail.com' (likely a typo of resident.surgcmu@gmail.com).
-- Run step 1 first. Only run step 2 if that account is NOT one you use.

-- 1) Preview: who holds resident admin, and does the typo account exist?
select u.email, r.role, r.active,
       u.email_confirmed_at is not null as email_confirmed,
       u.created_at::date as created, u.last_sign_in_at::date as last_login
from public.resident_user_roles r
join auth.users u on u.id = r.user_id
where r.role = 'admin' or lower(u.email) = 'resident.surgerycmu@gmail.com'
order by u.email;

-- 2) Deactivate the typo account's resident role (keeps the row for audit).
-- update public.resident_user_roles r
-- set active = false
-- from auth.users u
-- where u.id = r.user_id
--   and lower(u.email) = 'resident.surgerycmu@gmail.com'
-- returning u.email, r.role, r.active;
