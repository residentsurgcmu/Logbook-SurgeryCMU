# Exam scores + MPL (minimum passing level) with automatic pass/fail — design

Date: 2026-10-15. Status: draft for owner review. No names or e-mail addresses (public repository).

## Purpose
Extend the existing exam tab (`src/features/ResidentExams.jsx`, `resident_exam_*` tables). Today the Admin picks "ผ่าน / ต้องซ่อม" by hand for every cell; only MCQ has a score and X-ray & Anatomy parts have none. The Admin wants to enter a **score per Resident for every part**, set the **MPL per part per PGY (1-4)**, and have the system decide pass / not pass automatically and show it beside the score.

## Success criteria
1. Admin enters a numeric score for every part (MCQ counts as one part); no manual outcome choice for new exams.
2. MPL is set once per exam type + part name + PGY in a central table, copied (snapshot) onto each new exam, and editable for that exam while it is a draft.
3. Outcome = `pass` when score >= MPL of the Resident's PGY **at exam time**, else `remediation`; no MPL for that PGY -> no outcome ("ยังไม่ตั้งเกณฑ์"), never silently pass or fail.
4. Published results never change when the central table changes or a Resident is promoted.
5. Exams created before this change keep working exactly as today (manual outcome).
6. Staff can filter published results by pass / not pass in addition to the existing PGY and Resident filters.

## Decisions (owner, 2026-10-15)
- MPL scope: central standards table + per-exam snapshot (option B).
- Scores: numeric per part with a max score per part (option A); same format rule as today (non-negative, up to 2 decimals, not above max).
- Pass rule: score >= MPL. PGY without MPL -> "ยังไม่ตั้งเกณฑ์".
- Legacy results (outcome only, no score) are kept as manual results and are not converted.
- Outcome is computed in the database at save time, not in the browser.

## Data model (one new migration, applied on its own; never `db push`)
| Object | Change |
|---|---|
| `resident_exam_standards` (new) | `id`, `exam_type`, `part_name`, `max_score`; unique on `(exam_type, lower(part_name))`. MCQ has one row with a fixed part name. |
| `resident_exam_standard_mpl` (new) | `standard_id`, `pgy` (1-4), `mpl`; unique `(standard_id, pgy)`; `0 <= mpl <= max_score`. |
| `resident_exam_events` | add `scoring_mode` (`manual` / `mpl`); column default `manual` (existing rows stay `manual`); `create_resident_exam_event_mpl` sets `mpl`. |
| `resident_exam_parts` | add `max_score` (copied at creation). |
| `resident_exam_mpl` (new) | snapshot: `event_id`, `part_id` (null for MCQ), `pgy`, `mpl`. |
| `resident_exam_participants` | add `pgy_at_exam`, set at creation from the Resident's current PGY; existing rows backfilled from current PGY. |
| `resident_exam_results` | `score` used for every part; `outcome` becomes nullable; add `outcome_source` (`computed` / `manual`), existing rows `manual`. |

## Server behaviour
- The legacy `create_resident_exam_event` and `save_resident_exam_results` stay unchanged and keep serving `manual` exams (old browser tabs keep working). A trigger on `resident_exam_results` rejects any non-`computed` outcome on an `mpl` exam, so the legacy save cannot bypass the rule.
- `create_resident_exam_event_mpl`: the browser sends the parts, full scores and MPL (pre-filled from the standards, editable for this exam only); the server reuses the legacy validation, sets `scoring_mode = 'mpl'`, locks `pgy_at_exam`, stores part full scores and the MPL snapshot, and validates `0 <= MPL <= full score`.
- `save_resident_exam_scores(event_id, results[{residentId, partId, score}])`: caller is Admin; event is `mpl` and draft; participant belongs to the event; score format and `score <= part max`; the client never sends an outcome, the server sets it from the snapshot MPL for `(event, part, pgy_at_exam)`; a blank score is not stored.
- `update_resident_exam_mpl(event_id, rows)`: draft only; validates `0 <= mpl <= part max`; rewrites the snapshot and recomputes every outcome of the event in the same transaction.
- `save_resident_exam_standards(rows)`: Admin only; replaces the central table.
- `list_resident_exam_records` adds `part_max_score`, `mpl`, `pgy_at_exam`, `scoring_mode`, `outcome_source`; Residents still receive only their own rows.

## Permissions (RLS)
- Standards tables: Admin write, Staff and Admin read, Resident none.
- Snapshot `resident_exam_mpl`: a Resident reads it only for a published event they took part in; reuse `private.resident_exam_is_published` and `private.resident_is_exam_participant` (migration `20260928120000`) to avoid the earlier RLS recursion.

## Screens
- **Admin:** new sub-tab "เกณฑ์ MPL" (table part x PGY1-4 plus max score). Create-exam form pulls parts, max score and MPL from the standards and lets the Admin change them for this exam only. Score grid: one number input per cell with a live pass / not pass badge (browser preview only; the stored value comes from the server). Legacy `manual` exams keep the current dropdown.
- **Resident / Staff (published):** each part shows `score / max`, the MPL, and a pass / not pass badge; a manual legacy cell shows its outcome only. Staff gets an extra filter "ผล: ทั้งหมด / ผ่าน / ไม่ผ่าน".

## Errors (Thai, naming the person and part)
Score format or above max (`examScoreError`, now with a per-part max); MPL not a number or outside `0..max`; before publish, a warning with the number of cells that have no MPL (does not block).

## Testing and rollout
- Pure function `examOutcome(score, mpl)` tested with `node --test`: equal to MPL passes, 0.01 below fails, no MPL gives empty, above max errors.
- Regex tests on the SQL and source in the repo style: RPC does not take `outcome` for `mpl` exams, snapshot exists, `pgy_at_exam` set, legacy rows backfilled `manual`.
- `tests/resident-exam-mpl-rollback.sql` (always rolls back) is run on staging after both migrations.
- SQL cannot run locally: add a rehearsal section to `docs/staging-rehearsal.md` and run on staging first.
- Order: migration (own `supabase db query --linked -f`), then frontend push. Production writes are run by the owner; Claude verifies read-only.

## Out of scope
MPL versions by academic year, Excel export of exam results, notifying a Resident who did not pass.

## Assumptions to confirm
- Real PGY-1..4 are the only levels needed (no PGY 5).
- The MCQ max score currently on the event stays the source for MCQ max; the standards row supplies its default.
