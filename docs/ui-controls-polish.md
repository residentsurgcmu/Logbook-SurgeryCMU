# UI-POLISH-01 — meeting and admission case controls

Base: 6c6ab74c1d385815088a2b48f03eb9addad58f04 (PR36). Implements the five layout issues Sense reported on 2026-10-28.

- Round create/edit: explicit checkbox rows keep the native checkbox beside its clickable label; date/time controls use bounded 46px boxes. Save/cancel share a wrapping action row.
- Seat on-time editor: bottom-align the time input and its 46px save button instead of stretching the button to include label height.
- Admission list: scoped class normalizes filter/control heights and header actions. Search moves to its own row on narrow screens; native checkbox remains 18px in a 46px label target.
- Friday conference: separate week navigation and actions; wrap the date above navigation and export onto a full row on narrow screens; normalize segmented controls/select heights and remove duplicated toolbar gaps.

Changes are CSS and semantic class/group wrappers only. Existing event handlers, disabled conditions, date validation, RPC payload construction, authorization, attendance/QR rules, database, 2D/3D seat maps and scoring remain unchanged. Long text can wrap; controls have minimum touch heights rather than forcing clipped button text.

Validation: npm test 557/557; production build passed with existing chunk-size warning; git diff --check clean. Browser HTTP-mock suite `tests/ui-controls.browser.mjs` imports the actual three page components and runs at 390/768/1280 (nine page/viewport combinations). It checks checkbox placement/label toggling, custom scan fields and outgoing schedule arguments, equal control heights, time-save/action alignment, cancel, search/view switching, deleted-case checkbox, next-week navigation, no horizontal page overflow and no page errors. Internal screenshots inspected for mobile and desktop. All external HTTP is fulfilled by fixtures; no real data or email is contacted. Chromium evidence is not native iOS evidence; no new database/RC04/QR acceptance needed for this presentation change.

Run browser verification with Vite on 5184, `VITE_SUPABASE_URL=https://dyiiivcyoatgmkmvgcnt.supabase.co` and `VITE_SUPABASE_PUBLISHABLE_KEY=fixture-key`, then `NODE_PATH=<runtime node_modules> node tests/ui-controls.browser.mjs`. Network mocks intercept all non-local requests. The production project guard is unchanged.

Release: frontend only, no migration. After Sense approves, merge the exact reviewed head, await Vercel and verify the live assets. Rollback is a frontend revert to PR36; there are no data mutations from this patch.
