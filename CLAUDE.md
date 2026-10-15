# Resident Surgery EPA/PBA Assessment — notes for Claude

React + Vite front end, Supabase (Postgres + Auth + Edge Functions), hosted on Vercel.
Supabase project ref `dyiiivcyoatgmkmvgcnt`. GitHub: `residentsurgcmu/Logbook-SurgeryCMU`.
See `README.md` for features, local run and secrets.

## Commands
- `npm test` — `node --test tests/*.test.mjs`. Many tests are regex checks on the source
  and SQL files, so renaming code can fail a test that only guards the text.
- `npm run build` — Vite build (chunk-size warning is expected).
- `npm run generate:templates` — regenerate `src/generated/residentTemplates.js` from the
  DOCX files in `EPA/` and `PBA/`. Never edit the generated file by hand.
- No local Postgres or Deno: SQL and edge functions cannot be run locally.

## Production rules (Supabase)
- **Never run `supabase db push`.** The `supabase_migrations` history only records up to
  20260824042343 while the real schema already has later migrations, so a push would
  re-run ~39 old migrations, some destructive.
- Apply a new migration on its own: `supabase db query --linked -f supabase/migrations/<file>.sql`.
  Check the result with a read-only `select` before and after.
- **Every Supabase CLI command must follow these four rules (2026-10-15: skipping them made two migrations
  silently never reach production while the frontend went out, and the output was not seen):**
  1. Use the Homebrew CLI `supabase`, **never `npx --yes supabase`** (npx fetches a newer CLI that cannot read
     `supabase/.temp/linked-project.json` and fails with `ProjectRefNotLinkedError`).
  2. Start with `cd ~/Downloads/Logbook-SurgeryCMU-git &&` (the `!` shell opens in `/Users/chagkrit`, not the repo)
     and always add `--project-ref dyiiivcyoatgmkmvgcnt`:
     `! cd ~/Downloads/Logbook-SurgeryCMU-git && supabase db query --linked --project-ref dyiiivcyoatgmkmvgcnt -f <file>`.
  3. Before the first command of a session, check who and where: `pwd`, `git branch --show-current`,
     `supabase projects list` (the row marked linked must be `dyiiivcyoatgmkmvgcnt`; if it fails, the user runs
     `! supabase login`), and `gh auth status` (active account must be `residentsurgcmu` before any push).
  4. One command per `!` line; never paste several `!` lines in one message. An error is never "applied": after each
     migration run a read-only check (e.g. `select proname, pronargs from pg_proc where proname in (…)`), and only push
     the frontend after the check shows the new objects. `notify pgrst, 'reload schema';` afterwards for new functions.
