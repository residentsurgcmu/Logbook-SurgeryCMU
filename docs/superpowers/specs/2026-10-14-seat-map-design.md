# Seat map for the Friday meeting (S1) — attendance evidence + room view

Date: 2026-10-14 · Status: draft for review · Path: architectural (new subsystem: tables, functions, screens)

Based on: Next Features Notes §7–9, §37; the ChatGPT interactive demo `resident-corner-function-demo.natchanon-suttawat.chatgpt.site` (read 2026-10-14, display format only); the repository snapshot in this folder (older than GitHub main — see §12).

## 1. Purpose

Give the department a **reliable record that a Resident (or Staff member) was in the meeting room**, and give everyone a **picture of the room: who sits where**.

Success =
- A Resident can only pick a seat after scanning the room's QR, and cannot take a seat someone else holds or occupies, even when two people tap at the same moment.
- Staff and Residents see the same room picture, with names (decision B below).
- Every change is recorded in an append-only log that is keyed to the person, not the seat.
- A session without a seat map behaves exactly as today.
- Admin work stays at one click per week.

### Decisions made with Sense (2026-10-14)

| # | Decision | Source |
|---|---|---|
| D1 | Display format follows the ChatGPT demo (mobile mini-map → zone detail, four tabs, status vocabulary). | Sense |
| D2 | First release = **A**: the seat map is attendance evidence and works alongside the existing QR check-in. Staff also see the room picture. | Sense |
| D3 | **B**: every logged-in user sees names on the map and the participant list. (Notes §7 had said "mini-map shows no names"; the mini-map still shows none, the zone detail and list do.) | Sense |
| D4 | **A**: a user must scan the room QR (existing `check_in_resident_round`) before choosing a seat. Optional Staff "certify map" is an extra, not a requirement. | Sense |
| D5 | Architecture approach 1: extend the existing round tables, writes only through SECURITY DEFINER functions, polling not Realtime. | Sense |
| D7 | **Staff, not Admin, approve or reject** urgent-duty reports and correction requests (any active Staff account, in the room or not; nobody decides their own request). Admin keeps the on-screen report and sees the requests read-only. | Sense, 2026-10-14 (after seeing the mockup) |
| D6 | Defaults adopted unchanged: "on time" = checked in before the configured time (default 09:00), no seat needed; urgent-duty reports up to 48 h after the session; report and full history visible to Admin only. | Claude default, Sense accepted |

Not decided / defaults Claude set (Sense to confirm): see §11.

## 2. Scope

In: room layout as data; per-session seat configuration; seat hold, confirm, release, move; reserve-area status; urgent-duty reports; correction requests; Staff seating of Residents who already checked in; optional Staff certification; Admin configuration, request review and on-screen report; the in-app QR scan button (piece S0).

Out (later or never here): recognition / "suggest to speak" (rule C, needs department policy); advance leave and off-site rotation entries; calendar linkage; Realtime subscriptions; report export; QR CME links; any change to the QR token, its expiry, or `check_in_resident_round`; any reward or penalty use of the data.

## 3. Constraints

- **Additive only.** New tables and functions. No change to `resident_round_sessions`, `resident_round_attendance`, `resident_round_qr_tokens` or to any existing function. Verified by md5 fingerprint of `check_in_resident_round` before and after (same technique as the file 09 release).
- **Every write is a SECURITY DEFINER function**, `set search_path = ''`, `revoke all … from public, anon`, grant to `authenticated`, role checked inside. No direct table writes. RLS enabled on every new table.
- **Names are read through one function only.** `resident_round_attendance` keeps its own-row/Admin RLS; it is not loosened.
- **No e-mail addresses** in any seat-map result (consistent with CLAUDE.md "Residents never see Staff emails").
- **No patient data.** Free text is length-limited and the database rejects runs of 6 or more digits (HN guard); the screen warning is only a convenience.
- **Protected files — do not edit:** `CLAUDE.md`, `src/tokens.css`, `src/styles.css`, `src/features/ResidentDashboard.jsx`, `src/residentAnalytics.js`; do not edit `src/navGroups.js` or `BOTTOM_NAV`. New CSS goes in `src/seatMap.css`.
- **No new dependencies.** `html5-qrcode` is already installed.
- **Never `supabase db push`.** Apply the migration alone with `supabase db query --linked -f …`; Claude verifies read-only, Sense runs production writes.
- Release order: migration → (edge functions: none) → frontend.
- This data must not be used to decide rewards or penalties automatically (notes §7). "On time" alone is never a penalty criterion.
- Thai copy stays plain; the spelling is "เช็คชื่อ".

