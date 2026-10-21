# Data API grant cutover — RC preparation

Date: 2026-10-21 (Asia/Bangkok). Base: `5f470127d2af56481c909faecd570a76a498682b`.

Supabase stops automatically granting Data API access to newly created public
tables on 2026-10-30. Existing tables retain their grants. Official references:

- https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
- https://supabase.com/docs/guides/api/securing-your-api

## Result and scope

Both existing RC projects passed the read-only capability matrix: **48/48**.
No production grants, defaults, policies, functions, application data, Auth,
Storage, Edge Functions or frontend deployment were changed in this task.

Two historical creation migrations now explicitly declare the missing access
needed when building RC with automatic table/sequence grants absent:

| Consumer | Tables | Explicit access added |
| --- | --- | --- |
| Browser, constrained by existing RLS | resident_user_roles, resident_profiles, resident_template_definitions, resident_template_criteria, resident_evaluator_assignments, resident_assessments, resident_assessment_scores | SELECT |
| Admin template sync / assignment upsert, constrained by existing RLS | resident_template_definitions, resident_template_criteria, resident_evaluator_assignments | INSERT, UPDATE |
| resident-admin / notifier Edge readers | resident_user_roles, resident_profiles, resident_template_definitions, resident_staff_directory | service_role SELECT |

The notifier's request/notification/delivery table grants already exist in their
creation migration. Other current browser table reads already have explicit
grants. No blanket grant, new anonymous access, direct account write grant, or
RC-04 internal-table grant has been introduced. Scores and rules are unchanged.

## Existing projects: no migration to apply

The edits to historical files are **rebuild corrections**, not a deployment
script. Do NOT rerun either historical migration on staging/production: they
contain original bootstrap and seed operations. Do NOT run `supabase db push`,
reset a populated database, or repair migration history as part of this task.
No new production migration is needed because the required current capabilities
are already present, as verified by the read-only matrix.

`supabase/manual/data_api_grants_check.sql` can be run read-only before/after
future releases. Expect exactly 48 rows and every `ok` to be true. SQL errors,
missing rows or null/false checks fail acceptance. This is a selected capability
check, not an exhaustive security audit or a replacement for real JWT tests.

For every future public table: put the needed role grants/revokes, RLS and
policies in its creation migration, and extend the capability/behavior checks
for its consumers. An RLS policy does not supply a table grant. A service-role
key bypasses RLS but still needs a table grant. Internal tables may intentionally
have no client grant and be used only through guarded RPCs. Do not blindly apply
the GRANT hint from a denied internal-table request. Function privileges are a
separate concern and their defaults were not changed here.

## Verification performed

- `npm test`: **528/528**, exit 0 with complete summary.
- `npm run build`: passed, existing chunk-size warning.
- `git diff --check`: passed.
- `npm run test:db-grants`: fresh in-memory PGlite 0.5.10 / PostgreSQL 18.6,
  no automatic public table or sequence grants; 74 migration files replayed.
  Capability matrix 48/48; synthetic Admin template insert/update/read,
  Resident own-profile RLS/read, forbidden Resident template/account/internal
  score operations, and Edge reader/delivery capabilities passed.
- Existing RC-04 behavior and B002 suites completed without SQL errors in that
  engine. For behavior T18k/l/n/o ONLY, the runner adds explicit legacy service
  event SELECT/UPDATE/DELETE and result INSERT grants inside the suite's rolled
  back transaction to reach its defense-in-depth triggers. These grants are NOT
  part of migrations or the preceding no-default capability matrix. No RC-04
  internal grant is added. No native multi-session concurrency/JWT claim is made.
- Negative control: `node scripts/test-data-api-grants.mjs
  --baseline-ref=5f470127d2af56481c909faecd570a76a498682b` exits 1 on the unfixed
  baseline at missing authenticated SELECT on resident_assessment_scores.
- Connected staging PostgreSQL 17: transactional cutover probe passed new-table
  default denial, explicit SELECT and ungranted INSERT rejection. The entire
  probe rolled back. Before/after fingerprints of existing table/sequence ACLs
  and RLS, column ACLs, default ACLs, public/private functions and public policies
  match; the probe table is absent afterward. No existing application row was
  read or written by this probe. This is SQL-role evidence, not live JWT/HTTP.
- Supabase Security Advisor was inspected for both projects. No changes were
  made just to suppress warnings: intentional internal no-policy tables and
  guarded SECURITY DEFINER RPCs remain as designed. Pre-existing extension and
  password-protection notices are outside this grant-cutover change.

## Rebuild limitations (not a clean db-reset certification)

The offline runner explicitly excludes these files; it never silently ignores
SQL errors in another file:

| File | Reason |
| --- | --- |
| 20260825030857_start_year5_2569_and_staff_management.sql | Retired Year 5 seed references curricula before that table is created in chronological repository order |
| 20260825094000_multi_curriculum_advisor_fixes.sql | Retired advisor change drops a policy absent from preceding repository migrations |
| 20260909123956_schedule_resident_web_reminders.sql | Platform pg_cron extension/scheduling |
| 20260928130000_schedule_assessment_email_delivery.sql | Platform Vault/cron/network setup; never execute external email jobs offline |

The stand-in explicitly supplies auth/storage structures and the historical
`private.touch_updated_at()` helper, which is referenced but never created in
the repository migration history. It does not model real Auth, Storage or cron.
Therefore this proves current RC grants under the new defaults in the stated
fixture; it does NOT certify that an unmodified `supabase db reset` or a preview
branch can recreate the entire legacy project. Repairing/rebaselining that old
history is separate work and must use a disposable database with reviewed
snapshot/schema evidence. Current existing projects do not need a reset for the
October 30 change.