- **Production writes (2026-10-16, owner's decision): Claude MAY run a migration or function deploy itself**, but
  only the exact file or function the owner named in this session, one at a time, with the four CLI rules above,
  a read-only check before and after (reported in full), and never `db push`. Stop and report on the first error.
  The auto-mode classifier is a separate permission layer and may still block it ("Production Deploy"); that is not
  something to work around: tell the owner, who then runs it with the `!` prefix or adds a permission rule.
- Deploy edge functions with `--no-verify-jwt` (there is no `supabase/config.toml`):
  `supabase functions deploy <name> --project-ref dyiiivcyoatgmkmvgcnt --no-verify-jwt`.
- **Order matters:** migrations → `resident-assessment-notifier` → `auth-send-email-gmail`
  → frontend. A new frontend or function that expects a migration must not go out first.
  Vercel deploys automatically on push to `main`, so run the migration before pushing.

## Design decisions
- **Criteria are immutable once created.** Signed assessments point at a
  `resident_template_criteria` row by id. `syncSourceTemplates` (`src/residentApi.js`) uses
  `planCriteriaSync` (`src/criteriaSync.js`): a changed or moved criterion is retired
  (`active = false`, text and scores kept) and re-created as a new active row under the same
  `C{n}` code; nothing is edited in place. Codes are still positional (`C{row}`), so inserting
  a criterion mid-document retires and re-creates every later one. Code and `sort_order` are
  unique among **active** rows only (migration `20260929110000`).
- The signed-assessment history view lists only criteria that have a score on that assessment.
- Residents never see Staff emails: party RLS on `resident_profiles` is one-way
  (Staff → Resident); Residents get Staff names through `list_resident_counterpart_staff()`.
- Email delivery is claimed atomically (`claim_resident_assessment_email_delivery`); pending
  requests can be cancelled with `cancel_resident_assessment_request`.

## Status log
- 2026-09-29: code-review fixes (notifications, email claim, cancel request, Staff-email
  privacy, QR/exam/round races) merged and deployed: migrations `20260929090000` and
  `20260929100000` applied; notifier v5, auth-send-email-gmail v3.
- 2026-09-29: positional criterion codes fixed (retire-and-recreate sync,
  `20260929110000_criteria_unique_active_only.sql`, history-view filter, 12 tests).
- 2026-10-01 (branch `fix/qr-round-multi-session-2026-10-01`, **merged to main as 6b60f46 and deployed on Vercel 2026-10-01; migration applied + verified**):
  QR bug notes 29-9-69/30-9-69. Several MM/Grand Round sessions per date (no overlapping scan
  windows), soft-cancel (`cancel_resident_round_session`, only with 0 attendance), optional
  activity time shown in reports/filenames, all of today's+upcoming sessions listed with a status
  chip, Staff scanner opens the rear camera directly (headless `Html5Qrcode`). Migration
  `20261001090000_round_multi_session_cancel_activity_time.sql` is live (checked with
  `tests/round-attendance-db.sql`); remaining: click-through on the live site and an iPhone scan test.
- 2026-10-02: New admissions + ประชุมวันศุกร์ (phase 1) **deployed** (PR #1 merged as 34ceaab, Vercel success; migration applied first).
  Migration `20261002090000_resident_admission_cases.sql` adds `resident_admission_cases`, `resident_case_media`,
  `resident_case_notes`, private bucket `resident-case-media`; SELECT-only RLS, every write is a SECURITY DEFINER RPC
  with an `updated_at` optimistic check (`CASE_CONFLICT`). Verified with
  `tests/resident-cases-db.sql` and `tests/resident-cases-rls-rollback.sql`. Spec/plan in `docs/superpowers/`.
- 2026-10-02 (PR #2 merged as 7354a56, **deployed**; migration applied first): units → Upper GI, Colorectal, HPB, B&E, Vascular
  (migration `20261002120000_resident_case_units.sql`, deletes test case ADM-00002 — run BEFORE the frontend); image
  picking in the case form + visible upload button (phase-1 upload was undiscoverable, no storage request was ever made);
  PowerPoint export per case and per week (`src/casePptx.js`, pptxgenjs lazy-loaded); user name in the header.
  `package.json` "latest" deps pinned to the lockfile versions so adding pptxgenjs did not upgrade React/Vite.
- 2026-10-02 (PR #3 merged as bf901db, **deployed**): sidebar shell (grouped nav in `src/navGroups.js`, glass sidebar + top bar,
  phone drawer; page content unchanged, records stay on opaque panels) and Excel export of admissions by admit-date
  range (`src/caseExcel.js` + `src/caseExcelExport.js`, exceljs lazy-loaded). No migration needed.
- 2026-10-03 (branch `feat/case-clinical-fields`, **not yet deployed**): present illness, vital signs (separate numeric
  columns with CHECK ranges), physical examination; Admin permanent image delete (`admin_purge_resident_case_media`).
  Migration `20261003090000_resident_case_clinical_fields.sql` is backward compatible (new RPC params have defaults;
  `p_set_clinical` stops an old browser tab from wiping clinical fields on edit). Shown in detail, conference, PPTX, Excel.
- 2026-10-04 (PR #5 `feat/ui-refresh-phase1-2`, no migration): UI refresh phases 1-2. Phase 1: `src/tokens.css`
  is the single token source (legacy `--wine`/`--resident-*` alias it); Noto Sans Thai now actually loads (`@font-face` + preload);
  one green 3px focus ring (purple ring removed); glass removed from controls/sidebar (only the sticky top bar keeps a blur); legacy
  `.resident-app nav` top-tab rules deleted. Phase 2: role-specific home (queue + one primary action), `pendingQueue`/`stalePending`/
  `coverage` in `buildDashboard`, menu badges instead of "(n)" in labels, phone bottom bar (`BOTTOM_NAV` in `navGroups.js`).
  The old "%" was completed/(completed+pending); it is now labelled as completion rate for Staff/Admin. Residents see progress against the
  department target of 2 assessments per EPA/PBA form (`TARGET_ASSESSMENTS_PER_FORM`; counted per form up to 2). Assumed the same target
  for every PGY and every form — change the constant if that differs.

- 2026-10-07 (PR #6 `feat/resident-corner`, merged 8ff1bd2, **deployed**; database files run first, one at a time): case **Type**
  (Conservative/Operative) required on create/update (`create_/update_resident_admission_case_with_type`, `set_resident_case_treatment_type`;
  a lock file then closed the old create function to browsers); unit **Trauma**; Friday-conference agenda saved permanently
  (`resident_conference_sessions`, `save_/reset_resident_conference_agenda`, `add_resident_conference_note`, PowerPoint); the schedule/OR page embeds
  two outside pages whose addresses an Admin sets (`resident_embed_links`, `set_/clear_resident_embed_link`); assessor name on results.
- 2026-10-07 (PR #7 `fix/deck-image-fit`, merged 19071e0, no migration): Deck pictures scale to fit their frame (`.case-present-image` is the
  positioning box; before, tall pictures were cut off). Checked in a headless browser at phone and desktop widths.
- 2026-10-07 (PR #8 `feat/rules-epa-pba`, merged 62c9012, **deployed**; migration `20261007090000_epa_pba_attempt_rules.sql` first): EPA 1-6: one request
  per form per academic year (starts 1 July, Bangkok time) and 3 attempts in total; EPA 7 forms 1 each; EPA 8 unlimited and not counted for the board; PBA
  topics never repeat; "reached the level" = every criterion of ONE assessment at L4/L5 (M/E for EPA 7). Staff can declare "unavailable until"
  (`resident_staff_availability`); an Admin can grant extra attempts with a reason (`resident_attempt_grants`, raises only the total limit);
  `get_my_epa_progress()`; rules in `src/residentAssessmentRules.js`; who may grant is one named function (`private.resident_can_grant_extra_attempts()`).
- 2026-10-07 (PR #9 `feat/admin-pages`, merged 1137bd2, **deployed**; migration `20261008090000_admin_attempt_pages.sql` first): Admin screen got
  "เพิ่มครั้งการประเมิน" (pick Resident + form + reason, confirm, history) and "ดึงข้อมูลความคืบหน้า" (Excel: อ่านก่อน / EPA / PBA; no scores, no assessor
  names). `admin_list_attempt_grants`, `admin_list_epa_pba_progress`, optional label `resident_user_roles.admin_tag` ("Admin หลัก (F)" / "Admin รอง (N)"; no
  extra rights), who may see everybody's progress is `private.resident_can_view_cohort_progress()`. Screens were written by a second AI from a spec and
  reviewed here (database function output was fed through the Excel builder and compared cell by cell).
- 2026-10-11 (PR #10 `fix/checkin-spelling`, merged 678a2a8, no migration): "เช็กชื่อ" -> "เช็คชื่อ" in src, tests and scripts (old docs left as history).
- 2026-10-11 e-mail: assessment notices (Edge Function secret `SMTP_PASS`) and invite / password reset (Supabase Auth custom SMTP; no Send Email Hook is
  configured, so `auth-send-email-gmail` is not used) are delivered. The Gmail app password is used in TWO places; if it is replaced, change both.
  `00d` health check reads `resident_assessment_email_deliveries`.
- Release practice since 2026-10-07: one piece per release; the database file first (state check before, the same checks again before COMMIT so a
  failure rolls everything back), then merge with "Create a merge commit", then a click-through with test accounts. Rollback files were tested for the lock,
  the rules and the Admin pages. The release SQL files are wrappers around the migrations and are kept outside git; copies are with the project owner.
  `npm test` (267 tests) still does not run SQL: the behaviour suite `tests/resident-attempt-rules-behavior.sql` (101 checks) was run on a throwaway local
  PostgreSQL 16 with a small Supabase stand-in, and each release file was also run on the staging project before production.
- 2026-10-15: seat map 3D view phase 1 (view only, all roles, lazy `three` chunk, no migration, room size = constants in `src/seatMap3d.js`) is **DEPLOYED** (PR #15 + #16). Read `docs/handoff.md` (3D section). **Vercel installs with pnpm and a frozen `pnpm-lock.yaml`: every dependency change must also update it (`npx pnpm@10 install --lockfile-only`), or the deploy fails in seconds.** Also deployed 2026-10-15: PR #17 (2D phone overflow fix) and PR #18 (moderator now has 2 seats M1/M2, either may stay empty; production SQL `12-second-moderator.sql` already applied, layout is now "(38 ที่)"). The seat-map SQL was NOT on production at the first deploy and was applied afterwards (verified).
- 2026-10-15 (merged to main as 2290f0f, frontend deployed): exam scores + MPL with automatic pass / not pass. Migrations 20261015100000 then 20261015110000 (own queries, never db push); legacy exam RPCs untouched, exams before this are scoring_mode 'manual'; read docs/superpowers/specs/2026-10-15-exam-mpl-design.md and docs/staging-rehearsal.md (Exam MPL). **The migrations were first NOT on production** (the `npx` command failed unseen, frontend went out first, "สร้าง Draft" showed "function not found"); applied afterwards and verified read-only (4 functions in `pg_proc`, schema cache reloaded). Live click-through by the owner still pending. Hence the Supabase CLI rules above.

## Still open (owner: Chagkrit unless stated)
- Done: sign-up disabled; real e-mail delivery confirmed on 2026-10-11 (invite, password reset, assessor notice).
- **PDPA / public repository:** the repository is public and old migration history contains real names and e-mail addresses (including an older
  year-4 project's). Decide: make the repository private (check Vercel still deploys), purge git history, or ask the faculty PDPA officer.
- Create the real Admin officer accounts (owner: Sense), then run `set-admin-tags.sql` (label only). Run the one-time test-data wipe
  (`10-reset-test-data-DANGER-IRREVERSIBLE.sql`, outside git, needs today's date in its confirm line) right before real use, and delete the test
  accounts by hand in Authentication -> Users (the script does not delete accounts).
- Real-phone checks (iPhone found: the Staff "unavailable until" card overlapped on iOS - CSS fix prepared, to be confirmed on a phone; the Staff queue
  table and the scoring matrix need sideways scrolling, so the criterion names disappear while choosing a level). Mobile redesign (queue as cards, collapsible
  criteria with the criterion text beside the level buttons) is being designed first.
- In progress / not started: "My space" for Residents (spec with the second AI); academic calendar (in stages); seat-map check-in (read-only first).
- Clean-up to decide: unused Edge Function `auth-send-email-gmail` and its leftover fallback sender address; Admin guide for the office staff.
- Not yet decided by the department: recognition / rewards / ranking (kept out of the system until a policy exists).

## Not in git
Private rosters, `*.xlsx`, `Staff.docx`, `data/`, `.env*`, `.vercel/` are git-ignored on purpose.
