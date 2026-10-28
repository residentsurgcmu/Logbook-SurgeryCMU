# Approved room3D v3 — implementation review

Base:6d5ad3efeed31b70cbb21acb102f0745d5a50458. Sense approved interactive draftv3 after room photos and annotated corrections. New frontend only; no migrations, API, Auth, grants, booking writes or2D changes.

## Scope

- Modern64-seat layout gets the approved warm-wood room:2 adjoining central tables, inward-facing centre chairs, desks before every row, Moderator/computer desk at right-front facing participants, side rows extended into previous gaps, Chairman desk adjoining centre table.64 codes/counts unchanged; changed visual centres are not database seat mutations.
- Existing38-seat and other nonmatching layouts retain the prior renderer verbatim in SeatMap3DLegacy.jsx. Unit source assertions for that renderer now read its new filename; existing seatMap3d geometry is unchanged.
- Room64 renderer uses only map.seats and map.me already available to2D. Live status comes from seatCell/seatAriaLabel, including ownhold. No fixtures, sample assignments or window debug in production modules. Names render through React text in a fixed detail panel rather than a floating tooltip.
- Wrapper remounts on actor/role/session/layout/geometry changes, preventing prior actor detail state carrying over. Occupancy/hold refreshes recolour the same scene and refresh selected detail without rebuilding it.
- Orbit drag/pinch/wheel and presets/reset/zoom remain view-only. Multi-pointer or dragged gestures do not select a chair. A dropdown provides an alternative to precise3D picking. Labels declutter as camera changes. Native booking stays2D.
- On-demand rendering, DPRcap2, no animation loop or camera glide, hidden-page and dialog pause, bounded OrbitControls zoom. Portrait framing fits all64 seat centres. Cleanup tracks resources from allocation and runs on construction/render/context failures. Existing gate falls back to2D.

## C0 validation

- npm test557/557; build passed with existing chunk warning; diff check clean.
- Geometry4 tests:64 codes, retained C/S/B centres and approved M/L/R/H shifts; tables adjoining; desks in front; no chair/table footprint overlap; real local-forward rotation matches intended chair facing.
- Actual Chromium WebGL via SwiftShader at390/1280 (not RPC mocks):live name refresh, actor reset removes old name, own-hold state, preset/zoom, no page overflow. Test fixture only in test harness.
- Runtime probes: paused scene cancels queued frame and ignores zoom, context loss disposes canvas and invokes fallback once, dispose idempotent; switch to38-seat map renders legacy controls. WebGL unavailable cleanly calls fallback.
- Existing3D legacy renderer file is an unchanged copy; SeatMapViews, seatMapApi,2D and database files unchanged. No DB/RC04/QR acceptance repeated.

## Targeted G0 review

Review renderer integration, live refresh/actor reset, resource/pause/gesture lifecycle, portrait fit, approved geometry and legacy compatibility. Do not reopen score/QR contracts. Evidence above uses a software GPU and synthetic browser fixture, not nativeiOS/hardware performance or production signed-in acceptance.

## Release

After review and explicit Sense approval: verify expected head, merge/frontend deploy, check live bundle. No migration needed. Short visual read-only confirmation is sufficient; do not repeat RC04/QR tests. Frontend rollback toPR35 preserves all seating data because this feature performs no writes.

## G36-B01 targeted correction (2026-10-28)

G0 R001 found the new renderer communicated per-seat status by colour alone until selection. The revised renderer draws a monochrome symbol beside each seat code: ○ free, ● occupied by another person, ★ own seat, ◇ own hold, … another person's hold. A text legend explains all five. The dropdown also includes the same symbol and the current Thai status label for every seat, without needing selection.

Canvas labels are drawn on creation and redrawn in syncMap only when that seat's state changes; existing textures are reused and marked for upload. Rings/badges retain their colour cues. No geometry, data/API/authorization, booking, or legacy renderer changes.

Validation: npm test 557/557; build passed (existing chunk warning); git diff --check passed. The actual Chromium/SwiftShader WebGL suite passed at 390 and 1280. New regression instruments canvas fillText in the test browser and exercises mountRoom3d directly, verifying all five initial status labels and transitions between mine/taken/myhold/held without rebuilding. Wrapper checks verify dropdown labels and canvas text change on free→own-hold refresh. Existing name refresh, actor reset, controls, pause/context loss, legacy fallback and unavailable-WebGL probes still pass. No native iOS, hardware GPU, production signed-in or database test claimed.

Next: targeted G0 recheck of G36-B01 only. Not merged or deployed.
