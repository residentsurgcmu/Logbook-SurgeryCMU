begin;

-- private.handle_new_user() is the single source of truth for new Auth users.
-- This older profile trigger also inserted a Year 4 enrollment after the
-- profile was created, while handle_new_user() inserted the current Year 5
-- enrollment. The two active rows violated student_enrollments_one_active_idx
-- and rolled back every self-service signup.
drop trigger if exists profiles_enroll_new_student on public.profiles;
drop function if exists private.enroll_new_student_if_curriculum_ready();

commit;