## 4. What exists today (verified in this snapshot)

- `resident_round_sessions` has its own `starts_at` / `ends_at` window, set by Admin, any weekday, several sessions per date allowed if windows do not overlap (migrations `20260925085539`, `20261001090000`). The original fixed 11:00 cutoff and Friday-only rule no longer apply.
- QR token changes every minute; `current_resident_round_qr()` is Admin-only; `check_in_resident_round(p_token)` accepts only active Resident or Staff, inside the session window, and inserts one `resident_round_attendance` row per (session, user) with `checked_in_at`.
- `resident_round_attendance` RLS: a user sees own rows; Admin sees all.
- Front end: `RoundCheckIn` (`src/features/RoundAttendance.jsx`) accepts a token only from the link `/attendance/<token>` (`parseRoundToken` in `roundSchedule.js`); there is **no in-app scan button** for check-in. `StaffQrScanner` in `ResidentQr.jsx` already uses `html5-qrcode`.
- Navigation already has "เช็คชื่อประชุม" (all but Admin) and "MM & Grand Round" (Admin). No seat-map code, table or migration exists.

## 5. Data model

All timestamps `timestamptz`. All new tables are in `public`, RLS on.

### 5.1 Room layout as data
- `resident_room_layouts(id uuid pk, name text not null unique, active boolean default true)`.
- `resident_room_seats(layout_id → layouts, seat_code text, zone text check in ('M','L','C','R'), row_no int, col_no int, primary key(layout_id, seat_code))`. `seat_code` matches `^[MLCR][0-9]{1,2}$`.
- Seed: one layout "ห้องประชุมวันศุกร์ (37 ที่)": `M1`; `L1–L12` (4 rows × 3 cols); `C1–C12` (2 sides × 6 rows, odd codes left, even right); `R1–R12` (4 rows × 3 cols). Front of the room is the top; left/right as seen from the back of the room.
- `select` granted to `authenticated` (not sensitive). No other grants.

### 5.2 Per-session configuration
- `resident_round_seat_config(session_id pk → resident_round_sessions, layout_id → layouts, on_time_at timestamptz not null, created_by, created_at)`.
- Room opens at the session's `starts_at`; seats are released at `ends_at`. Only `on_time_at` is stored (must lie within the session window).
- No row = no seat map for that session; nothing else changes.
- The layout cannot be changed once anyone holds or occupies a seat.

### 5.3 Seating
- `resident_seat_assignments(id, session_id, user_id, seat_code, seated_at, released_at, release_reason, assigned_by)`; `release_reason` in `self | moved | staff | reserve | urgent`.
  - Partial unique index `(session_id, user_id) where released_at is null` — one seat per person.
  - Partial unique index `(session_id, seat_code) where released_at is null` — one person per seat.
- `resident_seat_holds(session_id, seat_code, user_id, expires_at)`, unique `(session_id, seat_code)` and unique `(session_id, user_id)`. Holds last 60 s; expired holds are ignored and deleted lazily at the start of each function.
- No background job. After `ends_at` every write is refused; the map reads as ended. Assignment rows stay as the historical record (released_at stays null; the report treats them as "ended at ends_at"). Because the indexes are per session, the next session starts clean.

### 5.4 Status other than a seat
- `resident_seat_status(session_id, user_id, status, since, primary key(session_id, user_id))`, `status in ('reserve')`. "In the room, no seat" is derived from the attendance row; "seat" from an open assignment; "Staff in room" from role + attendance row; "urgent duty" from a request.

