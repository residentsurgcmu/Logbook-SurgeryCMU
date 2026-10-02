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
- Production writes (migrations, function deploys) are blocked for Claude by the auto-mode
  classifier. The user runs them with the `!` prefix; Claude verifies read-only.
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
- 2026-10-02 (branch `feat/cases-round2`, **not yet deployed**): units → Upper GI, Colorectal, HPB, B&E, Vascular
  (migration `20261002120000_resident_case_units.sql`, deletes test case ADM-00002 — run BEFORE the frontend); image
  picking in the case form + visible upload button (phase-1 upload was undiscoverable, no storage request was ever made);
  PowerPoint export per case and per week (`src/casePptx.js`, pptxgenjs lazy-loaded); user name in the header.
  `package.json` "latest" deps pinned to the lockfile versions so adding pptxgenjs did not upgrade React/Vite.

## Still open (owner: Chagkrit)
- Supabase Auth: disable sign-up, or turn on Confirm email.
- Send one real assessment request to confirm the email reaches Staff, and that a Resident's
  history shows Staff names.

## Not in git
Private rosters, `*.xlsx`, `Staff.docx`, `data/`, `.env*`, `.vercel/` are git-ignored on purpose.
