# Handoff — seat map (ผังที่นั่งห้องประชุม), 2026-10-14

Read this first in the next session. Written at the end of the session that designed, built, reviewed, released and deployed the seat map.
No names or e-mail addresses on purpose (the repository is public).

## State
- **Deployed.** PR #14 merged to `main` as merge commit `54916c1`; Vercel deployment succeeded.
- **Correction (2026-10-14, evening):** the earlier note that the seat-map SQL had been run on production before the merge was WRONG (only staging had it). After the deploy the Admin page failed with "relation resident_room_layouts does not exist". `production/11-seat-map.sql` was then applied to production (`seat-map structure OK`, committed; 1 layout, 37 seats, 0 seat configs; the six round functions unchanged by md5; existing 10 sessions / 4 attendance rows untouched). Lesson: check the production catalogue (read-only) before merging, not only the owner's report.
- **Not yet done:** real iPhone / Android click-through (camera needs https), update of the owner's wipe file, PDPA message to the supervising professor (see "Open").

## What it does
- A Resident scans the room QR (existing `check_in_resident_round`) and then picks a seat on the room map. Staff see the whole room picture, can seat/release scanned Residents and certify the map.
- **Narrow privacy rule:** a Resident sees only people who are in the room — never absent or urgent-duty people, entry times, others' seat times, or who holds a hold.
- **Staff (not Admin) approve/reject urgent-duty and seat-correction requests; Staff cannot decide their own; Admin is read-only** (`private.resident_can_review_seat_requests()` — change this one function if Admin should decide too).
- Hold 60 s, polling 8 s. Staff read window = session end + 7 days; others 48 h; Admin unbounded. Correction window 48 h. Retention default 1 academic year.
- Everything is additive. The six existing round functions are byte-identical (md5 checked). The seat panel only shows when a session has a seat config; sessions without one behave exactly as before.

## Where things are
- Spec `docs/superpowers/specs/2026-10-14-seat-map-design.md`, plan `docs/superpowers/plans/2026-10-14-seat-map.md` (plan text not re-edited for later code deviations; spec + code win).
- Migration `supabase/migrations/20261014090000_resident_seat_map.sql` (8 tables `resident_room_*` / `resident_seat_*`, 17 public functions, private helpers, seeded layout "ห้องประชุมวันศุกร์ (37 ที่)").
- DB tests: `tests/seat-map-migration.test.mjs`, `tests/seat-map-behavior.sql` (145 checks), `tests/seat-map-db.sql`.
- Front end: `src/seatMap.js`, `src/seatMapApi.js`, `src/features/SeatMap.jsx`, `SeatMapViews.jsx`, `SeatMapAdmin.jsx`, `src/seatMap.css`, `src/features/RoundQrScanner.jsx`; wired into `RoundAttendance.jsx` and `ResidentPlatform.jsx`. `scripts/check-seatmap-render.mjs` is a server-side render check.
- **Outside git** (owner machine): `~/Downloads/seat-map-release/` — `make-release.sh`, `production/11-seat-map.sql`, `production/11b-ROLLBACK-seat-map.sql`, `staging/staging-17-seat-map.sql`, scratch PostgreSQL harness (`rebuild.sh`, `pgenv.sh`; delete the folder to remove), and `ledger-2026-10-14.md` (every ruling + deferred minor).

## Verified on commit ed9106c (before merge)
JS `npm test` 344 pass; `vite build` OK; SSR render checks OK; SQL behaviour suite 145 PASS on throwaway PostgreSQL 16 (harness first proven on the existing 100-check suite); release wrapper applied twice, rollback + re-apply OK, failure injection rolled back; 12 parallel connections on one seat = exactly 1 winner; protected files untouched.

## Not proven
Real devices (camera, layout at 390 / 320 / 1280 px, Facebook/LINE in-app hint); production behaviour after deploy (no click-through yet); the owner's wipe file.

## Open (owner decisions / actions)
1. Click-through with test accounts on iPhone Safari and Android Chrome: Admin configures a round → Resident scans → picks seat → Staff sees room, certifies; urgent-duty and correction requests decided by Staff.
2. **Wipe file `10-reset-test-data-DANGER-IRREVERSIBLE.sql`** (outside git): add the new `resident_seat_*` / `resident_room_*` tables to the wipe list but keep layouts and seats; otherwise its unclassified-table STOP guard fires, and test accounts cannot be deleted until seat rows are cleared.
3. **PDPA:** names are visible to every logged-in user on the map. Tell the supervising professor / faculty PDPA officer (the repository-is-public item in `CLAUDE.md` is still open too).
4. Decisions pending: a retroactive urgent report after the meeting ends rewrites `released_at` of a frozen seat; `counts` lets a Resident work out how many are absent (not who); Staff window of 7 days; a Resident with an urgent request can be seated again (picker excludes status urgent); retention length.
5. Deferred minors (details in the ledger): modal focus trap / Escape stale `onClose`, seat-button double-tap guard, MiniRoom counts held seats as free, text under 16 px, some weak sort/error-map tests, rollback file not re-runnable after tables are gone, `act()` session race, history-load error sticky, scanner hint wording.

