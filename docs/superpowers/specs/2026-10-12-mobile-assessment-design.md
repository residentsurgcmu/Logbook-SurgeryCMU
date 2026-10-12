# Mobile renovation round 1 — Staff queue + assessment form

Date: 2026-10-12 · Status: draft for review · Path: architectural (round 1 of several)

## 1. Purpose

Make the assessment flow usable and safe on a phone. Sense's iPhone test (Next Features Notes §38–39) showed four problems; one of them can put a score on the wrong row in official assessment data. This round fixes those four and nothing else.

Success = on a 390 px and a 320 px screen, a Staff member can open a pending request, read every criterion's full text next to its level buttons, score without sideways scrolling, and save without any control overlapping another. **The data that gets saved is identical to today.**

### What was observed (the four problems)

| # | Where | Problem | Root cause in code |
|---|---|---|---|
| 1 | Staff "รายการรอ Staff ประเมิน" | Action button is off-screen to the right; the "การรับประเมินของคุณ" card sits above the queue | `RequestQueue` renders a 6-column table (`ResidentPlatform.jsx:71`, `.resident-table-wrap table {min-width:680px}`); `StaffAvailabilityCard` is rendered before it (`ResidentPlatform.jsx:996`) |
| 2 | Same page | Date field runs under the "บันทึก" button (iOS) | `.staff-availability .availability-row` is a wrapping flex row with `label {min-width:200px}`; iOS draws `type=date` wider than its box (`resident.css:484`) |
| 3 | Staff scoring form (and Resident self-assessment) | Matrix splits when scrolled sideways: criterion names disappear while choosing L1–L5, comment field is cut — risk of scoring the wrong row | `.criterion-row {min-width:calc(530px + n*55px); display:grid; 7 columns}` (`resident.css:66`) inside `overflow:auto` |
| 4 | Resident "ส่งแบบประเมิน" | Three stacked rule boxes (red + yellow + green) and a long legend push the submit button below one screen | `RuleMessages` + `LevelProgressNotice` + `ScoreLegend` (`ResidentAssessmentViews.jsx:145–189`, `:45`) |

Correction to the earlier hypothesis in notes §38: `.conf-editor-actions {position:sticky}` belongs to the Friday-conference editor, not to this page. The overlap on the Staff queue page is problem 2. The assessment form's button row (`.button-row`) is not sticky today.

## 2. Scope

In: the four problems above, on screens ≤ 900 px (the same breakpoint at which the bottom nav appears, `resident.css:375`), plus the small component-token layer they need.

Out (later rounds, do not start here): My space, academic calendar, seat map, rewards, Admin guide, e-mail templates, any database or RLS change, any change to scoring rules, any redesign of desktop layout.

## 3. Constraints

- **Data identity.** The saved payload must not change: same `completeAssessmentRequest({requestId, outcome, comment, scores[{criterionId, score, comment}]})` call, same request-create call, same validation messages, same required fields. No level is ever pre-selected. All existing radio inputs keep their `name="score-<criterionId>"`, `value`, and `onChange`.
- **Protected files — do not edit:** `CLAUDE.md`, `src/tokens.css`, `src/styles.css`, `src/features/ResidentDashboard.jsx`, `src/residentAnalytics.js` (owner: อจ. Chagkrit; HANDOFF "People and roles"). Also do not edit `src/navGroups.js` (nav design) and `BOTTOM_NAV`.
- **No new dependencies.** `package.json` stays as is.
- **Desktop unchanged.** Above 900 px the pages must render as today (the queue table, the 7-column matrix, the legend open).
- Thai copy stays plain; no jargon added.

## 4. Design

### 4.1 Component-token layer (design-system skill)

New file `src/mobile-assessment.css`, imported in `src/main.jsx` after `./resident.css` and in `preview/main.jsx` after `../src/resident.css`. It reads `tokens.css` and never redefines it. Three layers, following the design-system skill:

```css
/* primitive → already in tokens.css (--brand, --line, --radius-md, --bottom-nav-height …) */
:root {
  /* semantic (this round) */
  --touch-min: 44px;            /* minimum tap target */
  --space-card: 14px;
  /* component */
  --score-btn-h: var(--touch-min);
  --score-btn-gap: 6px;
  --card-pad: var(--space-card);
  --action-bar-bottom: calc(var(--bottom-nav-height) + env(safe-area-inset-bottom));
}
```