### 5.5 Requests (urgent duty and correction share one queue)
- `resident_seat_requests(id, session_id, user_id, kind in ('urgent','correction'), reason text, note text, state in ('pending','approved','rejected') default 'pending', created_at, reviewed_by, reviewed_at)`.
  - `urgent.reason` in `ผ่าตัด | ผู้ป่วยฉุกเฉิน | อยู่เวร | อื่น ๆ`; `note` ≤ 160 chars; `correction.note` ≤ 200 chars. Both pass the HN guard.
  - An urgent request releases the user's seat and shows the status "ภารกิจจำเป็น · รออาจารย์ตรวจสอบ" until reviewed.

### 5.6 Event log
- `resident_seat_events(id, session_id, at, actor_id, subject_id, kind, seat_code, detail jsonb)` — append-only, no update/delete function, no direct grants. Keyed to the person; `seat_code` records the seat **at that moment**. Kinds: `hold`, `confirm`, `release`, `move`, `reserve`, `urgent`, `correction`, `staff_set`, `staff_release`, `certify`, `review`, `configure`.
- The 09:00 picture is reconstructed from this log (no scheduled snapshot).

## 6. Functions and permissions

Common rules: caller must be an active account (`resident_user_roles.active` and `resident_profiles.active`); times from `clock_timestamp()`; session must have a seat config; every write appends an event; errors are specific exceptions the UI maps to Thai text.

