# My space for Residents — round 1 (implementation design)

Date: 2026-10-12 · Status: draft for review · Path: architectural (new page + new pure module, no database change)

Authority: `line/SPEC_Sol_myspace_v1.md` (Sense's scope and wording; copied verbatim into §9 so the repo carries it) and notes §15/§37. This document fixes how it is built and records where the older design reference (`Resident_Corner_Batch3_MySpace_v3.html`) is overruled.

## 1. Purpose and success

A Resident opens one page and sees their own progress: what is waiting, what was finished, how far they are from the board checklist, what can still be sent this academic year, and meeting attendance as supporting information. Success = (a) every number on the page equals what the Admin progress file shows for the same data, (b) wording matches the live rules, (c) nothing is shown that needs the calendar, rewards or comparison with other people, (d) works at 375–430 px.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Counters are never combined. Four separate numbers: waiting, finished this academic year, EPA x/8, PBA n/16. | Sense's spec; the v3 reference showed one combined "ก่อนสอบบอร์ด (EPA+PBA)/(8+16)" — **overruled**. |
| D2 | Calendar-dependent parts of v3 (events in 30 days, workshop) and rewards/milestones are **not built and not shown as "coming soon"**. | Sense's spec (OUT list). |
| D3 | `src/navGroups.js` gets exactly one change: id `myspace` added to the first group of `NAV_GROUPS` right after `home`. `BOTTOM_NAV` untouched. | Owner (อจ. Chagkrit) approved this edit on 2026-10-12. |
| D4 | Counting lives in a pure module `src/mySpace.js` using `EPA_CODES` / `PBA_CODES` from `src/adminProgress.js` and `academicYearStart` / `bangkokDate` from `src/residentAssessmentRules.js`. | One definition of "which forms count" shared with the Admin Excel; no new date logic. |
| D5 | "Reached the level" comes only from `workspace.epaProgress[].met` (database function), never recomputed in the browser. | Same source as the send page and the Admin file. |
| D6 | Meeting attendance: new `loadOwnRoundAttendanceSince(isoDate)` in `residentApi.js` that pages through all rows from the academic-year start (`fetchAllRows`). `loadOwnRoundAttendance()` (20 rows, used by the live check-in page) is not changed. | Sense's answer to Sol. |
| D7 | The attendance list shows check-in **timestamps only** ("ครั้งที่ n · วันที่ เวลา"), not meeting names. | Residents cannot read `resident_round_sessions` (select policy is admin-only, migration `20260920102939`); adding a policy or RPC would be a database change, which is out of scope. |
| D8 | Staff names come from the same lookup `ResidentRequestHistory` uses (`workspace.allProfiles \|\| workspace.profiles`, fallback "—"; `previous_staff_name` is the PREVIOUS Staff, never used). | Residents never see Staff e-mails; names only. |
| D9 | The page is built in the repo's current style: React function component, class-based CSS using `tokens.css` variables, Thai copy, source-guard regex tests plus behavioural tests for the pure module. | Matches the codebase. |

## 3. Data and counting rules (the pure module)

`buildMySpace({ user, requests, assessments, templates, epaProgress, attendance, now })` returns a plain object; no React, no I/O.

- **year**: `academicYearStart(now)` → label "ปีการศึกษา " + Buddhist year of that start (1 July Bangkok). Boundary: 30 June 23:59 Bangkok is the previous year; 1 July 00:00 is the new one.
- **waiting**: `requests` with `status === "pending"`, newest first, each with form code/title, Staff name, sent date, `daysWaiting` (Bangkok calendar days).
- **finishedThisYear**: `assessments` whose `assessment_date` falls in the current academic year (includes ones an Admin recorded directly).
- **epaReached / epaTotal**: among `EPA_CODES` minus `EPA-8` (8 forms), count where the form's `epaProgress` row has `met === true`. `epaProgress === null` → `epaAvailable:false`, `epaReached:null` (page shows a short Thai note, everything else still renders). EPA-8 never counts.
- **pbaFinished / pbaTotal**: distinct PBA forms (`PBA_CODES`, 21 forms) having at least one finished assessment; target constant 16. A pending request is not finished.
- **recent**: last 5 finished assessments (date desc): form, date, Staff.
- **boardChecklist**: per EPA board form (8): `reached` or `{used, cap, thisYear, perYear, belowCount}` from `epaProgress` (`attempts_used`, `attempts_cap`, `attempts_this_year`, template `max_attempts_per_year`, `latest_below.length`); stuck at the cap and not reached → text "ติดต่อ Admin เพื่อพิจารณาเพิ่มครั้ง". PBA: count plus each of the 21 forms as finished / waiting / empty.
- **yearPlan**: EPA forms that can still be sent this academic year = not reached AND `attempts_this_year < per_year` AND `attempts_used < attempts_cap` (EPA-8 excluded); PBA finished this academic year `n/4` (distinct forms; a request-linked assessment counts in the year its request was sent, like the Admin progress file, a directly recorded one by its assessment date). An EPA form whose latest attempt is still waiting shows "รอ Staff ประเมิน" (not the Admin-limit message) and is not offered again.
- **attendance**: `countThisYear` and the last 5 timestamps from the rows loaded since the year start.
- Cancelled requests are ignored everywhere.

Wording: reuse the live Thai texts; never "ผู้อำนวยการหลักสูตร"; "ต่อปีการศึกษา (เริ่ม 1 ก.ค.)", never "ต่อชั้นปี"; attendance block labelled "ข้อมูลประกอบ ไม่ใช่คะแนน"; "ถึงเกณฑ์" = every criterion of one assessment at L4/L5 (M/E for EPA 7); no text like "/24".

## 4. Page and wiring

- New `src/features/ResidentMySpace.jsx` (props: `workspace`, `onOpenHistory`, `onOpenRequest`); seven sections in the order of the Sol spec; loading / empty / error states in Thai; attendance loaded in an effect with its own loading and error state so a failure there never blanks the page.
- `src/mySpace.css` (component classes using `tokens.css` variables; ≤ 900 px first; touch targets ≥ 44 px; text ≥ 16 px for body copy; no horizontal page scroll), imported after `mobile-assessment.css`.
- `ResidentPlatform.jsx`: for `role === "resident"` add `["myspace", "My space"]` to `nav`, a title, and a render branch; links go to the existing `history` and `request` tabs through the existing `goTo`. Resident only: the branch is unreachable for other roles because `nav` is the allow-list.
- `navGroups.js`: D3. A test asserts the first group order `home, myspace, …` and that `BOTTOM_NAV` is unchanged.
- No change to `ResidentDashboard.jsx`, `residentAnalytics.js`, `tokens.css`, `styles.css`, `CLAUDE.md`, anything under `supabase/`, or `src/generated/`.

## 5. Tests

Pure module (`tests/my-space.test.mjs`, fake data): the four counters; EPA-8 excluded from x/8; PBA waiting vs finished; academic-year boundary; the "can still send this year" rule; `epaProgress = null`; cancelled ignored; admin-recorded assessments counted; consistency check — the module's EPA and PBA code lists are the same arrays the Admin progress file uses. Static tests: the page exists only in the resident nav; no combined total string and no "/24"; forbidden phrases absent; `loadOwnRoundAttendance` unchanged and the new function pages with `fetchAllRows`. Full suite and `vite build` stay green.

Browser check (scratch, not shipped): render the page with fixtures at 390 and 320 px in headless Chrome with a Supabase stub (same method as round 1); check no horizontal scroll, tap targets, loading/error states, and that the counters on screen equal the module's output.

## 6. Risks and limits

- **Same numbers as the Admin Excel** cannot be proven against real data here; the behavioural tests share the code lists, and a real-data comparison is left to Sense on a test account.
- **Not tested on a phone with real data**; a LAN demo page with fake data will be provided as for round 1.
- A Resident with many attendance rows relies on paging; covered by a unit test of the paging call, not against the real table.
- Branch preview talks to the production database unless the staging variables are set for the branch name (HANDOFF); do not use it for sending forms.

## 7. Delivery

Branch `feat/my-space-round1` from main `12391f9`, PR to main (merged by the owner with "Create a merge commit"); round 1 PR #12 is independent (different files except `ResidentPlatform.jsx`, `src/main.jsx`, `preview/main.jsx` — expect a trivial import-line conflict that the second PR resolves).

## 8. Out of scope

Effort milestones, rewards, badges, workshop, events of the next 30 days, research area, anything needing the calendar, any ranking, changing the existing "ภาพรวม" page, changing the phone bottom bar, any database change.

## 9. Source scope (Sol spec, kept for the record)

The seven sections: (1) greeting with name, PGY, academic year; (2) four counters; (3) "รอการประเมิน" list with days waiting and a link to history; (4) "กิจกรรมล่าสุด" last 5 finished; (5) "เช็กลิสต์ก่อนสอบบอร์ด" (8 EPA forms + 21 PBA forms); (6) "เป้าปีการศึกษานี้"; (7) "การเข้าร่วมประชุมของฉัน" labelled "ข้อมูลประกอบ ไม่ใช่คะแนน". Hard limits and wording rules as in §2–§4 above.
