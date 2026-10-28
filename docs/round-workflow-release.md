# Round workflow simplification — 2026-10-28

Sense accepted a single schedule action for QR and seating, scanning throughout the activity with lateness shown separately, automatic end, and an audited Admin path for forgotten scans.

## Behavior

- Primary fields are date and activity start/end. The scan window follows these by default. QR and seat configuration are created in one database transaction. Missing layout fails the entire operation; it cannot leave a QR-only half-success.
- Advanced options retain an explicit QR-only choice and a separate scan window for unusual sessions. An existing seat map cannot be silently disabled. Legacy sessions are not backfilled or rescheduled.
- Existing database check-in time limits remain unchanged. A late scan within the window is accepted; after end it is rejected even without closed_at. The UI no longer asks for a redundant close after end. Early close remains a special action.
- Lateness is displayed against the activity start. Historical configured grace cutoffs are preserved; new default seat cutoff uses the activity start (clamped to a special scan window when necessary). Changing dates/times moves a custom cutoff with the window, while a default follows activity start.
- Admin may add a missing attendance entry with actual arrival time and a 5–300 character reason. Active Resident/Staff only; time must be within the activity, before an early close, and not in the future. Existing entries cannot be overwritten. Audit stores actor, recorded time, actual time, and reason. No direct client/Edge audit writes are granted. Admin-only RLS protects reasons; admin tables/CSV/XLSX/PDF distinguish manual entries from QR.

## Validation

Local PGlite replay retains the four documented legacy/platform exclusions. New SQL suite: 15 assertions including atomic rollback, QR-only, rescheduling, role rejection, late scan, duplicate scan, end cutoff, missing-scan bounds/reason/audit/privileges/RLS. Existing seat-map and RC04 suites run through test:db-grants. Unit and browser results are recorded in C0's handoff; browser uses mocked HTTP, not real Auth.

## Release / rollback

1. Apply only 20261028052905_round_workflow_defaults.sql to staging, run transactional native smoke, then production. No historical SQL is rerun and no existing attendance/session is mutated by the migration.
2. Check effective grants/RLS and exposed RPCs; reload schema cache. Deploy frontend after database entry points exist.
3. Roll back frontend to pre-release if necessary. The additive table/RPCs may safely remain; do not delete the audit table or attendance to roll back. Old RPCs/function bodies remain unchanged.
4. Existing sessions retain their old scan windows. Future rounds created with the new form follow the simplified defaults.
