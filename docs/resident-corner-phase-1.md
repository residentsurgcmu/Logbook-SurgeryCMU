# Resident Corner — local integration, phase 1

2026-10-03 · Base: a013bd5 · Branch: feat/resident-corner-shell

## Delivered

- Resident Corner is the default signed-in landing page. The original assessment dashboard remains a separate destination.
- Resident: admissions/conference/attendance shortcuts first, personal evaluation counts, inbox, learning/service links.
- Staff: own pending assessment queue with direct entry to the original evaluation form, case/conference teaching links, completed assessment count.
- Admin: system management entry, existing rounds/exams/export/account tools retained.
- Navigation groups workspace, learning/activities, assessment, and account/system tools. Staff assessment group appears earlier. Existing role-authorized destinations are preserved.
- Navy/teal shell follows mockup v3; original department logo retained. Layout and small-screen rules are scoped to the new shell.
- Video library, duty/OR schedules, Microsoft 365/Google have explicit unavailable-state pages. There are no simulated successful account connections or invented clinical/calendar records.
- Login branding and page metadata updated; authentication/recovery behavior unchanged.

## Scope boundary

This is the shell/homepage port only. No schema migration, credential change, API rewrite, deployment, GitHub push, or production access. No case data or images fetched for the new homepage. Existing case/conference/evaluation modules remain in place.

MM/Grand Round data separation, Type fields, conference agenda/deck, team editing rules and external integrations remain in subsequent phases. The combined legacy attendance module is intentionally retained until the additive schema/API work is complete. No new HN handling.

## Verification

- `npm test`: 194 tests passed, 0 failed. This includes existing source/SQL contract tests and pure logic tests; it is not a live SQL/RLS run.
- `npm run build`: passed; pre-existing large export/font chunk warning remains.
- `node scripts/check-corner-render.mjs`: React server render checks passed for all three roles, unavailable service states and existing attendance/evaluation QR initial destinations. Uses fixture workspace and denies fetch; no backend access.
- Browser visual/click-through/mobile checks are outstanding: Chromium was unavailable and its download failed. Render checks do not verify layout, camera, keyboard interaction or real authentication.
- Existing sidebar tests updated for intentional menu grouping changes; business logic tests were not weakened.

## Local run

Install dependencies from the lockfile, configure the existing app environment using the project's documented setup, then run `npm run dev`. The normal app requires the existing authorized account. Do not use production credentials merely to review layout; the render-check script needs none.

## Next review

1. Visually inspect desktop/mobile and keyboard navigation when a browser is available.
2. Confirm role-specific homepage density and navigation with Sense.
3. Continue evaluation UI adaptation against the unchanged original catalog/workflow.
4. Before activity/case schema changes, inspect actual Supabase state and staging. Follow CLAUDE.md: never run blanket `supabase db push` because recorded migration history is incomplete.

## Offline review build — 2026-10-03 follow-up

- `npm run build:corner-preview` creates `preview-dist/Resident_Corner_Local_Preview.html`. Download/open this single file in Chrome or Edge; no server, login or internet connection needed.
- Reuses the actual ResidentPlatform shell and ResidentCornerHome component. Role switch and empty-state controls use fictional records only. Legacy module destinations deliberately show a scope-boundary page: this review covers homepage/navigation, not case entry, scoring or attendance.
- Preview has its own entry point, ignores environment files, replaces the Supabase module with a blocking stub, and applies a CSP with `connect-src 'none'`. The production entry point is unchanged.
- Fonts and logo are embedded. Fixed sidebar flex shrink that let long mobile menus overlap the footer; removed backdrop filtering from the conference button for consistent rendering.
- Chromium offline checks passed: Resident/Staff/Admin, every menu, staff queue destination, empty states, 390px mobile overflow/menu/Escape, simulated logout. Zero page errors and zero HTTP requests observed. This is not an iPhone hardware or live backend test.
- Production build and server-render checks pass. Latest full test run: 193/194 passed; one existing source-hash test fails because `PBA/2.การประเมินหัตถการ Appendectomy.docx` has an unrelated working-tree modification. Preserved that file untouched, did not regenerate the catalog or weaken the test. Prior 194/194 result above describes the earlier baseline only.
- Browser QA script: `scripts/check-corner-preview.cjs`; set `CORNER_PLAYWRIGHT` and `CORNER_CHROMIUM` to installed Playwright and Sparticuz Chromium modules respectively.
- No remote push, deployment, production access or schema changes.
