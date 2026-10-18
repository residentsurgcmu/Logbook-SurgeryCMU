# RC-02a-1-UI — Admin account management

Base: main `1b56d139449a103483253dc81ebf1d052cea95a0` (released backend v3).
Scope: frontend only. Sense accepted the interactive design after the save-button revision.

## Resulting behavior

The Admin page now lists all accounts, including inactive accounts, using `admin_list_accounts` and explicit roles. It replaces the old active-only status table, whose inferred role could misclassify legacy Staff with a PGY value. Existing invitation, assignment, assessment, and catalog panels remain available.

- Edit name; Resident PGY 1–4 with a mandatory reason on change; Staff unit; free-form Admin tag up to 40 characters, with F/N suggestions. Email and role are reference information, not editable fields.
- Send only fields that changed. Editing a Staff name never sends or clears a legacy PGY value.
- Explain the effect of current PGY on historical attendance reports without changing exam or assessment records.
- Before changing status, fetch a fresh preview and show cancellations and retained assignments. Require a reason for both deactivation and reactivation. Warn about PGY when a Resident was inactive across an academic year.
- Show the current account as unavailable for status changes. Database authorization and last-admin protections remain authoritative.
- List, preview, mutation and audit operations use the five reviewed Admin RPCs. No direct writes to account tables, no new SQL/migration/Edge deployment, and no privileged browser key.
- Paginate table-returning RPCs. Missing lists/previews/write results are errors rather than successful empty responses.
- Offer audit history on demand, only within the selected account, and sanitize error text into Thai messages.

## Conflict and retry behavior

`ACCOUNT_CONFLICT` blocks another save until the Admin explicitly reloads. `PREVIEW_CHANGED` requires loading new counts and a new confirmation; the reason is retained. A ref blocks a second request before React re-renders.

If a write has an unknown outcome (for example, the response is lost after commit), freeze the payload and reuse its request UUID on retry. Alternatively, the Admin can inspect the latest data and audit history before starting another operation. A subsequent workspace reload failure does not recast an already successful write as failed.

## Validation evidence

- `npm test`: 463/463 (451 existing + 12 new behavioral/API helper tests).
- `npm run build`: passes; existing large-chunk warning remains. The final local production build uses the required project URL with a nonfunctional public-key placeholder so the fail-closed environment guard does not let tree-shaking remove the application. The built assets are checked for the new Admin RPC path; no real key or database connection is used.
- Local Chromium with the actual React component and a fake API: filtering; reason validation and focus; edits by role; retained Staff legacy PGY; deactivation/reactivation; self-action disabled; double-click suppression; committed-write/lost-response replay with the same UUID; stale edit reload; changed-count re-preview and separate confirmation; lazy audit history.
- Real browser layout at desktop 1100px and mobile 390px/320px: no horizontal overflow in list, edit, history and status preview. Screenshots were inspected locally.
- Browser tests made no external requests and did not connect to Supabase/Auth/email. They are not evidence of an authenticated end-to-end UI/RPC round trip on production; that is the short user acceptance check below. The already released backend has separate release evidence.

## User acceptance on the preview

Use only test accounts; preview credentials may connect to the same configured Supabase project. The UI can therefore change test account data for real.

1. Log in as Admin. Check the account list, role/status filters, inactive accounts and a narrow/mobile view.
2. Edit a test Resident name and restore it. Change PGY with a reason and restore it; inspect the audit entries.
3. On a test Staff with no pending requests, inspect the status preview, deactivate with a reason, reactivate with a reason, and inspect its audit history. Do not use the current Admin or a faculty account for this test.

No production merge is performed by preparing this PR. After acceptance, merge once and check Vercel production success. No account-write pause, migration or Edge deployment is needed for this frontend-only release. If the UI must be reverted, revert the UI commit; account changes already committed through the RPCs remain auditable and are not automatically undone.
