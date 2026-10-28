# Physical room — 64 seats, 2026-10-28

Sense supplied two drawings and confirmed that Moderator/Chairman/Staff seats should support personal selection and occupant names. Orientation: rear looking toward Moderator.

| Zone | Rows | Count |
|---|---|---:|
| M Moderator | 2 | 2 |
| L left | 2,3,3,3,3 | 14 |
| C centre | 2,2,2,2,2,2 | 12 |
| R right | 2,3,3,3 (first row right aligned) | 11 |
| H Chairman | 2 | 2 |
| S Staff behind Chairman | 4+3, then 5+3 with an aisle | 15 |
| B spare chairs at rear | 8 | 8 |

All 64 are numbered selectable physical seats. Waiting without a seat is distinct from occupying B1–B8. Legacy anonymous reserve remains supported on old layouts. Staff must check in via QR before holding/confirming their own seat; existing occupancy constraints/advisory locks, expiry, active checks, and end limits remain. Staff explicitly switch between personal selection and assigning Residents. Admin assignment permissions and request-review policies are unchanged.

A new versioned layout is created. Legacy 38-seat data is preserved and marked inactive for new defaults. Existing historical/live rounds remain bound to their original layout. Only unused future rounds over one hour away, with no attendance, assignment, hold, reserve status, or requests, may transfer to the new layout. Transfers are logged; no attendance timestamps are changed. If a round is too close or has existing activity, keep its original layout and create a new appropriate round rather than rewriting history.

## Validation and limits

Local SQL replay includes legacy seating, RC04, round workflow and new Staff seating/count/history/permissions checks. Geometry tests verify all 64 have distinct non-overlapping positions, aisle columns and rear ordering. Browser HTTP mocks exercise Resident/Staff personal selection, named occupancy and separate management at 320/390/768/1280px. No mock is evidence of real JWT or native iOS behavior; contention regression checks ownership rejection and unchanged database locking/index rules, not a new multi-session load test.

## Release order / compatibility

Apply the versioned migration to staging first, exercise native Staff hold/confirm/release in a transaction and verify legacy seating/attendance unchanged. Publish frontend supporting H/S/B **before** production migration, so old and new layouts can both be read during cutover. Then apply production migration and verify counts, permissions, history fingerprints and fresh round default. Keep the H/S/B-capable frontend as the compatibility floor after any new-layout session is used: reverting to an older reader would hide rear chairs. Prefer a forward fix or temporarily stopping seat writes over deleting assignments or rolling back layout data. Never delete the legacy/new layouts or history as a rollback shortcut.
