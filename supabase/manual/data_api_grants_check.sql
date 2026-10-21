-- Read-only release check. One row per required capability plus closed paths.
-- Missing objects fail too. Do not interpret a permission error as a request
-- for schema-wide GRANT: RC-02/RC-04 deliberately use guarded RPCs.
with required(role_name, table_name, privileges) as (values
  ('authenticated','resident_user_roles','SELECT'),
  ('authenticated','resident_profiles','SELECT'),
  ('authenticated','resident_template_definitions','SELECT,INSERT,UPDATE'),
  ('authenticated','resident_template_criteria','SELECT,INSERT,UPDATE'),
  ('authenticated','resident_evaluator_assignments','SELECT,INSERT,UPDATE'),
  ('authenticated','resident_assessments','SELECT'),
  ('authenticated','resident_assessment_scores','SELECT'),
  ('authenticated','resident_assessment_requests','SELECT'),
  ('authenticated','resident_notifications','SELECT'),
  ('authenticated','resident_self_assessment_scores','SELECT'),
  ('authenticated','resident_round_sessions','SELECT'),
  ('authenticated','resident_round_attendance','SELECT'),
  ('authenticated','resident_round_cme_qr','SELECT'),
  ('authenticated','resident_exam_events','SELECT'),
  ('authenticated','resident_exam_participants','SELECT'),
  ('authenticated','resident_exam_parts','SELECT'),
  ('authenticated','resident_exam_results','SELECT'),
  ('authenticated','resident_exam_standards','SELECT'),
  ('authenticated','resident_exam_standard_mpl','SELECT'),
  ('authenticated','resident_exam_mpl','SELECT'),
  ('authenticated','resident_admission_cases','SELECT'),
  ('authenticated','resident_case_media','SELECT'),
  ('authenticated','resident_case_notes','SELECT'),
  ('authenticated','resident_conference_sessions','SELECT'),
  ('authenticated','resident_embed_links','SELECT'),
  ('authenticated','resident_room_layouts','SELECT'),
  ('authenticated','resident_room_seats','SELECT'),
  ('service_role','resident_user_roles','SELECT'),
  ('service_role','resident_profiles','SELECT'),
  ('service_role','resident_template_definitions','SELECT'),
  ('service_role','resident_staff_directory','SELECT'),
  ('service_role','resident_assessment_requests','SELECT'),
  ('service_role','resident_notifications','SELECT,INSERT,UPDATE'),
  ('service_role','resident_assessment_email_deliveries','SELECT,UPDATE')
), required_checks as (
  select 'required ' || role_name || ' ' || table_name || ' ' || privileges as check_name,
    coalesce((select bool_and(has_table_privilege(role_name, to_regclass('public.' || table_name), p))
      from unnest(string_to_array(privileges, ',')) as p), false)
      and coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.' || table_name)), false) as ok
  from required
), rc04_tables(name) as (values
  ('rc04_exam_revisions'),('rc04_revision_parts'),('rc04_revision_mpl'),
  ('rc04_revision_participants'),('rc04_revision_results'),('rc04_import_previews'),
  ('rc04_import_batches'),('rc04_request_receipts'),('rc04_audit'),('rc04_read_manifests')
), clients(role_name) as (values ('anon'),('authenticated'),('authenticator'),('service_role')),
closed_checks as (
  select 'closed all client table/column privileges ' || t.name as check_name,
    coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.' || t.name)), false)
    and not exists (
      select 1 from clients c cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
      where has_table_privilege(c.role_name, to_regclass('public.' || t.name), p)
    ) and not exists (
      select 1 from clients c cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p
      join pg_attribute a on a.attrelid = to_regclass('public.' || t.name) and a.attnum > 0 and not a.attisdropped
      where has_column_privilege(c.role_name, a.attrelid, a.attnum, p)
    ) as ok
  from rc04_tables t
), accounts(name) as (values ('resident_profiles'),('resident_user_roles'))
select * from required_checks
union all select * from closed_checks
union all
select 'closed authenticated account writes ' || a.name,
  to_regclass('public.' || a.name) is not null and not exists (
    select 1 from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p
    where has_table_privilege('authenticated', to_regclass('public.' || a.name), p)
  ) and not exists (
    select 1 from pg_attribute c cross join unnest(array['INSERT','UPDATE']) p
    where c.attrelid = to_regclass('public.' || a.name) and c.attnum > 0 and not c.attisdropped
      and has_column_privilege('authenticated', c.attrelid, c.attnum, p)
  ) from accounts a
union all
select 'notification read_at UPDATE available', coalesce(has_column_privilege('authenticated', to_regclass('public.resident_notifications'), 'read_at', 'UPDATE'), false)
union all
select 'notification other columns not writable', not exists (
  select 1 from pg_attribute a where a.attrelid = to_regclass('public.resident_notifications')
    and a.attnum > 0 and not a.attisdropped and a.attname <> 'read_at'
    and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
)
order by check_name;
