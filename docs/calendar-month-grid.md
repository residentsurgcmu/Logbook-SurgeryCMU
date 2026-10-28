# Calendar month grid — UI follow-up to PR33

Base: 89b953b32694ab4c985e74f7ab80839493c544fd.

The published calendar previously offered only a monthly agenda. This adds a default month table and a list toggle using the same already-authorized RPC result. No migrations, API, recipient scopes, score logic, grants or notification changes.

- Sunday-first month grid, Thai month/Buddhist year, previous/next/today and existing month picker. Boundary blanks do not fetch neighboring-month data.
- Each day is a button with date/count accessible name, pressed state and today marker; arrow keys move within the displayed month. Native table headers preserve weekday relationships.
- Desktop shows up to two truncated event labels per day, draft/cancelled text and extra count. Mobile shows date/count and full details below after date selection. All details and status text remain available. Empty dates and months still show the grid.
- List mode shows all events returned for the month. Selected-day mode uses Bangkok overlap rules, including overnight/multiday events and exclusive end-midnight. After saving, the saved start date is selected. Changing month resets selection to today or the first day.
- Existing loading/error/abort behavior remains; no grid is rendered from a failed or incomplete request. Parent component remains keyed by user.

C0 validation: npm553/553; build passed (existing chunk warning); diff check clean. New pure tests cover month alignment/leap/year rollover and Bangkok multiday/midnight membership. Browser HTTP mocks at390/768/1280 cover existing Admin creation, list/calendar toggling, day selection, empty day, keyboard movement and no page overflow. Resident has no edit/unpublished-result button; upcoming card unchanged. Mobile screenshot inspected. These are Chromium/mocked HTTP checks, not native iOS or a new Auth acceptance.

Targeted review: month/day mapping, selection navigation, empty/error states, responsive layout and preservation of existing controls. PR33's backend/score/QR review need not reopen. No production merge/deploy performed for this change.
