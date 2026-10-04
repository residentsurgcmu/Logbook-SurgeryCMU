# Staging rehearsal — 2026-10-03

Branch: review/staging-rehearsal. Base: feat/resident-corner-shell at 04b83fc.

Applied supplied remove-clinical-fields.patch and allow-staging-project.patch without conflicts. Homepage breadcrumb now renders Resident Corner once; other pages retain the page suffix.

## Verification

- npm test: 192 passed, 0 failed.
- npm run build: passed both before and after local staging configuration; existing large-chunk warning remains.
- npm run dev: started on localhost port 5174 for browser testing.
- Only localhost and the user-designated staging hostname were allowed in the browser network route. No production requests, pushes or deployments.
- .env.local contains only VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_ALLOWED_STAGING_PROJECT_REF; ignored by git, never staged. Values deliberately omitted.

| Role | Login | Homepage | Create | Persisted after reload |
|---|---|---|---|---|
| resident | Passed | เริ่มวันทำงานของคุณ | HTTP 200 | True |
| staff | Passed | งานสอนและการประเมิน | HTTP 200 | True |
| admin | Passed | ดูแลพื้นที่ทำงานของภาควิชา | HTTP 200 | True |

## Test records left in staging

Three fictional cases remain for review; no patient data. Staff/Admin selected the test Resident as owner.
- STAGING-REHEARSAL-resident-20261003-1791043771168
- STAGING-REHEARSAL-staff-20261003-1791043821876
- STAGING-REHEARSAL-admin-20261003-1791043826513

## Errors and limits

- First browser attempt hit an environment TLS certificate verification error and a browser process failure. Retried with ignoreHTTPSErrors in the test browser only and removed its single-process launch flag. No application TLS setting was changed. Certificate validation was therefore not a passing test.
- Early automation could not resolve the Owner label and read its value before options loaded. Corrected selector and waited for options; no duplicate Resident case was created. These were test-harness failures.
- Final successful run: no page errors, HTTP errors or blocked-host attempts for all three roles.
- Tests cover sign-in, role homepage, breadcrumb and synthetic case creation/reload. They do not prove all RLS rules, assessment workflows, QR camera behavior or notifications.

## Existing modified PBA file — preserved

Original worktree logbook-review remains untouched. PBA/2.การประเมินหัตถการ Appendectomy.docx: committed size 2,576,994 bytes; working size 1,667,584 bytes. Last filesystem modification: 2026-10-03 22:23:41.225055 Asia/Bangkok.

Working file is an exact byte prefix of the committed file, missing 909,410 trailing bytes and its ZIP end directory; Python cannot open it as a DOCX ZIP. The file command still recognizes its initial Word signature. This supports truncation, not an identifiable text edit. No filesystem audit identifies the responsible program or person. The committed original reports Microsoft Office Word 16 in metadata, but that is not evidence of what truncated the working file. Do not restore until the owner decides.

No migrations, schema or files under supabase/ changed in this branch. Supabase client guard changed in src/supabase.js as supplied by the staging patch.