No raw hex or px colour values in the new file; colours come from `tokens.css` variables. Checked with `node ~/.claude/skills/design-system/scripts/validate-tokens.cjs --dir src/` (new file must report no hard-coded colour).

All rules live inside `@media (max-width: 900px)` except the few that hide mobile-only elements on desktop.

### 4.2 Scoring form → one card per criterion (problem 3)

`ScoreGrid` keeps its inputs and state. Markup changes are additive:

- Each `.criterion-row` keeps `[text div][radio × n][comment input]` as children. Mobile CSS turns it into a card: `display:grid; grid-template-columns: repeat(var(--score-count), minmax(0,1fr))`. The text block spans all columns (criterion code + **full** text, never truncated or collapsed), the radios form one row beneath it (each ≥ 44 px high, 5 columns fit at 320 px), the comment spans all columns.
- `.criterion-list` loses `overflow:auto`, `.criterion-head`/`.criterion-row` lose `min-width`. The header row (`L1…L5`) is hidden on mobile because every button shows its own label.
- **Comment is the only thing that folds.** New small button `.criterion-comment-toggle` ("+ ข้อเสนอแนะ") in each row; clicking toggles a per-row flag held in `ScoreGrid` local state. The row gets `data-comment-open="true|false"` (true if toggled or if a comment already exists). Mobile CSS hides the comment input when `false`; the toggle is `display:none` on desktop, where the input stays visible as today. The comment `<input>` and its `aria-label` are unchanged.
- **Progress.** `ScoreGrid` shows `ให้คะแนนแล้ว {answered}/{total}` (counted from the existing `scores` prop). Rows without a score get `.criterion-row[data-unanswered]` (3 px left border in `--warning`, label "ยังไม่ได้เลือก" for screen readers and colour-independent text) — only after the first failed submit, to avoid a wall of warnings on open. Mechanism: `StaffEvaluationForm` already sets `error` for "กรุณาเลือกระดับทุกข้อก่อนลงนาม"; add `showMissing` state set to true at that point and pass it to `ScoreGrid` as an optional prop (default false, so other callers are unaffected).
- Self-assessment hint ("Resident: L3 · …") stays inside the text block.
- Selected state keeps the current look (filled `--brand`); add a visible focus ring (the global `--focus` ring already applies to `:focus-visible` on inputs; the hidden radio's `span` gets `input:focus-visible + span {outline: 3px solid var(--focus)}`).

### 4.3 Level legend (problem 4, part)

`ScoreLegend` renders inside `<details className="score-legend-fold">` with the existing markup unchanged inside. Initial state: open on desktop, closed on mobile, decided once on mount with `window.matchMedia("(max-width: 900px)")` (guarded for non-browser test environments). Summary text "ความหมายของระดับ" is shown on mobile; hidden on desktop via CSS (the section is open there). No other behaviour change.

### 4.4 Sticky action bar (problem 2/3 — buttons must never overlap)

Mobile only. In `StaffEvaluationForm` the existing `.button-row` gains class `assessment-actions` and a counter `<span class="assessment-progress">ให้คะแนนแล้ว x/y</span>` (same count as 4.2). CSS: `position:sticky; bottom: var(--action-bar-bottom); z-index: 30` (below `.bottom-nav` z-index 40), solid `--surface` background, 1 px `--line` top border. Because it is offset by the bottom-nav height it cannot sit under it. Buttons stay `ลงนามและบันทึกผล` and `กลับ`, full width, ≥ 44 px, stacked. Desktop: unchanged (no sticky).

The Resident submit button remains in normal flow (one button, disabled/blocked states already explain themselves).

### 4.5 Staff queue → cards (problem 1)

`RequestQueue` renders the existing table (class gets `queue-table`) **and** a sibling `<ul className="queue-cards">` built from the same `pending` array. CSS shows the table above 900 px and the cards at or below. Card content, in order: submitted time (muted), `EPA-n · title` (strong), `Resident name · ครั้งที่ n`, activity text, then a full-width `เปิดประเมิน` button (`secondary-button`, ≥ 44 px) calling the same `onSelect(request)`. Empty state unchanged.

`ResidentPlatform.jsx` order for Staff: `RequestQueue` first, `StaffAvailabilityCard` second (all widths — the primary task goes first).

### 4.6 Availability card on iOS (problem 2)

Mobile CSS: `.staff-availability .availability-row {display:grid; grid-template-columns:minmax(0,1fr); gap:10px}`; label `min-width:0`; `input[type="date"] {width:100%; max-width:100%; min-width:0; box-sizing:border-box; -webkit-appearance:none; appearance:none; min-height:var(--touch-min)}`; both buttons full width and ≥ 44 px. This supersedes the pending `mobilefix/availability-card-mobile-files_v1.zip`; **that zip must not be applied on top** (same selectors, would conflict). Cannot be proven outside iOS — see §7.

### 4.7 Resident submit page — fewer boxes (problem 4)

In `ResidentRequestForm` and the helpers in `ResidentAssessmentViews.jsx`; no change to `residentAssessmentRules.js`:

1. `RuleMessages`: when `rules.reasons.length > 0`, do not render `rules.warnings` (a blocked form does not need advice). They reappear when the block clears.
2. Remove the duplicate "already met": `LevelProgressNotice` already shows "✓ แบบนี้ถึงเกณฑ์แล้ว …", and rules emit a second yellow `already-met` warning. Render `already-met` only via the green notice: filter it out of `warnings` in the view and extend the green text with "ไม่จำเป็นต้องส่งเพิ่ม (ส่งได้ถ้ายังเหลือครั้งและอยากดูพัฒนาการ)".
3. Legend folded as in 4.3.
4. On mobile the `source-note` under PBA shrinks to one line of muted text (no box).

Result on a typical EPA form: at most the attempt line + one rule box + the folded legend before the fields, instead of three boxes + open legend.

## 5. Files touched

| File | Change |
|---|---|
| `src/mobile-assessment.css` | **new** — tokens + all ≤ 900 px rules |
| `src/main.jsx`, `preview/main.jsx` | one import line each |
| `src/features/ResidentAssessmentViews.jsx` | `ScoreGrid` (toggle, counter, `showMissing`), `ScoreLegend` fold, `RuleMessages` filter, `LevelProgressNotice` text, `StaffEvaluationForm` (`assessment-actions`, `showMissing`), `StaffAvailabilityCard` (no JSX change expected) |
| `src/features/ResidentPlatform.jsx` | `RequestQueue` adds `queue-cards`; Staff order swap |
| `src/resident.css` | none, unless a desktop rule must be narrowed to avoid fighting the new file (decide in the plan; prefer none) |
| `tests/mobile-assessment-20261012.test.mjs` | **new** |

No migration, Edge Function, SQL, dependency or generated file changes. `ResidentDashboard.jsx`, `residentAnalytics.js`, `tokens.css`, `styles.css`, `CLAUDE.md`, `navGroups.js` untouched.

## 6. Testing and verification

1. **Source guards** (`npm test`, existing style): new test asserts the radio `name`/`value`/`onChange` wiring and the two submit payload builders are unchanged in shape; `ScoreGrid` still maps `template.criteria` to `score_options`; nothing sets a default score; protected files byte-identical to the checked-out baseline (sha256 recorded before the first edit); the new CSS has no hard-coded colour and uses `var(--bottom-nav-height)`. Existing 267 tests must stay green.
2. **Payload identity (behavioural).** Use the existing offline preview (`preview/`, `npm run build:corner-preview`) in headless Chromium: score the same EPA form (5 levels) and a PBA form (F/M/E) at 1280 px and at 390 px with the same clicks; capture the arguments passed to the offline `completeAssessmentRequest` and the request-create call; they must be deeply equal. If `preview/offline-api.js` cannot expose these calls, extend the preview shim only (not product code).
3. **Layout checks** at 390 and 320 px (and 1280 for regression): no horizontal scroll on the page or the form; each criterion's full text and its level buttons share one viewport; every tap target ≥ 44 px; action bar not covered by `.bottom-nav` (bounding boxes do not intersect); queue card button visible without sideways scroll.
4. `npx vite build` passes.
5. Report each result with *which* environment it ran in (local checkout / offline preview / headless Chromium) — nothing is claimed for iOS.

## 7. Risks and open items

- **iOS date field** cannot be reproduced in Chromium (notes §39). Mitigation: CSS in 4.6 is defensive (full width, `appearance:none`); acceptance needs Sense's iPhone. Until then the item is "applied, unconfirmed".
- **Folder is not a git repository** (zip snapshot). It is not confirmed to equal `main` `678a2a8`. Before any edit, the plan records sha256 of every file to be touched and of the five protected files; the change must be delivered as a patch/zip against `main`, and the author (Sense/Chagkrit) must confirm the baseline. This spec is therefore **not committed** (no repo).
- **Dependencies not installed** in this folder (`node_modules` absent); the plan starts with an install from `pnpm-lock.yaml` and a baseline `npm test` run (expect 267/268 green) before changing anything.
- **Duplicated DOM** for the queue (table + cards) means any future column added to the table must be added to the card; noted in a code comment.
- **Deviation from Sense's BRIEF** (agreed with the user 2026-10-12): criteria are not collapsible; only the comment folds, because hiding criterion text while choosing a level is the exact risk found on the iPhone.
- Two-key rule in HANDOFF (author ≠ reviewer) applies only to database changes; this round has none, but the patch should still be reviewed by someone other than the author before merge.

## 8. Acceptance criteria

1. At 390 px and 320 px: no horizontal scrolling on the Staff queue, Staff evaluation, Resident submit pages.
2. Every criterion's code and full text are visible together with its level buttons at all times.
3. Payload for identical clicks is deeply equal before/after, at both widths.
4. Action bar never overlaps `.bottom-nav` or the availability card; date field never extends under a button (Chromium; iPhone confirmation pending).
5. Resident submit page shows at most one rule box at a time and a folded legend on mobile.
6. ≥ 1280 px renders as before.
7. `npm test` (all existing + new) and `vite build` pass; protected files unchanged.

## 9. Spec amendments (made while writing the implementation plan, 2026-10-12)

Plan: `docs/superpowers/plans/2026-10-12-mobile-assessment.md`. These supersede the earlier text where they differ.

- **§4.3 legend fold:** implemented with a toggle button and `data-open` state; CSS decides where it folds (phone only). No `<details>` and no `matchMedia`, so desktop markup behaviour is unchanged and a resize cannot leave the legend stuck closed.
- **§4.2 comment fold:** the "+ ข้อเสนอแนะ" button is rendered only while the comment is closed; once opened (or when text already exists) the input stays visible. Opening focuses the input. Placeholder changes from "ถ้ามี" to "ข้อเสนอแนะ (ถ้ามี)" so the field is understandable without the column header.
- **§4.2 failed submit:** after a failed sign attempt the first empty row is scrolled into view (`scrollIntoView({block:"center"})`), because the error line sits below the fold once the action bar is sticky.
- **§4.7 rule boxes:** a new pure helper `src/ruleMessageFilter.js` (`visibleRuleWarnings`) holds the filtering so it can be unit-tested in Node. The yellow `already-met` warning is dropped only when the green level notice is shown (`levelThreshold(template) && progress.met`), so EPA-8/PBA keep it. The "at most one rule box" wording in §8.5 is relaxed to: a blocked form never shows red and yellow together, and "ถึงเกณฑ์แล้ว" is never shown twice.
- **§5 files touched:** adds `src/ruleMessageFilter.js` and one regex update in `tests/resident-attempt-rules.test.mjs` (it counted `<RuleMessages rules={rules} />`).
- **§6.2 payload identity:** done with a scratchpad harness (not shipped) that renders the real `ResidentPlatform` with a recording Supabase stub in headless Chrome at 1280/390/320 px. The offline preview shim is not used because it cannot open the scoring forms. `puppeteer-core` is installed only in the scratchpad, never in `package.json`.
- **§6.3 tap targets:** level buttons must be ≥ 44 px high and ≥ 40 px wide at 320 px (five columns cannot all be 44 px wide on a 320 px screen).
- **§4.4 action bar (final review):** the bar no longer carries its own counter (the list-top counter remains, one aria-live region) and its two buttons sit side by side (sign button wider) so the bar stays ~71px tall at 390px (~95px at 320px, where the sign label wraps; was 155px); `scroll-padding-bottom` keeps a focused field out from under it.
- **§4.2 comment toggle** focuses the input synchronously in the tap (iOS keyboard).
- **§4.1 `--score-btn-gap`** is 4px (not 6px), tuned for 320px.
- **Known §8.6 exceptions on desktop:** queue-first order; longer comment placeholder; after a failed Staff submit the empty rows are labelled and the first is scrolled into view; the read-only AssessmentHistory legend also folds on phones.
- **Save errors** are role=alert and scrolled into view.
