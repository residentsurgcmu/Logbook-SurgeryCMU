# Seat map 3D view — phase 1 (view only) — design

Date: 2026-10-14. Status: draft for owner review (not committed). No names or e-mail addresses (public repository).

## Purpose
Let people see the Friday meeting room as a 3D picture they can rotate and zoom: Staff / supervising professors for an overview (e.g. on a projector), and **Residents too**. Phase 1 is **view only**. Choosing, holding and releasing seats, urgent-duty and correction requests, and certifying all stay in the existing 2D map.

## Success criteria
1. A "ผัง 2D | ผัง 3D" switch in the seat-map tab; 2D is the default every time.
2. Every role that can open the seat map (Resident, Staff, Admin) can switch to 3D.
3. 3D shows exactly the data 2D shows for that role: no new field, no new RPC, no database change.
4. The page that does not open 3D does not get heavier (three.js loads only on first switch).
5. If WebGL or the chunk is unavailable the user sees a short message and stays on 2D; the page never breaks.

## Visibility (unchanged narrow rule)
The 3D view is fed by the same `get_resident_seat_map` result as 2D. A Resident therefore sees only what 2D already gives a Resident: people who are in the room, never absent or urgent-duty people, entry times, others' seat times, or who holds a hold. Occupant names appear only where 2D shows them (`seat.occupant`), on tap/hover, never baked into the scene. The text summary under the picture uses the same counts as 2D (`counts` is an already-decided item in the handoff).

## Units
- `src/seatMap3d.js` — pure functions, no React, no three.js, tested by `node --test`:
  - `ROOM_3D`: room constants (front at the top/−z, moderator M1 at the front, L and R zones 3 columns × 4 rows; central table C = a long table with 6 seats down each side, odd codes on the left side and even codes on the right as seen from the back of the room, the table itself between the two columns — per the seed comment in the migration). Front-end constants only; editing the room = editing this one file. Real room dimensions are an owner-confirmable assumption.
  - `seatPosition(seat)` → `{x, z}` from `(zone, row_no, col_no)`.
  - `seatVisual(seat, map)` → `{state, symbol, label, colorToken}` built on the existing `seatCell()`; colours come from `tokens.css` names, never colour alone (symbol + label always present).
  - `CAMERA_PRESETS`: oblique, top, from the back of the room.
- `src/features/SeatMap3D.jsx` — loaded with `import()`; draws floor, front screen, central table, chairs and one marker per seat; orbit controls; camera presets; tap/hover tooltip (seat code, state, name only if present in the data); a text summary (free / taken counts) for assistive technology.
- `src/features/SeatMap.jsx` — only the switch and a lazy mount; `SeatMapViews.jsx` (2D) is untouched.

## Behaviour
- **Camera:** drag = rotate, wheel / two-finger pinch = zoom, three presets, polar angle limited so the camera cannot go below the floor, distance limited. With `prefers-reduced-motion` presets jump instead of gliding.
- **Data refresh:** the existing 8 s poll updates seat colours/symbols in place; the scene is built once per layout, not per refresh.
- **Rendering:** draw on demand (rotation, resize, data change), not a continuous loop; stop while the tab is hidden or a dialog is open (reuse `shouldPoll`); pixel ratio ≤ 2; dispose geometries, materials, renderer and listeners on unmount.
- **Tap vs drag:** a pointer movement under ~6 px counts as a tap and only shows the tooltip in phase 1 (no seat action).
- **Failure:** dynamic import error or no WebGL context → message "แสดงผัง 3D ไม่ได้บนอุปกรณ์นี้ ใช้ผัง 2D แทน" and the switch returns to 2D.
- **Accessibility:** the canvas is `aria-hidden`; a visible summary line (free / taken / held counts) sits under it; per-seat information stays in the 2D map and the participants tab, which remain the keyboard and screen-reader path.

## Dependencies
`three` added from npm, pinned to an exact version like the other dependencies (no "latest"); `OrbitControls` from its examples module. No CDN script, no model files.

## Testing
- `npm test`: `seatPosition` gives 37 distinct positions inside the room bounds; `seatVisual` states equal `seatCell` for free / taken / mine / held / my hold; a Resident-shaped map never produces a name for a seat 2D would not name; the 3D module is only referenced through `import()` (regex guard, like the existing source-text tests).
- `npm run build`: three.js in its own chunk; main chunk size not increased.
- Browser check by Claude with mock data at phone (390 / 320 px) and desktop widths: switch works, tooltip, presets, fallback message with WebGL disabled.
- **Not provable by Claude:** smoothness on real iPhone/Android and inside Facebook/LINE in-app browsers (owner device check).

## Out of scope (phase 1)
Picking/holding/releasing seats in 3D, people or animation, editing the room from the Admin page, any database change or migration, changes to 2D.

## Risks
- Room dimensions are assumed from the seed layout; the picture could look wrong if the real room differs (one-file fix).
- The 2D map has still not been tested on real phones; 3D adds a second thing to verify there.
- three.js adds a lazy chunk of several hundred KB; acceptable because it loads only on demand.

## Open items for the owner
1. Confirm the room shape in `ROOM_3D` (or give real dimensions / a photo).
2. Phase 2 (pick a seat in 3D) is a separate decision after phase 1 is checked on phones.