| Function | Who | Rule |
|---|---|---|
| `list_resident_seat_sessions()` | any active logged-in role | Residents cannot read `resident_round_sessions` (its RLS is Admin-only), so this returns the sessions that have a seat config and are between `starts_at − 1 h` and `ends_at + 48 h` (Staff: `ends_at + 7 days`, so late requests can still be decided): id, date, window, on-time time. Staff keep seeing a session for 7 days after it ends (so a late request can still be decided); other roles keep 48 h. |
| `get_my_seat_events(p_session_id)` | any active logged-in role | The caller's own events for that session (hold taps left out) — feeds "ประวัติของฉัน". |
| `get_resident_seat_map(p_session_id)` | any active logged-in role | Returns layout, occupants (`full_name` and `pgy` from `resident_profiles`, no e-mail), live holds (flag only, never who holds), my status, config times, server time, counts, and the participant list. **Participant-list visibility:** everyone sees people who are in the room (seat, reserve area, in room, Staff in room). Only Staff and Admin also see people who are **not** in the room and those with an urgent-duty request. A Resident therefore cannot see which colleagues are absent or on urgent duty (refines D3; see §11). An occupant's seat time (`seated_at`) is shown only to Staff, Admin and the occupant themself. Non-Admin callers may read a session only between `starts_at − 1 h` and `ends_at + 48 h`; Staff may read it until `ends_at + 7 days` (Admin: any time). The status order is seat, reserve, urgent, Staff in room, in room, absent, so a Resident who scanned and then reported urgent duty shows as urgent to Staff, Admin and themself. |
| `hold_resident_seat(session, seat)` | Resident | Has an attendance row for the session; inside the window; seat exists in the layout; not occupied or held by someone else; replaces my previous hold; advisory lock on (session, seat). |
| `confirm_resident_seat(session, seat)` | Resident | Needs my unexpired hold on that seat; releases my current seat (`moved`) and assigns in one transaction. |
| `release_resident_seat(session)` | Resident | Releases own seat (`self`); still in the room. |
| `use_reserve_area(session)` | Resident | Releases seat (`reserve`), sets status `reserve`; entry time unchanged. |
| `report_urgent_duty(session, reason, note)` | Resident | From `starts_at` to `ends_at + 48 h`; no attendance row needed; HN guard; releases seat. |
| `request_seat_correction(session, note)` | Resident, Staff | Same 48 h window; HN guard. |
| `staff_set_resident_seat(session, resident, seat)` / `staff_release_resident_seat(session, resident)` | Staff who checked in, and Admin | Only for a Resident who **already has an attendance row**; a Resident who never scanned must file a correction. Staff name recorded. |
| `certify_seat_map(session)` | Staff who checked in | Optional; records time and number of edits so far. States nothing about staying to the end. |
| `admin_configure_seat_session(session, layout, on_time_at)` | Admin | Default = previous session's layout and the same clock time; refuses when someone is seated. |
| `review_seat_request(id, decision)` | Staff — any active Staff account, in the room or not (requests can arrive up to 48 h after the session) | Approve / reject; a Staff member cannot decide their own request; logged. **Admin does not decide** (D7). |
| `list_seat_requests(session)` | Staff (to decide), Admin (read-only) | The session's requests with who decided and when. Residents cannot call it. |
| `admin_list_seat_configs()` | Admin | Configured sessions with layout, on-time time, seated count and pending requests (the Admin panel's list). |
| `admin_seat_report(session)` | `private.resident_can_view_seat_report()` (today: Admin) | Counts: in room before `on_time_at`, in room after, reserve, urgent (by state), corrections, certifications; full event log. |

Named capability helpers (notes §10): `private.resident_can_manage_seat_map(session)` (Staff who checked in, or Admin), `private.resident_can_configure_seat_map()` (Admin) and `private.resident_can_view_seat_report()` (Admin; the report is read-only) and `private.resident_can_review_seat_requests()` (Staff; decides requests). Moving any of them to a course director later changes one function.

Concurrency: advisory lock per (session, seat) plus the partial unique indexes as the final guard. The slower tap gets "ที่นั่งไม่พร้อม กรุณาเลือกอีกครั้ง".

## 7. Screens

Placed inside the existing page "เช็คชื่อประชุม", below the check-in result, only for sessions that have a seat config. No change to the menu. New files: `src/features/SeatMap.jsx`, `src/seatMap.js` (pure logic), `src/seatMapApi.js`, `src/seatMap.css` (reads tokens; does not redefine them).

**Resident**
1. Not yet in the room: read-only map and the line "สแกน QR ที่ห้องก่อนจึงเลือกที่นั่งได้".
2. In the room, no seat: on a phone the mini-map (M1 plus three zones; ★ mine, ● taken, … held — never colour alone; **no names on the mini-map**). Tapping a zone opens large seat buttons **with names** (D3). The central table is shown as 2 sides × 6 rows. Tapping a seat opens a 60 s hold dialog with a countdown and a confirm button.
3. Seated: top card "ที่นั่ง L4" with release / move / reserve area / urgent duty.
4. Desktop: the full room, front at the top.

**Tabs:** ผังที่นั่ง · ผู้เข้าร่วม (search by name or code, filter by status) · ประวัติของฉัน (Admin: ประวัติทั้งหมด) · รายงาน (Admin only).

**Staff:** "ฉันอยู่ในห้องแล้ว" through the QR as today; tapping a seat lets them seat or move a Resident who has checked in; optional "รับรองผังที่นั่ง" with the text "ไม่ใช่การรับรองว่าอยู่ครบทั้งการประชุม". A tab "คำขอ" lists the pending requests with "อนุมัติ" / "ไม่อนุมัติ" (D7); their own request shows "ให้อาจารย์ท่านอื่นตรวจ". No report.

**Admin:** inside "MM & Grand Round", per session: "เปิดผังที่นั่ง" (layout and on-time time, defaults copied from the previous session), the on-screen report with the requests read-only (Staff decide them, D7).

**QR scan button in the app (piece S0, no database):** reuse `html5-qrcode` and `parseRoundToken`. Messaging builds in the in-app-browser case (Facebook/LINE block the camera): tell the user to open in Safari/Chrome and keep a paste-link field; iPhone permission denial gets re-enable instructions.

**Behaviour that must hold**
- Poll every 8 s; pause when the tab is hidden and **while a confirm dialog is open**.
- No double submit; ≥ 44 px targets; countdown readable by screen readers; the "ended" banner says "การคืนที่นั่งไม่ใช่หลักฐานว่าอยู่จนจบ".
- Error text is Thai and specific: seat taken, hold expired, session ended, not checked in.

## 8. Testing

1. **JS tests** (`node --test`): zone/seat layout, status labels, countdown, HN-guard message, Thai error mapping, plus regex guards in the style of existing tests.
2. **Database behaviour suite** `tests/seat-map-behavior.sql` (model: `round-attendance-db.sql`, `resident-attempt-rules-behavior.sql`): one seat per person and one person per seat; hold collision, expiry, atomic move; reserve; urgent window; HN guard rejects ≥ 6 digits; writes refused after `ends_at`; a role matrix run as real `anon` / `authenticated` roles (anon denied everywhere, Resident denied Staff/Admin functions, Staff who has not checked in denied, Staff denied the report); sessions without a config unchanged; md5 of `check_in_resident_round` identical before/after.
3. **Layout checks** in a headless browser at 390 / 320 / 1280 px.
4. **Independent review** by a different reviewer than the author (Astra) before production. No single AI declares the database changes safe.

Environment limit (checked 2026-10-14): this machine has no PostgreSQL and CLAUDE.md says SQL cannot run locally. Plan: ask Sense's permission to install `postgresql@16` via Homebrew for a local harness **and** run a staging file that returns OK/FAIL rows on the staging project. Tests report which database and which code version they ran on.

## 9. Release (piece by piece, as อจ. asked)

1. **S0** — in-app QR scan button (frontend only).
2. **S1-DB** — one migration file; a staging file with before/after checks; a production wrapper with checks again before COMMIT; a rollback file that is itself tested. Run alone, never `db push`.
3. **S1-UI** — the screens. Merge with "Create a merge commit". Click-through with test accounts only — never send test requests to real faculty.
4. Per-session on/off: a session without `resident_round_seat_config` has no map. Rolling back = do not open the map, or run the rollback file.
5. Update `10-reset-test-data` (new tables: assignments, holds, status, requests, events are test data; layouts and seats are kept). Its "unclassified resident_* table → STOP" guard protects against forgetting.

## 10. Admin workload

| Task | Frequency | Automation |
|---|---|---|
| Open the map for a session | one click per week | defaults copied from the previous session |
| Review urgent / correction requests | when filed | one queue |
| Read the report | after the meeting | computed on screen |

No manual task repeats more than once a week.

## 11. Open items

Defaults Claude set — Sense to confirm:
- Correction requests use the same 48 h window as urgent duty.
- Staff may seat only Residents who already scanned (keeps the QR as the evidence).
- Retention: keep seat records for one academic year, then Admin may clear them.
- Names visible to all logged-in users (D3): tell อจ. together with the PDPA message; the PDPA message to อจ. is still unsent.
- Moderator seat M1: anyone may take it.
- **Participant list privacy (refines D3, set by Claude 2026-10-14 while planning):** the demo shows every participant with a status such as "ยังไม่เข้าร่วม" to everyone. That would let a Resident see which colleagues are absent or on urgent duty. Default adopted: Residents see only people in the room; Staff/Admin see everybody with statuses. Sense to confirm or revert.

Known limits
- A user can see data up to 8 s old; collisions are always decided by the database.
- Camera scanning and tapping on a real iPhone/Android cannot be proven here; Sense must test on devices (iOS Safari, Android Chrome).
- "Staff must also sit" is not enforced.

## 12. Basis and caveats

- First read from `Logbook-SurgeryCMU-main` as downloaded (not a git repository). **Re-checked 2026-10-14 against GitHub main `3e6ac69`** (PR #12/#13 merged): `RoundAttendance.jsx`, `ResidentQr.jsx`, `roundSchedule.js` and all round migrations are identical to what §4 describes; `navGroups.js` only gained `myspace`; `residentApi.js` only gained `loadOwnRoundAttendanceSince`. Two corrections came out of the re-check and are in §6: Residents cannot read sessions (new `list_resident_seat_sessions`), and the participant-list privacy rule.
- The plan is `docs/superpowers/plans/2026-10-14-seat-map.md`; both files are committed together on a local branch of a clone of main.
- Display format taken from the ChatGPT demo's client code (localStorage only, no server). Nothing in the demo's data or behaviour was verified against the real system.
- Profile column names for display name and PGY are assumed to exist on `resident_profiles`; confirm in the plan.