## Rollback
`~/Downloads/seat-map-release/production/11b-ROLLBACK-seat-map.sql` (edit the confirm line to `YES` if seat events exist). Reverting the front end alone is safe: sessions without a seat config never showed the panel.

## Rulings made during the build (change if wrong)
1. Work in a fresh clone on local branches cut from the docs commit (one extra docs commit).
2. UI branch built on top of the scan and database branches; shipped as ONE PR.
3. Existing scratch PostgreSQL harness used instead of a new install.
4. Custom task-brief script (stock one cannot parse lettered task ids).
5. Plan defaults kept: 48 h correction window; Staff may seat only Residents who scanned; 1-year retention; "narrow" visibility.
6. Push / PR / merge / production SQL were left to the owner until explicitly authorised.
7. D7 implemented literally: Admin lost approval rights; self-review blocked as a safety net.
8. Spec beat plan in two places: urgent button also after the meeting ends; defensive Resident filter in the people tab.
9. Two error states in the UI: action errors (cleared on next action) and load errors (clear on a successful refresh).
10. After the final review, one fix wave: mask other people's seat time, urgent status precedence, Staff 7-day window, Admin past-session report, silent failure of the session list, "อาจารย์" wording where Staff decide.

## Housekeeping done at the end of the session
- Mockup dev server (port 5190) stopped and its scratch worktree removed.
- Local `gh` account is now `residentsurgcmu` (the `chagkrit` account gets 403 on this repository). Switch back with `gh auth switch -u chagkrit` for other projects.
- Push with the gh credential helper if the keychain one fails: `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push`.

## 3D view (phase 1, view only) — local branch `feat/seat-map-3d`, NOT pushed, no PR (2026-10-14)
- **What:** a "ผัง 2D | ผัง 3D" switch in the seat-map tab for every role (Resident, Staff, Admin). 2D stays the default. 3D is view only: rotate, zoom, three camera presets, tap/hover a seat for its status, a count summary under the picture. Picking, holding, releasing and all requests stay in 2D. No database change, no new RPC; the 3D view reads the same `map` as 2D, so the narrow privacy rule is unchanged.
- **Files:** `src/seatMap3d.js` (pure geometry/colour/summary; the room size is constants here — edit them to match the real room), `src/features/SeatMap3D.jsx` (three.js scene, built once, drawn on demand), `src/features/SeatMap3DGate.jsx` (lazy chunk + error boundary → falls back to 2D with the message "แสดงผัง 3D ไม่ได้บนอุปกรณ์นี้ ใช้ผัง 2D แทน"), switch in `SeatMap.jsx`, styles in `seatMap.css`, tests in `tests/seat-map-3d.test.mjs`. New dependency `three` (exact version; the repo does not track a lockfile). Spec and plan in `docs/superpowers/`.
- **Verified:** `npm test` 359 pass; build OK, `three` is its own chunk (about 565 kB, 141 kB gzip) loaded only on the first switch, main chunk 199.11 kB (was 199.53); SSR check OK. Real headless Chrome (SwiftShader WebGL) against a mock harness: scene and 37 labelled seats render and match the room diagram; presets work (oblique/top/back); hover shows `ที่นั่ง L4 ว่าง`; a drag rotates and shows no tooltip; data ticks recolour seats without resetting the camera and without a second canvas; reduced motion makes presets jump; at 390 and 320 px there is no sideways scroll (a bug found and fixed here: aspect-ratio + min-height made the stage 429 px wide); with WebGL disabled the fallback message appears. Only third-party noise in the console (favicon, harness font path, SwiftShader ReadPixels notice).
- **NOT proven:** real iPhone/Android (touch pinch/rotate, performance), Facebook/LINE in-app browsers, the real room dimensions/layout in `ROOM_3D` (assumed from the seed layout and the owner's check of the diagram), production click-through. Seat labels drawn on the canvas are small on a 320 px phone (zoom helps).
- **Next:** owner device check; decide whether phase 2 (pick a seat in 3D) is wanted; push/PR only on the owner's go-ahead (gh account `residentsurgcmu`).
