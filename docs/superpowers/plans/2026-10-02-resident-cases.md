# New admissions + ประชุมวันศุกร์ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Resident/Staff/Admin record admitted cases, attach images, and present the week's cases with shared discussion notes at the Friday conference, on the existing Resident Supabase project.

**Architecture:** One additive migration adds 3 tables, a private bucket, RLS (SELECT only for `authenticated`) and SECURITY DEFINER RPCs for every write (server-side role checks, `updated_at` optimistic check). The front end gets a pure-logic module, a data-layer module, and two feature components wired into the existing tab nav of `ResidentPlatform.jsx`; each component loads its own data (the heavy `loadResidentWorkspace` is not touched).

**Tech Stack:** React + Vite, `@supabase/supabase-js`, Postgres RLS/plpgsql, `node --test` (regex + pure-logic tests, same style as the rest of `tests/`).

**Spec:** `docs/superpowers/specs/2026-10-02-resident-cases-design.md`

## Global Constraints

- Production Supabase project ref is `dyiiivcyoatgmkmvgcnt`. **Never run `supabase db push`.** Claude does not run production writes; the owner runs migrations with `! npx --yes supabase db query --linked --file <file>` (CLAUDE.md).
- Order of release: migration applied and verified → frontend merged/pushed (Vercel deploys on push to `main`).
- Migration is additive only: no change to existing tables, policies or functions.
- No patient name / HN column anywhere. Image caption defaults to empty (never the file name).
- Values: case units `Upper GI | General surgery | HBP`; status `admit | discharged | pending_update`; sex `male | female | unspecified`; text limits diagnosis 180, management 1000, operation 180, caption 200, note 2000; age 0–120; image types jpeg/png/webp, stored ≤ 5 MB (5242880), long edge ≤ 2000 px, JPEG quality 0.85; bucket `resident-case-media` private.
- Dates are Gregorian and compared in `Asia/Bangkok`; `admit_date` must be ≥ 2020-01-01 and ≤ today (Bangkok).
- Permission matrix (spec §4) is enforced in the RPCs and mirrored in `src/residentCases.js` for UI gating only.
- **Refinement of spec §6:** all writes go through RPCs and `authenticated` gets SELECT only on the new tables (stricter than "direct INSERT/UPDATE via RLS"). Task 6 updates the spec text to match.
- Reuse existing helpers: `private.resident_role_is`, `bangkokIsoDate`/`shiftIsoDate` (`src/roundSchedule.js`), `fetchAllRows` (`src/supabasePaging.js`), `.resident-panel` / `.resident-table-wrap` / `.primary-button` / `.secondary-button` / `.danger-button` / `.link-button` CSS classes.
- Do not use a `<header>` element inside the new UI: `.resident-app header` styles every header green.
- Every commit message ends with these two lines:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_019U9dRCDpwvXnbJPN6TtMSZ`
- Work on branch `feat/resident-admission-cases`, not `main`.

## Review Focus

- A date typed with a Buddhist-era year (e.g. 2569) must be rejected with a Thai hint, never stored (Task 1 test).
- Two windows editing the same case: the second save must fail with `CASE_CONFLICT` and a reload prompt, never overwrite (Task 1 `isCaseConflict`/message test, Task 2 rollback test).
- Image file names often contain patient identifiers: caption must default to empty and the file name must never be sent (Task 3 test).
- Opening the conference on a Saturday or Sunday must show the Mon–Fri week that just ended/contains the day, not an empty future week (Task 1 `conferenceWeek` test).
- A non-image, wrong-type or oversized file must be refused before upload with a Thai message (Task 1 `validateCaseImageFile` test).

---

### Task 1: Branch + pure logic module (`src/residentCases.js`)

**Files:**
- Create: `src/residentCases.js`
- Test: `tests/resident-cases.test.mjs`

**Interfaces:**
- Consumes: `bangkokIsoDate(at?: Date): string`, `shiftIsoDate(iso: string, days: number): string` from `src/roundSchedule.js`.
- Produces (used by Tasks 3–5):
  `CASE_UNITS: string[]`, `CASE_SEXES: [string,string][]`, `CASE_STATUSES: [string,string][]`, `CASE_LIMITS`, `CASE_IMAGE_INPUT_TYPES`, `CASE_IMAGE_INPUT_MAX_BYTES`, `CASE_IMAGE_MAX_BYTES`, `CASE_IMAGE_MAX_EDGE`, `CASE_IMAGE_QUALITY`, `CASE_MIN_ADMIT_DATE`,
  `caseSexLabel(v)`, `caseStatusLabel(v)`, `validateCaseForm(form, at?) => string`,
  `canEditCase(user,row)`, `canDeleteCase(user,row)`, `canDeleteMedia(user,media)`, `canEditNote(user,note)`, `canDeleteNote(user,note)`,
  `conferenceWeek(iso) => {start,end}|null`, `caseImagePath(caseId, fileId?) => string`, `validateCaseImageFile(file) => string`, `scaledSize(w,h,max?) => {width,height}`, `isCaseConflict(error)`, `caseErrorMessage(error)`.
  `user` is `{ id, role: "resident"|"staff"|"admin" }`; `row` has `created_by`, `owner_id`; `media` has `created_by`; `note` has `author_id`.

- [ ] **Step 1: Create the branch**

```bash
cd /Users/chagkrit/Downloads/Logbook-Resident_Surgery-Website-main
git switch -c feat/resident-admission-cases
git status --short
```
Expected: `Switched to a new branch 'feat/resident-admission-cases'`. Leave the untracked `29-9-69 ... .docx` alone (never `git add -A`).

- [ ] **Step 2: Write the failing test**

Create `tests/resident-cases.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  CASE_IMAGE_MAX_EDGE,
  canDeleteCase,
  canDeleteMedia,
  canDeleteNote,
  canEditCase,
  canEditNote,
  caseErrorMessage,
  caseImagePath,
  caseSexLabel,
  caseStatusLabel,
  conferenceWeek,
  isCaseConflict,
  scaledSize,
  validateCaseForm,
  validateCaseImageFile,
} from "../src/residentCases.js";

const NOW = new Date("2026-10-02T03:00:00Z"); // 10:00 Friday, Bangkok
const good = {
  admit_date: "2026-10-01",
  age_years: "64",
  sex: "female",
  diagnosis: " Adhesive small bowel obstruction ",
  management: "Non-operative",
  operation: "",
  unit_name: "Upper GI",
  status: "admit",
  owner_id: "11111111-1111-4111-8111-111111111111",
};

test("labels fall back to the raw value", () => {
  assert.equal(caseStatusLabel("pending_update"), "รออัปเดต");
  assert.equal(caseSexLabel("female"), "หญิง");
  assert.equal(caseStatusLabel("weird"), "weird");
});

test("a valid form passes", () => {
  assert.equal(validateCaseForm(good, NOW), "");
});

test("Buddhist-era year is rejected with a Gregorian hint", () => {
  assert.match(validateCaseForm({ ...good, admit_date: "2569-10-01" }, NOW), /ปี ค\.ศ\.[\s\S]*2026/);
});

test("date must be real, recent and not in the future (Bangkok)", () => {
  assert.match(validateCaseForm({ ...good, admit_date: "" }, NOW), /เลือกวันที่รับ/);
  assert.match(validateCaseForm({ ...good, admit_date: "2019-12-31" }, NOW), /2020/);
  assert.match(validateCaseForm({ ...good, admit_date: "2026-10-03" }, NOW), /ไม่เกินวันนี้/);
  assert.equal(validateCaseForm({ ...good, admit_date: "2026-10-02" }, NOW), "");
  // 00:30 Bangkok on the 3rd is still the 2nd in UTC: today means Bangkok today.
  assert.equal(validateCaseForm({ ...good, admit_date: "2026-10-03" }, new Date("2026-10-02T17:30:00Z")), "");
});

test("other fields are validated", () => {
  assert.match(validateCaseForm({ ...good, age_years: "" }, NOW), /อายุ/);
  assert.match(validateCaseForm({ ...good, age_years: "121" }, NOW), /อายุ/);
  assert.match(validateCaseForm({ ...good, age_years: "3.5" }, NOW), /อายุ/);
  assert.match(validateCaseForm({ ...good, sex: "x" }, NOW), /เพศ/);
  assert.match(validateCaseForm({ ...good, diagnosis: "   " }, NOW), /Diagnosis/);
  assert.match(validateCaseForm({ ...good, diagnosis: "a".repeat(181) }, NOW), /180/);
  assert.match(validateCaseForm({ ...good, management: "a".repeat(1001) }, NOW), /1000/);
  assert.match(validateCaseForm({ ...good, operation: "a".repeat(181) }, NOW), /180/);
  assert.match(validateCaseForm({ ...good, unit_name: "ENT" }, NOW), /หน่วย/);
  assert.match(validateCaseForm({ ...good, status: "x" }, NOW), /สถานะ/);
  assert.match(validateCaseForm({ ...good, owner_id: "" }, NOW), /Owner/);
});

test("permission helpers mirror the spec matrix", () => {
  const resA = { id: "a", role: "resident" };
  const resB = { id: "b", role: "resident" };
  const staff = { id: "s", role: "staff" };
  const admin = { id: "m", role: "admin" };
  const row = { created_by: "a", owner_id: "a" };
  const ownedOnly = { created_by: "s", owner_id: "b" };
  assert.equal(canEditCase(resA, row), true);
  assert.equal(canEditCase(resB, row), false);
  assert.equal(canEditCase(resB, ownedOnly), true);
  assert.equal(canEditCase(staff, row), true);
  assert.equal(canEditCase(admin, row), true);
  assert.equal(canEditCase(null, row), false);
  assert.equal(canDeleteCase(resA, row), true);
  assert.equal(canDeleteCase(resB, row), false);
  assert.equal(canDeleteCase(resB, ownedOnly), false);
  assert.equal(canDeleteCase(staff, { created_by: "s" }), false);
  assert.equal(canDeleteCase(admin, row), true);
  assert.equal(canDeleteMedia(resA, { created_by: "a" }), true);
  assert.equal(canDeleteMedia(staff, { created_by: "a" }), false);
  assert.equal(canDeleteMedia(admin, { created_by: "a" }), true);
  assert.equal(canEditNote(admin, { author_id: "a" }), false);
  assert.equal(canEditNote(resA, { author_id: "a" }), true);
  assert.equal(canDeleteNote(admin, { author_id: "a" }), true);
  assert.equal(canDeleteNote(staff, { author_id: "a" }), false);
});

test("conference week is Monday to Friday, weekends map to the week that just ended", () => {
  assert.deepEqual(conferenceWeek("2026-10-02"), { start: "2026-09-28", end: "2026-10-02" }); // Fri
  assert.deepEqual(conferenceWeek("2026-09-28"), { start: "2026-09-28", end: "2026-10-02" }); // Mon
  assert.deepEqual(conferenceWeek("2026-10-03"), { start: "2026-09-28", end: "2026-10-02" }); // Sat
  assert.deepEqual(conferenceWeek("2026-10-04"), { start: "2026-09-28", end: "2026-10-02" }); // Sun
  assert.deepEqual(conferenceWeek("2026-10-05"), { start: "2026-10-05", end: "2026-10-09" }); // Mon
  assert.equal(conferenceWeek("not-a-date"), null);
});

test("image path is inside the case folder and always .jpg", () => {
  const id = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
  const file = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  assert.equal(caseImagePath(id, file), `${id.toLowerCase()}/${file}.jpg`);
  assert.throws(() => caseImagePath("../etc", file), /รหัสเคส/);
  assert.throws(() => caseImagePath("", file), /รหัสเคส/);
});

test("image files are checked before upload", () => {
  assert.match(validateCaseImageFile(null), /เลือกภาพ/);
  assert.match(validateCaseImageFile({ type: "application/pdf", size: 10 }), /JPEG, PNG หรือ WebP/);
  assert.match(validateCaseImageFile({ type: "image/png", size: 0 }), /ว่าง/);
  assert.match(validateCaseImageFile({ type: "image/png", size: 21 * 1024 * 1024 }), /20 MB/);
  assert.equal(validateCaseImageFile({ type: "image/webp", size: 3 * 1024 * 1024 }), "");
});

test("scaledSize keeps aspect ratio and never upsizes", () => {
  assert.deepEqual(scaledSize(1000, 500), { width: 1000, height: 500 });
  assert.deepEqual(scaledSize(4000, 3000), { width: CASE_IMAGE_MAX_EDGE, height: 1500 });
  assert.deepEqual(scaledSize(3000, 4000), { width: 1500, height: CASE_IMAGE_MAX_EDGE });
  assert.deepEqual(scaledSize(10000, 1), { width: CASE_IMAGE_MAX_EDGE, height: 1 });
});

test("conflict and permission errors become Thai messages", () => {
  const conflict = new Error("CASE_CONFLICT: this case was changed by someone else");
  assert.equal(isCaseConflict(conflict), true);
  assert.equal(isCaseConflict(new Error("other")), false);
  assert.match(caseErrorMessage(conflict), /มีผู้อื่นแก้เคสนี้/);
  assert.match(caseErrorMessage(new Error("You cannot edit this case")), /ไม่มีสิทธิ์/);
  assert.match(caseErrorMessage(new Error("Case not found")), /ไม่พบเคส/);
  assert.equal(caseErrorMessage(new Error("boom")), "boom");
  assert.equal(caseErrorMessage(null), "ทำรายการไม่สำเร็จ");
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `node --test tests/resident-cases.test.mjs`
Expected: FAIL — `Cannot find module '.../src/residentCases.js'`.

- [ ] **Step 4: Write the implementation**

Create `src/residentCases.js`:

```js
// Pure helpers for New admissions + Friday conference (kept separate for tests).
import { bangkokIsoDate, shiftIsoDate } from "./roundSchedule.js";

export const CASE_UNITS = ["Upper GI", "General surgery", "HBP"];
export const CASE_SEXES = [["male", "ชาย"], ["female", "หญิง"], ["unspecified", "ไม่ระบุ"]];
export const CASE_STATUSES = [["admit", "Admit"], ["discharged", "Discharged"], ["pending_update", "รออัปเดต"]];
export const CASE_LIMITS = { diagnosis: 180, management: 1000, operation: 180, caption: 200, note: 2000 };
export const CASE_IMAGE_INPUT_TYPES = ["image/jpeg", "image/png", "image/webp"];
// Phone photos are often larger than 5 MB; they are re-encoded before upload,
// and the stored result must still be <= CASE_IMAGE_MAX_BYTES.
export const CASE_IMAGE_INPUT_MAX_BYTES = 20 * 1024 * 1024;
export const CASE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const CASE_IMAGE_MAX_EDGE = 2000;
export const CASE_IMAGE_QUALITY = 0.85;
export const CASE_MIN_ADMIT_DATE = "2020-01-01";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const labelOf = (pairs, value) => pairs.find(([key]) => key === value)?.[1] || value || "—";
export const caseSexLabel = (value) => labelOf(CASE_SEXES, value);
export const caseStatusLabel = (value) => labelOf(CASE_STATUSES, value);

// Returns "" when the form is acceptable, otherwise a Thai message.
export function validateCaseForm(form, at = new Date()) {
  const date = String(form.admit_date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "กรุณาเลือกวันที่รับ";
  const year = Number(date.slice(0, 4));
  if (year > 2400) return `ปีที่ใส่ (${year}) น่าจะเป็นปี พ.ศ. กรุณาใส่ปี ค.ศ. เช่น ${year - 543}`;
  if (date < CASE_MIN_ADMIT_DATE) return "วันที่รับต้องไม่เก่ากว่า 1 ม.ค. 2020";
  if (date > bangkokIsoDate(at)) return "วันที่รับต้องไม่เกินวันนี้";
  const age = Number(form.age_years);
  if (String(form.age_years ?? "").trim() === "" || !Number.isInteger(age) || age < 0 || age > 120) return "อายุต้องเป็นจำนวนเต็ม 0–120 ปี";
  if (!CASE_SEXES.some(([key]) => key === form.sex)) return "กรุณาเลือกเพศ";
  const diagnosis = String(form.diagnosis || "").trim();
  if (!diagnosis) return "กรุณาระบุ Diagnosis";
  if (diagnosis.length > CASE_LIMITS.diagnosis) return `Diagnosis ต้องไม่เกิน ${CASE_LIMITS.diagnosis} ตัวอักษร`;
  if (String(form.management || "").length > CASE_LIMITS.management) return `Management ต้องไม่เกิน ${CASE_LIMITS.management} ตัวอักษร`;
  if (String(form.operation || "").length > CASE_LIMITS.operation) return `Operation ต้องไม่เกิน ${CASE_LIMITS.operation} ตัวอักษร`;
  if (!CASE_UNITS.includes(form.unit_name)) return "กรุณาเลือกหน่วย";
  if (!CASE_STATUSES.some(([key]) => key === form.status)) return "กรุณาเลือกสถานะ";
  if (!form.owner_id) return "กรุณาเลือก Owner (Resident)";
  return "";
}

// UI gating only; the RPCs enforce the same rules on the server.
export function canEditCase(user, row) {
  if (!user || !row) return false;
  if (user.role === "staff" || user.role === "admin") return true;
  return user.role === "resident" && (row.created_by === user.id || row.owner_id === user.id);
}
export function canDeleteCase(user, row) {
  if (!user || !row) return false;
  return user.role === "admin" || (user.role === "resident" && row.created_by === user.id);
}
export const canDeleteMedia = (user, media) => Boolean(user && media) && (user.role === "admin" || media.created_by === user.id);
export const canEditNote = (user, note) => Boolean(user && note) && note.author_id === user.id;
export const canDeleteNote = (user, note) => Boolean(user && note) && (user.role === "admin" || note.author_id === user.id);

// Monday..Friday of the week containing `iso`. Saturday maps to the same week,
// Sunday to the week that just ended (never an empty future week).
export function conferenceWeek(iso) {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  const day = new Date(ms).getUTCDay(); // 0 = Sunday
  const start = shiftIsoDate(iso, day === 0 ? -6 : 1 - day);
  return { start, end: shiftIsoDate(start, 4) };
}

export function caseImagePath(caseId, fileId = crypto.randomUUID()) {
  if (!UUID.test(String(caseId || ""))) throw new Error("ไม่พบรหัสเคส");
  return `${String(caseId).toLowerCase()}/${fileId}.jpg`;
}

export function validateCaseImageFile(file) {
  if (!file) return "กรุณาเลือกภาพ";
  if (!CASE_IMAGE_INPUT_TYPES.includes(file.type)) return "รองรับเฉพาะภาพ JPEG, PNG หรือ WebP";
  if (!file.size) return "ไฟล์ภาพว่างเปล่า";
  if (file.size > CASE_IMAGE_INPUT_MAX_BYTES) return "ภาพต้องมีขนาดไม่เกิน 20 MB (ระบบจะย่อให้ไม่เกิน 5 MB ก่อนอัปโหลด)";
  return "";
}

export function scaledSize(width, height, maxEdge = CASE_IMAGE_MAX_EDGE) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const ratio = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

export const isCaseConflict = (error) => /CASE_CONFLICT/.test(String(error?.message || error || ""));

export function caseErrorMessage(error) {
  const text = String(error?.message || error || "");
  if (isCaseConflict(error)) return "มีผู้อื่นแก้เคสนี้ไปแล้ว กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่";
  if (/cannot (edit|delete|change)/i.test(text)) return "บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้";
  if (/not found/i.test(text)) return "ไม่พบเคสหรือรายการนี้ อาจถูกลบไปแล้ว";
  return text || "ทำรายการไม่สำเร็จ";
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `node --test tests/resident-cases.test.mjs`
Expected: all tests PASS. Then `npm test` — whole suite still green.

- [ ] **Step 6: Commit**

```bash
git add src/residentCases.js tests/resident-cases.test.mjs
git commit -m $'feat: add pure logic for resident admission cases\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_019U9dRCDpwvXnbJPN6TtMSZ'
```

---

### Task 2: Migration, bucket, RPCs and database tests

**Files:**
- Create: `supabase/migrations/20261002090000_resident_admission_cases.sql`
- Create: `tests/resident-cases-migration.test.mjs`
- Create: `tests/resident-cases-db.sql` (read-only checks, run after apply)
- Create: `tests/resident-cases-rls-rollback.sql` (behaviour test, always rolls back)

**Interfaces:**
- Consumes (existing): `private.resident_role_is(public.resident_system_role)`, tables `public.resident_user_roles(user_id, role, active)`, `public.resident_profiles(user_id, full_name, active)`.
- Produces (RPC names/args used by Task 3, passed by name via PostgREST):
  - `create_resident_admission_case(p_admit_date date, p_age_years smallint, p_sex text, p_diagnosis text, p_management text, p_operation text, p_unit_name text, p_status text, p_owner_id uuid) returns uuid`
  - `update_resident_admission_case(p_case_id uuid, p_expected_updated_at timestamptz, p_admit_date date, p_age_years smallint, p_sex text, p_diagnosis text, p_management text, p_operation text, p_unit_name text, p_status text, p_owner_id uuid) returns timestamptz`
  - `soft_delete_resident_admission_case(p_case_id uuid, p_expected_updated_at timestamptz) returns void`
  - `admin_purge_resident_admission_case(p_case_id uuid) returns text[]`
  - `add_resident_case_media(p_case_id uuid, p_storage_path text, p_caption text) returns uuid`
  - `delete_resident_case_media(p_media_id uuid) returns void`
  - `add_resident_case_note(p_case_id uuid, p_body text) returns uuid`
  - `edit_resident_case_note(p_note_id uuid, p_body text) returns void`
  - `delete_resident_case_note(p_note_id uuid) returns void`
  - `list_resident_case_people() returns table(user_id uuid, full_name text, role text, active boolean)`
  - Tables `resident_admission_cases`, `resident_case_media`, `resident_case_notes`; bucket `resident-case-media`. Conflict error message starts with `CASE_CONFLICT`. Other messages contain `cannot edit`, `cannot delete`, `cannot change`, or `not found`.

- [ ] **Step 1: Write the failing migration test**

Create `tests/resident-cases-migration.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const FILE = new URL("../supabase/migrations/20261002090000_resident_admission_cases.sql", import.meta.url);
const read = () => readFile(FILE, "utf8");

test("tables are additive, constrained and have RLS enabled", async () => {
  const sql = await read();
  for (const table of ["resident_admission_cases", "resident_case_media", "resident_case_notes"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant select on public\\.${table} to authenticated`));
  }
  assert.doesNotMatch(sql, /drop table|alter table public\.resident_(assessment|profiles|user_roles|round|exam)/i);
  assert.match(sql, /admit_date >= date '2020-01-01' and admit_date <= \(\(now\(\) at time zone 'Asia\/Bangkok'\)::date\)/);
  assert.match(sql, /unit_name in \('Upper GI', 'General surgery', 'HBP'\)/);
  assert.match(sql, /status in \('admit', 'discharged', 'pending_update'\)/);
  assert.match(sql, /sex in \('male', 'female', 'unspecified'\)/);
  assert.doesNotMatch(sql, /patient_name|\bhn\b/i);
});

test("authenticated gets no write grants and no policy allows writes", async () => {
  const sql = await read();
  assert.doesNotMatch(sql, /grant (insert|update|delete)/i);
  assert.doesNotMatch(sql, /create policy [a-z_]+ on public\.resident_(admission_cases|case_media|case_notes)\s+for (insert|update|delete|all)/i);
});

test("active membership is checked through role and profile", async () => {
  const sql = await read();
  assert.match(sql, /function private\.resident_case_member\(\)/);
  assert.match(sql, /r\.active and p\.active/);
  assert.match(sql, /grant execute on function private\.resident_case_member\(\) to authenticated/);
  assert.match(sql, /grant execute on function private\.resident_can_edit_case\(uuid\) to authenticated/);
});

test("every RPC is security definer with an empty search_path and not callable by anon", async () => {
  const sql = await read();
  const rpcs = [
    "create_resident_admission_case(date, smallint, text, text, text, text, text, text, uuid)",
    "update_resident_admission_case(uuid, timestamptz, date, smallint, text, text, text, text, text, text, uuid)",
    "soft_delete_resident_admission_case(uuid, timestamptz)",
    "admin_purge_resident_admission_case(uuid)",
    "add_resident_case_media(uuid, text, text)",
    "delete_resident_case_media(uuid)",
    "add_resident_case_note(uuid, text)",
    "edit_resident_case_note(uuid, text)",
    "delete_resident_case_note(uuid)",
    "list_resident_case_people()",
  ];
  for (const rpc of rpcs) {
    const escaped = rpc.replace(/[()]/g, "\\$&");
    assert.match(sql, new RegExp(`revoke all on function public\\.${escaped} from public, anon`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${escaped} to authenticated`));
  }
  const definitions = sql.match(/create or replace function public\.[\s\S]*?\n\$\$;/g) || [];
  assert.equal(definitions.length, rpcs.length);
  for (const definition of definitions) {
    assert.match(definition, /security definer set search_path = ''/);
  }
});

test("update and soft delete use the optimistic updated_at check", async () => {
  const sql = await read();
  const update = sql.slice(sql.indexOf("function public.update_resident_admission_case"));
  assert.match(update, /for update/);
  assert.match(update, /CASE_CONFLICT: this case was changed by someone else/);
  assert.match(update, /updated_by = auth\.uid\(\), updated_at = clock_timestamp\(\)/);
  const del = sql.slice(sql.indexOf("function public.soft_delete_resident_admission_case"));
  assert.match(del, /CASE_CONFLICT/);
  assert.match(del, /private\.resident_role_is\('admin'\)/);
  assert.match(del, /private\.resident_role_is\('resident'\)\) and v_case\.created_by = auth\.uid\(\)/);
});

test("purge is admin only and returns the storage paths", async () => {
  const sql = await read();
  const purge = sql.slice(sql.indexOf("function public.admin_purge_resident_admission_case"));
  assert.match(purge, /Active Admin account required/);
  assert.match(purge, /returns text\[\]/);
  assert.match(purge, /delete from public\.resident_admission_cases/);
});

test("bucket is private, 5 MB, images only, with scoped storage policies", async () => {
  const sql = await read();
  assert.match(sql, /'resident-case-media',\s*'resident-case-media',\s*false,\s*5242880,\s*array\['image\/jpeg', 'image\/png', 'image\/webp'\]/);
  assert.match(sql, /create policy resident_case_media_objects_select on storage\.objects/);
  assert.match(sql, /create policy resident_case_media_objects_insert on storage\.objects/);
  assert.match(sql, /create policy resident_case_media_objects_delete on storage\.objects/);
  assert.match(sql, /private\.resident_can_edit_case\(private\.resident_case_path_case_id\(name\)\)/);
  assert.doesNotMatch(sql, /on storage\.objects\s+for update/i);
});

test("media rows must point inside the case folder at an uploaded object", async () => {
  const sql = await read();
  const media = sql.slice(sql.indexOf("function public.add_resident_case_media"));
  assert.match(media, /left\(p_storage_path, 37\) <> p_case_id::text \|\| '\/'/);
  assert.match(media, /from storage\.objects o where o\.bucket_id = 'resident-case-media' and o\.name = p_storage_path/);
});

test("people list returns names only (no email)", async () => {
  const sql = await read();
  const people = sql.slice(sql.indexOf("function public.list_resident_case_people"));
  assert.doesNotMatch(people.slice(0, people.indexOf("$$;", 10)), /email/i);
});

test("migration runs in one transaction", async () => {
  const sql = await read();
  assert.match(sql, /^[\s\S]*\nbegin;\n[\s\S]*\ncommit;\s*$/);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/resident-cases-migration.test.mjs`
Expected: FAIL — `ENOENT ... 20261002090000_resident_admission_cases.sql`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261002090000_resident_admission_cases.sql`:

```sql
-- New admissions + Friday conference (phase 1).
-- Additive only: a sequence, 3 tables, helper functions, RPCs, a private
-- bucket and policies. authenticated users get SELECT only (filtered by RLS);
-- every write goes through a SECURITY DEFINER function that checks the role.
-- Apply on its own: npx --yes supabase db query --linked --file <this file>
-- (never `supabase db push`). Verify with tests/resident-cases-db.sql.
begin;

create sequence if not exists public.resident_admission_case_seq;
revoke all on sequence public.resident_admission_case_seq from public, anon, authenticated;

create table if not exists public.resident_admission_cases (
  id uuid primary key default gen_random_uuid(),
  case_code text not null unique default ('ADM-' || lpad(nextval('public.resident_admission_case_seq')::text, 5, '0')),
  admit_date date not null check (admit_date >= date '2020-01-01' and admit_date <= ((now() at time zone 'Asia/Bangkok')::date)),
  age_years smallint not null check (age_years between 0 and 120),
  sex text not null check (sex in ('male', 'female', 'unspecified')),
  diagnosis text not null check (char_length(btrim(diagnosis)) between 1 and 180),
  management text not null default '' check (char_length(management) <= 1000),
  operation text not null default '' check (char_length(operation) <= 180),
  unit_name text not null check (unit_name in ('Upper GI', 'General surgery', 'HBP')),
  status text not null default 'admit' check (status in ('admit', 'discharged', 'pending_update')),
  owner_id uuid not null references public.resident_profiles(user_id),
  created_by uuid not null references public.resident_profiles(user_id),
  updated_by uuid not null references public.resident_profiles(user_id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz
);

create table if not exists public.resident_case_media (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.resident_admission_cases(id),
  storage_path text not null unique check (char_length(btrim(storage_path)) between 1 and 500),
  caption text not null default '' check (char_length(caption) <= 200),
  created_by uuid not null references public.resident_profiles(user_id),
  created_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz
);

create table if not exists public.resident_case_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.resident_admission_cases(id),
  author_id uuid not null references public.resident_profiles(user_id),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default clock_timestamp(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index if not exists resident_admission_cases_admit_date_idx on public.resident_admission_cases(admit_date desc);
create index if not exists resident_admission_cases_status_idx on public.resident_admission_cases(status);
create index if not exists resident_admission_cases_owner_idx on public.resident_admission_cases(owner_id);
create index if not exists resident_admission_cases_created_by_idx on public.resident_admission_cases(created_by);
create index if not exists resident_admission_cases_updated_by_idx on public.resident_admission_cases(updated_by);
create index if not exists resident_case_media_case_idx on public.resident_case_media(case_id);
create index if not exists resident_case_media_created_by_idx on public.resident_case_media(created_by);
create index if not exists resident_case_notes_case_idx on public.resident_case_notes(case_id, created_at);
create index if not exists resident_case_notes_author_idx on public.resident_case_notes(author_id);

-- Helpers -------------------------------------------------------------------
create or replace function private.resident_case_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.resident_user_roles r
    join public.resident_profiles p on p.user_id = r.user_id
    where r.user_id = (select auth.uid()) and r.active and p.active
  );
$$;

create or replace function private.resident_can_edit_case(p_case_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select private.resident_case_member()) and exists (
    select 1 from public.resident_admission_cases c
    join public.resident_user_roles r on r.user_id = (select auth.uid()) and r.active
    where c.id = p_case_id and c.deleted_at is null
      and (r.role in ('staff', 'admin') or c.created_by = r.user_id or c.owner_id = r.user_id)
  );
$$;

create or replace function private.resident_case_path_case_id(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(p_name))[1])::uuid
  end;
$$;

create or replace function private.resident_case_assert_owner(p_owner_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.resident_user_roles r
    join public.resident_profiles p on p.user_id = r.user_id
    where r.user_id = p_owner_id and r.role = 'resident' and r.active and p.active
  ) then
    raise exception 'Owner must be an active Resident';
  end if;
end;
$$;

revoke all on function private.resident_case_member() from public, anon;
revoke all on function private.resident_can_edit_case(uuid) from public, anon;
revoke all on function private.resident_case_path_case_id(text) from public, anon;
revoke all on function private.resident_case_assert_owner(uuid) from public, anon, authenticated;
grant execute on function private.resident_case_member() to authenticated;
grant execute on function private.resident_can_edit_case(uuid) to authenticated;
grant execute on function private.resident_case_path_case_id(text) to authenticated;

-- RLS: SELECT only -----------------------------------------------------------
alter table public.resident_admission_cases enable row level security;
alter table public.resident_case_media enable row level security;
alter table public.resident_case_notes enable row level security;
revoke all on public.resident_admission_cases from public, anon, authenticated;
revoke all on public.resident_case_media from public, anon, authenticated;
revoke all on public.resident_case_notes from public, anon, authenticated;
grant select on public.resident_admission_cases to authenticated;
grant select on public.resident_case_media to authenticated;
grant select on public.resident_case_notes to authenticated;

drop policy if exists resident_admission_cases_select on public.resident_admission_cases;
create policy resident_admission_cases_select on public.resident_admission_cases
  for select to authenticated using (
    (select private.resident_case_member())
    and (deleted_at is null or (select private.resident_role_is('admin')))
  );

drop policy if exists resident_case_media_select on public.resident_case_media;
create policy resident_case_media_select on public.resident_case_media
  for select to authenticated using (
    (select private.resident_case_member())
    and (deleted_at is null or (select private.resident_role_is('admin')))
    and exists (select 1 from public.resident_admission_cases c where c.id = case_id)
  );

drop policy if exists resident_case_notes_select on public.resident_case_notes;
create policy resident_case_notes_select on public.resident_case_notes
  for select to authenticated using (
    (select private.resident_case_member())
    and (deleted_at is null or (select private.resident_role_is('admin')))
    and exists (select 1 from public.resident_admission_cases c where c.id = case_id)
  );

-- Storage: private bucket for case images -----------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resident-case-media',
  'resident-case-media',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists resident_case_media_objects_select on storage.objects;
create policy resident_case_media_objects_select on storage.objects
  for select to authenticated
  using (bucket_id = 'resident-case-media' and (select private.resident_case_member()));

drop policy if exists resident_case_media_objects_insert on storage.objects;
create policy resident_case_media_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'resident-case-media'
    and (select private.resident_can_edit_case(private.resident_case_path_case_id(name)))
  );

-- Admin may delete any object (purge). The uploader may delete only an object
-- that no media row references yet (cleanup after a failed attach).
drop policy if exists resident_case_media_objects_delete on storage.objects;
create policy resident_case_media_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'resident-case-media'
    and (
      (select private.resident_role_is('admin'))
      or (
        owner_id = (select auth.uid())::text
        and not exists (select 1 from public.resident_case_media m where m.storage_path = name)
      )
    )
  );

-- RPCs ----------------------------------------------------------------------
create or replace function public.create_resident_admission_case(
  p_admit_date date, p_age_years smallint, p_sex text, p_diagnosis text,
  p_management text, p_operation text, p_unit_name text, p_status text, p_owner_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not (select private.resident_case_member()) then
    raise exception 'Active Resident, Staff or Admin account required';
  end if;
  perform private.resident_case_assert_owner(p_owner_id);
  insert into public.resident_admission_cases
    (admit_date, age_years, sex, diagnosis, management, operation, unit_name, status, owner_id, created_by, updated_by)
  values
    (p_admit_date, p_age_years, p_sex, btrim(p_diagnosis), coalesce(p_management, ''), coalesce(p_operation, ''),
     p_unit_name, p_status, p_owner_id, auth.uid(), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_resident_admission_case(
  p_case_id uuid, p_expected_updated_at timestamptz,
  p_admit_date date, p_age_years smallint, p_sex text, p_diagnosis text,
  p_management text, p_operation text, p_unit_name text, p_status text, p_owner_id uuid
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_case public.resident_admission_cases%rowtype;
  v_updated timestamptz;
begin
  if not (select private.resident_case_member()) then
    raise exception 'Active Resident, Staff or Admin account required';
  end if;
  select * into v_case from public.resident_admission_cases
  where id = p_case_id and deleted_at is null for update;
  if not found then raise exception 'Case not found'; end if;
  if not (select private.resident_can_edit_case(p_case_id)) then
    raise exception 'You cannot edit this case';
  end if;
  if v_case.updated_at is distinct from p_expected_updated_at then
    raise exception 'CASE_CONFLICT: this case was changed by someone else';
  end if;
  perform private.resident_case_assert_owner(p_owner_id);
  update public.resident_admission_cases set
    admit_date = p_admit_date, age_years = p_age_years, sex = p_sex,
    diagnosis = btrim(p_diagnosis), management = coalesce(p_management, ''),
    operation = coalesce(p_operation, ''), unit_name = p_unit_name, status = p_status,
    owner_id = p_owner_id, updated_by = auth.uid(), updated_at = clock_timestamp()
  where id = p_case_id
  returning updated_at into v_updated;
  return v_updated;
end;
$$;

create or replace function public.soft_delete_resident_admission_case(
  p_case_id uuid, p_expected_updated_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_case public.resident_admission_cases%rowtype;
begin
  if not (select private.resident_case_member()) then
    raise exception 'Active Resident, Staff or Admin account required';
  end if;
  select * into v_case from public.resident_admission_cases
  where id = p_case_id and deleted_at is null for update;
  if not found then raise exception 'Case not found'; end if;
  if not (
    (select private.resident_role_is('admin'))
    or ((select private.resident_role_is('resident')) and v_case.created_by = auth.uid())
  ) then
    raise exception 'You cannot delete this case';
  end if;
  if v_case.updated_at is distinct from p_expected_updated_at then
    raise exception 'CASE_CONFLICT: this case was changed by someone else';
  end if;
  update public.resident_admission_cases
  set deleted_at = clock_timestamp(), updated_by = auth.uid(), updated_at = clock_timestamp()
  where id = p_case_id;
end;
$$;

create or replace function public.admin_purge_resident_admission_case(p_case_id uuid)
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  v_paths text[];
begin
  if not (select private.resident_role_is('admin')) then
    raise exception 'Active Admin account required';
  end if;
  if not exists (select 1 from public.resident_admission_cases where id = p_case_id) then
    raise exception 'Case not found';
  end if;
  select coalesce(array_agg(storage_path), '{}') into v_paths
  from public.resident_case_media where case_id = p_case_id;
  delete from public.resident_case_notes where case_id = p_case_id;
  delete from public.resident_case_media where case_id = p_case_id;
  delete from public.resident_admission_cases where id = p_case_id;
  return v_paths;
end;
$$;

create or replace function public.add_resident_case_media(
  p_case_id uuid, p_storage_path text, p_caption text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not (select private.resident_can_edit_case(p_case_id)) then
    raise exception 'You cannot edit this case';
  end if;
  if p_storage_path is null or left(p_storage_path, 37) <> p_case_id::text || '/' then
    raise exception 'Image path must be inside the case folder';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'resident-case-media' and o.name = p_storage_path) then
    raise exception 'Image file was not uploaded';
  end if;
  insert into public.resident_case_media (case_id, storage_path, caption, created_by)
  values (p_case_id, p_storage_path, left(btrim(coalesce(p_caption, '')), 200), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_resident_case_media(p_media_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.resident_case_media
  set deleted_at = clock_timestamp()
  where id = p_media_id and deleted_at is null
    and (select private.resident_case_member())
    and (created_by = auth.uid() or (select private.resident_role_is('admin')));
  if not found then raise exception 'Image not found or you cannot delete it'; end if;
end;
$$;

create or replace function public.add_resident_case_note(p_case_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if not (select private.resident_case_member()) then
    raise exception 'Active Resident, Staff or Admin account required';
  end if;
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'Note must be 1-2000 characters';
  end if;
  if not exists (select 1 from public.resident_admission_cases where id = p_case_id and deleted_at is null) then
    raise exception 'Case not found';
  end if;
  insert into public.resident_case_notes (case_id, author_id, body)
  values (p_case_id, auth.uid(), v_body)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.edit_resident_case_note(p_note_id uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
begin
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'Note must be 1-2000 characters';
  end if;
  update public.resident_case_notes
  set body = v_body, edited_at = clock_timestamp()
  where id = p_note_id and deleted_at is null and author_id = auth.uid()
    and (select private.resident_case_member());
  if not found then raise exception 'Note not found or you cannot change it'; end if;
end;
$$;

create or replace function public.delete_resident_case_note(p_note_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.resident_case_notes
  set deleted_at = clock_timestamp()
  where id = p_note_id and deleted_at is null
    and (select private.resident_case_member())
    and (author_id = auth.uid() or (select private.resident_role_is('admin')));
  if not found then raise exception 'Note not found or you cannot change it'; end if;
end;
$$;

create or replace function public.list_resident_case_people()
returns table (user_id uuid, full_name text, role text, active boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.resident_case_member()) then
    raise exception 'Active Resident, Staff or Admin account required';
  end if;
  return query
    select p.user_id, p.full_name, r.role::text, (r.active and p.active)
    from public.resident_profiles p
    join public.resident_user_roles r on r.user_id = p.user_id
    order by p.full_name, p.user_id;
end;
$$;

revoke all on function public.create_resident_admission_case(date, smallint, text, text, text, text, text, text, uuid) from public, anon;
revoke all on function public.update_resident_admission_case(uuid, timestamptz, date, smallint, text, text, text, text, text, text, uuid) from public, anon;
revoke all on function public.soft_delete_resident_admission_case(uuid, timestamptz) from public, anon;
revoke all on function public.admin_purge_resident_admission_case(uuid) from public, anon;
revoke all on function public.add_resident_case_media(uuid, text, text) from public, anon;
revoke all on function public.delete_resident_case_media(uuid) from public, anon;
revoke all on function public.add_resident_case_note(uuid, text) from public, anon;
revoke all on function public.edit_resident_case_note(uuid, text) from public, anon;
revoke all on function public.delete_resident_case_note(uuid) from public, anon;
revoke all on function public.list_resident_case_people() from public, anon;
grant execute on function public.create_resident_admission_case(date, smallint, text, text, text, text, text, text, uuid) to authenticated;
grant execute on function public.update_resident_admission_case(uuid, timestamptz, date, smallint, text, text, text, text, text, text, uuid) to authenticated;
grant execute on function public.soft_delete_resident_admission_case(uuid, timestamptz) to authenticated;
grant execute on function public.admin_purge_resident_admission_case(uuid) to authenticated;
grant execute on function public.add_resident_case_media(uuid, text, text) to authenticated;
grant execute on function public.delete_resident_case_media(uuid) to authenticated;
grant execute on function public.add_resident_case_note(uuid, text) to authenticated;
grant execute on function public.edit_resident_case_note(uuid, text) to authenticated;
grant execute on function public.delete_resident_case_note(uuid) to authenticated;
grant execute on function public.list_resident_case_people() to authenticated;

-- Fail the migration if a grant is wrong.
do $$
begin
  if has_function_privilege('anon', 'public.create_resident_admission_case(date, smallint, text, text, text, text, text, text, uuid)'::regprocedure, 'EXECUTE')
    or has_function_privilege('anon', 'public.list_resident_case_people()'::regprocedure, 'EXECUTE')
    or has_table_privilege('authenticated', 'public.resident_admission_cases', 'INSERT')
    or has_table_privilege('authenticated', 'public.resident_case_notes', 'UPDATE')
  then
    raise exception 'Resident case grant regression';
  end if;
end;
$$;

commit;
```

- [ ] **Step 4: Run the migration test and confirm it passes**

Run: `node --test tests/resident-cases-migration.test.mjs`
Expected: all tests PASS. If a regex fails because of whitespace, fix the SQL text (not the intent) and re-run.

- [ ] **Step 5: Write the read-only database check**

Create `tests/resident-cases-db.sql`:

```sql
-- Run read-only against the linked Resident database AFTER the migration:
-- npx --yes supabase db query --linked --file tests/resident-cases-db.sql
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.resident_admission_cases'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.resident_case_media'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.resident_case_notes'::regclass)
  then raise exception 'Resident case RLS regression'; end if;

  if not exists (
    select 1 from storage.buckets
    where id = 'resident-case-media' and public = false and file_size_limit = 5242880
      and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  ) then raise exception 'Case media bucket regression'; end if;

  if has_table_privilege('authenticated', 'public.resident_admission_cases', 'insert')
    or has_table_privilege('authenticated', 'public.resident_admission_cases', 'update')
    or has_table_privilege('authenticated', 'public.resident_admission_cases', 'delete')
    or has_table_privilege('authenticated', 'public.resident_case_media', 'insert')
    or has_table_privilege('authenticated', 'public.resident_case_media', 'update')
    or has_table_privilege('authenticated', 'public.resident_case_notes', 'insert')
    or has_table_privilege('authenticated', 'public.resident_case_notes', 'update')
    or has_table_privilege('anon', 'public.resident_admission_cases', 'select')
  then raise exception 'Resident case table grant regression'; end if;

  if has_function_privilege('anon', 'public.create_resident_admission_case(date, smallint, text, text, text, text, text, text, uuid)', 'execute')
    or has_function_privilege('anon', 'public.update_resident_admission_case(uuid, timestamptz, date, smallint, text, text, text, text, text, text, uuid)', 'execute')
    or has_function_privilege('anon', 'public.soft_delete_resident_admission_case(uuid, timestamptz)', 'execute')
    or has_function_privilege('anon', 'public.admin_purge_resident_admission_case(uuid)', 'execute')
    or has_function_privilege('anon', 'public.add_resident_case_media(uuid, text, text)', 'execute')
    or has_function_privilege('anon', 'public.add_resident_case_note(uuid, text)', 'execute')
    or has_function_privilege('anon', 'public.list_resident_case_people()', 'execute')
  then raise exception 'Resident case function grant regression'; end if;

  if not has_function_privilege('authenticated', 'public.create_resident_admission_case(date, smallint, text, text, text, text, text, text, uuid)', 'execute')
    or not has_function_privilege('authenticated', 'private.resident_case_member()', 'execute')
  then raise exception 'Authenticated must execute case RPCs and RLS helpers'; end if;

  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'resident_case_media_objects_%') <> 3
  then raise exception 'Case media storage policy count regression'; end if;

  if exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename in ('resident_admission_cases', 'resident_case_media', 'resident_case_notes')
      and cmd <> 'SELECT'
  ) then raise exception 'Case tables must have SELECT policies only'; end if;
end;
$$;
select 'resident cases db checks passed' as result;
```

- [ ] **Step 6: Write the rollback behaviour test**

Create `tests/resident-cases-rls-rollback.sql`:

```sql
-- Behaviour test for the Resident case RPCs. Everything runs in ONE transaction
-- that always ends in ROLLBACK, so no case/note data is kept (a sequence number
-- is consumed; that gap is harmless). Needs at least one active Admin, Staff and
-- Resident account. The owner runs it after the migration:
-- npx --yes supabase db query --linked --file tests/resident-cases-rls-rollback.sql
begin;

create function public.zz_act_as(p_user uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function public.zz_reset() returns void language plpgsql as $$
begin
  execute 'reset role';
end;
$$;

create function public.zz_upd(p_case uuid, p_ts timestamptz, p_dx text, p_owner uuid)
returns timestamptz language sql as $$
  select public.update_resident_admission_case(
    p_case, p_ts, (now() at time zone 'Asia/Bangkok')::date, 60::smallint, 'male',
    p_dx, 'mgmt', '', 'Upper GI', 'admit', p_owner);
$$;

do $$
declare
  v_admin uuid; v_staff uuid; v_res uuid; v_res2 uuid;
  v_case uuid; v_ts timestamptz; v_ts2 timestamptz; v_ts3 timestamptz;
  v_note uuid; v_count int; v_paths text[];
begin
  select user_id into v_admin from public.resident_user_roles where role = 'admin' and active limit 1;
  select user_id into v_staff from public.resident_user_roles where role = 'staff' and active limit 1;
  select user_id into v_res from public.resident_user_roles where role = 'resident' and active limit 1;
  select user_id into v_res2 from public.resident_user_roles where role = 'resident' and active and user_id <> v_res limit 1;
  if v_admin is null or v_staff is null or v_res is null then
    raise exception 'Need one active Admin, Staff and Resident account to run this test';
  end if;

  -- Resident creates a case and edits it.
  perform public.zz_act_as(v_res);
  v_case := public.create_resident_admission_case(
    (now() at time zone 'Asia/Bangkok')::date, 64::smallint, 'female', 'TEST dx', 'mgmt', '', 'Upper GI', 'admit', v_res);
  select updated_at into v_ts from public.resident_admission_cases where id = v_case;
  v_ts2 := public.zz_upd(v_case, v_ts, 'TEST dx 2', v_res);
  if v_ts2 <= v_ts then raise exception 'updated_at must advance'; end if;

  -- Stale save is refused (two windows editing the same case).
  begin
    perform public.zz_upd(v_case, v_ts, 'stale', v_res);
    raise exception 'EXPECTED FAILURE: stale update succeeded';
  exception when others then
    if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
    if sqlerrm not like 'CASE_CONFLICT%' then raise exception 'wrong error for stale update: %', sqlerrm; end if;
  end;

  -- Direct table writes are not possible.
  begin
    insert into public.resident_admission_cases (admit_date, age_years, sex, diagnosis, unit_name, owner_id, created_by, updated_by)
    values (current_date, 1, 'male', 'direct', 'HBP', v_res, v_res, v_res);
    raise exception 'EXPECTED FAILURE: direct insert succeeded';
  exception when others then
    if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
    if sqlerrm not like '%permission denied%' then raise exception 'wrong error for direct insert: %', sqlerrm; end if;
  end;

  -- Another Resident (not creator, not owner) cannot edit.
  if v_res2 is not null then
    perform public.zz_act_as(v_res2);
    begin
      perform public.zz_upd(v_case, v_ts2, 'hijack', v_res);
      raise exception 'EXPECTED FAILURE: other resident edited';
    exception when others then
      if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
      if sqlerrm not like '%cannot edit%' then raise exception 'wrong error for other resident: %', sqlerrm; end if;
    end;
    perform public.zz_act_as(v_res);
  end if;

  -- Staff can edit any case but cannot delete it.
  perform public.zz_act_as(v_staff);
  v_ts3 := public.zz_upd(v_case, v_ts2, 'edited by staff', v_res);
  begin
    perform public.soft_delete_resident_admission_case(v_case, v_ts3);
    raise exception 'EXPECTED FAILURE: staff deleted a case';
  exception when others then
    if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
    if sqlerrm not like '%cannot delete%' then raise exception 'wrong error for staff delete: %', sqlerrm; end if;
  end;

  -- Notes: both authors add; only the author edits; admin may delete any.
  perform public.add_resident_case_note(v_case, 'staff note');
  perform public.zz_act_as(v_res);
  v_note := public.add_resident_case_note(v_case, 'resident note');
  select count(*) into v_count from public.resident_case_notes where case_id = v_case;
  if v_count <> 2 then raise exception 'expected 2 notes, got %', v_count; end if;
  perform public.zz_act_as(v_staff);
  begin
    perform public.edit_resident_case_note(v_note, 'tamper');
    raise exception 'EXPECTED FAILURE: staff edited resident note';
  exception when others then
    if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
    if sqlerrm not like '%cannot change%' then raise exception 'wrong error for note edit: %', sqlerrm; end if;
  end;
  perform public.zz_act_as(v_admin);
  perform public.delete_resident_case_note(v_note);

  -- Resident (creator) soft-deletes: hidden from Residents, still visible to Admin.
  perform public.zz_act_as(v_res);
  select updated_at into v_ts from public.resident_admission_cases where id = v_case;
  perform public.soft_delete_resident_admission_case(v_case, v_ts);
  select count(*) into v_count from public.resident_admission_cases where id = v_case;
  if v_count <> 0 then raise exception 'soft-deleted case still visible to Resident'; end if;
  perform public.zz_act_as(v_admin);
  select count(*) into v_count from public.resident_admission_cases where id = v_case;
  if v_count <> 1 then raise exception 'Admin should still see the soft-deleted case'; end if;

  -- Only Admin purges.
  perform public.zz_act_as(v_staff);
  begin
    perform public.admin_purge_resident_admission_case(v_case);
    raise exception 'EXPECTED FAILURE: staff purged';
  exception when others then
    if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
    if sqlerrm not like '%Admin account required%' then raise exception 'wrong error for purge: %', sqlerrm; end if;
  end;
  perform public.zz_act_as(v_admin);
  v_paths := public.admin_purge_resident_admission_case(v_case);
  select count(*) into v_count from public.resident_admission_cases where id = v_case;
  if v_count <> 0 then raise exception 'purge left the case behind'; end if;

  perform public.zz_reset();
  raise notice 'resident cases behaviour checks passed';
end;
$$;

rollback;
```

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: all green, including the two new test files. (The two `.sql` files are not run by `node --test`.)

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261002090000_resident_admission_cases.sql tests/resident-cases-migration.test.mjs tests/resident-cases-db.sql tests/resident-cases-rls-rollback.sql
git commit -m $'feat: add admission cases migration with RPC-only writes and private image bucket\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_019U9dRCDpwvXnbJPN6TtMSZ'
```

Note for the executor: this migration and the two SQL tests **cannot be run locally** (no Postgres/Deno here). Do not apply anything to production; Task 7 hands that to the owner.

---

### Task 3: Data layer (`src/residentCasesApi.js`)

**Files:**
- Create: `src/residentCasesApi.js`
- Test: `tests/resident-cases-api.test.mjs`

**Interfaces:**
- Consumes: `supabase` (`src/supabase.js`), `fetchAllRows` (`src/supabasePaging.js`), from `src/residentCases.js`: `CASE_IMAGE_MAX_BYTES`, `CASE_IMAGE_MAX_EDGE`, `CASE_IMAGE_QUALITY`, `caseImagePath`, `scaledSize`, `validateCaseImageFile`; RPCs from Task 2.
- Produces (used by Tasks 4–5). Case row shape from `loadAdmissionCases`: `{ id, case_code, admit_date, age_years, sex, diagnosis, management, operation, unit_name, status, owner_id, created_by, updated_by, created_at, updated_at, media_count }`.
  - `loadCasePeople(): Promise<{user_id, full_name, role, active}[]>`
  - `loadAdmissionCases({ from?, to? } = {}): Promise<row[]>` (ordered `admit_date desc, case_code desc`, soft-deleted excluded)
  - `createAdmissionCase(form): Promise<string>` (new id)
  - `updateAdmissionCase(caseId, expectedUpdatedAt, form): Promise<string>` (new `updated_at`)
  - `softDeleteAdmissionCase(caseId, expectedUpdatedAt): Promise<void>`
  - `purgeAdmissionCase(caseId): Promise<void>`
  - `loadCaseMedia(caseId): Promise<{id, storage_path, caption, created_by, created_at, url}[]>`
  - `prepareCaseImage(file): Promise<Blob>`; `uploadCaseImage(caseId, file, caption?): Promise<string>`; `deleteCaseMedia(mediaId): Promise<void>`
  - `loadCaseNotes(caseId): Promise<{id, case_id, author_id, body, created_at, edited_at}[]>`; `addCaseNote(caseId, body)`; `editCaseNote(noteId, body)`; `deleteCaseNote(noteId)`
  - `form` is `{ admit_date, age_years, sex, diagnosis, management, operation, unit_name, status, owner_id }`. `expectedUpdatedAt` must be passed through **as the string the server returned** (never via `Date`, which would truncate microseconds and cause false conflicts).

- [ ] **Step 1: Write the failing test**

Create `tests/resident-cases-api.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const api = () => readFile(new URL("../src/residentCasesApi.js", import.meta.url), "utf8");

test("every write goes through an RPC, never a direct table write", async () => {
  const src = await api();
  for (const rpc of [
    "create_resident_admission_case", "update_resident_admission_case", "soft_delete_resident_admission_case",
    "admin_purge_resident_admission_case", "add_resident_case_media", "delete_resident_case_media",
    "add_resident_case_note", "edit_resident_case_note", "delete_resident_case_note", "list_resident_case_people",
  ]) assert.match(src, new RegExp(`"${rpc}"`));
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(\s*[{\[]/);
  assert.doesNotMatch(src, /from\("resident_(admission_cases|case_media|case_notes)"\)\s*\.(insert|update|delete)/);
});

test("expected updated_at is passed through untouched", async () => {
  const src = await api();
  assert.match(src, /p_expected_updated_at: expectedUpdatedAt/);
  assert.doesNotMatch(src, /new Date\(expectedUpdatedAt\)/);
  assert.doesNotMatch(src, /toISOString\(\)/);
});

test("image upload re-encodes, never reuses the file name, and cleans up on failure", async () => {
  const src = await api();
  assert.match(src, /upsert: false/);
  assert.match(src, /canvas\.toBlob\(resolve, "image\/jpeg", CASE_IMAGE_QUALITY\)/);
  assert.match(src, /p_caption: caption \|\| ""/);
  assert.doesNotMatch(src, /file\.name/);
  assert.match(src, /\.remove\(\[path\]\)/);
  assert.match(src, /createSignedUrls\(/);
});

test("list queries exclude soft-deleted rows and have a deterministic order", async () => {
  const src = await api();
  assert.match(src, /\.is\("deleted_at", null\)/);
  assert.match(src, /order\("admit_date", \{ ascending: false \}\)\s*\.order\("case_code", \{ ascending: false \}\)/);
  assert.match(src, /\.order\("created_at", \{ ascending: true \}\)\s*\.order\("id"\)/);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/resident-cases-api.test.mjs`
Expected: FAIL — `ENOENT ... src/residentCasesApi.js`.

- [ ] **Step 3: Write the implementation**

Create `src/residentCasesApi.js`:

```js
import { supabase } from "./supabase";
import { fetchAllRows } from "./supabasePaging";
import { CASE_IMAGE_MAX_BYTES, CASE_IMAGE_MAX_EDGE, CASE_IMAGE_QUALITY, caseImagePath, scaledSize, validateCaseImageFile } from "./residentCases";

const MEDIA_BUCKET = "resident-case-media";
const SIGNED_URL_SECONDS = 10 * 60;
const CASE_COLUMNS = "id,case_code,admit_date,age_years,sex,diagnosis,management,operation,unit_name,status,owner_id,created_by,updated_by,created_at,updated_at";
const fail = (error) => {
  if (error) throw error;
};

const caseArgs = (form) => ({
  p_admit_date: form.admit_date,
  p_age_years: Number(form.age_years),
  p_sex: form.sex,
  p_diagnosis: String(form.diagnosis || "").trim(),
  p_management: form.management || "",
  p_operation: form.operation || "",
  p_unit_name: form.unit_name,
  p_status: form.status,
  p_owner_id: form.owner_id,
});

// Names only (no email), including deactivated accounts so old authors resolve.
export async function loadCasePeople() {
  const { data, error } = await supabase.rpc("list_resident_case_people");
  fail(error);
  return data || [];
}

export async function loadAdmissionCases({ from, to } = {}) {
  const { data, error } = await fetchAllRows(() => {
    let query = supabase
      .from("resident_admission_cases")
      .select(`${CASE_COLUMNS},resident_case_media(id,deleted_at)`)
      .is("deleted_at", null);
    if (from) query = query.gte("admit_date", from);
    if (to) query = query.lte("admit_date", to);
    return query.order("admit_date", { ascending: false }).order("case_code", { ascending: false });
  });
  fail(error);
  return (data || []).map(({ resident_case_media: media, ...row }) => ({
    ...row,
    media_count: (media || []).filter((item) => !item.deleted_at).length,
  }));
}

export async function createAdmissionCase(form) {
  const { data, error } = await supabase.rpc("create_resident_admission_case", caseArgs(form));
  fail(error);
  return data;
}

export async function updateAdmissionCase(caseId, expectedUpdatedAt, form) {
  const { data, error } = await supabase.rpc("update_resident_admission_case", {
    p_case_id: caseId,
    p_expected_updated_at: expectedUpdatedAt,
    ...caseArgs(form),
  });
  fail(error);
  return data;
}

export async function softDeleteAdmissionCase(caseId, expectedUpdatedAt) {
  const { error } = await supabase.rpc("soft_delete_resident_admission_case", {
    p_case_id: caseId,
    p_expected_updated_at: expectedUpdatedAt,
  });
  fail(error);
}

// Admin only. The rows are already gone; removing the image files is cleanup,
// so a failure there is reported to the console and does not fail the purge.
export async function purgeAdmissionCase(caseId) {
  const { data: paths, error } = await supabase.rpc("admin_purge_resident_admission_case", { p_case_id: caseId });
  fail(error);
  if (paths?.length) {
    const { error: removeError } = await supabase.storage.from(MEDIA_BUCKET).remove(paths);
    if (removeError) console.warn("Could not remove purged case images", removeError);
  }
}

export async function loadCaseMedia(caseId) {
  const { data, error } = await supabase
    .from("resident_case_media")
    .select("id,storage_path,caption,created_by,created_at")
    .eq("case_id", caseId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .order("id");
  fail(error);
  const rows = data || [];
  if (!rows.length) return [];
  const { data: signed, error: signError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(rows.map((row) => row.storage_path), SIGNED_URL_SECONDS);
  fail(signError);
  const urls = new Map((signed || []).map((item) => [item.path, item.signedUrl]));
  return rows.map((row) => ({ ...row, url: urls.get(row.storage_path) || "" }));
}

// Re-encoding through a canvas drops EXIF/GPS metadata and bounds the size.
export async function prepareCaseImage(file) {
  const problem = validateCaseImageFile(file);
  if (problem) throw new Error(problem);
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height, CASE_IMAGE_MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", CASE_IMAGE_QUALITY));
    if (!blob) throw new Error("ไม่สามารถประมวลผลภาพนี้ได้");
    if (blob.size > CASE_IMAGE_MAX_BYTES) throw new Error("ภาพหลังบีบอัดยังใหญ่เกิน 5 MB");
    return blob;
  } finally {
    bitmap.close?.();
  }
}

// The caption is never taken from the file name: phone/camera file names can
// carry patient identifiers.
export async function uploadCaseImage(caseId, file, caption = "") {
  const blob = await prepareCaseImage(file);
  const path = caseImagePath(caseId);
  const { error: uploadError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });
  fail(uploadError);
  try {
    const { data, error } = await supabase.rpc("add_resident_case_media", {
      p_case_id: caseId,
      p_storage_path: path,
      p_caption: caption || "",
    });
    fail(error);
    return data;
  } catch (error) {
    await supabase.storage.from(MEDIA_BUCKET).remove([path]);
    throw error;
  }
}

export async function deleteCaseMedia(mediaId) {
  const { error } = await supabase.rpc("delete_resident_case_media", { p_media_id: mediaId });
  fail(error);
}

export async function loadCaseNotes(caseId) {
  const { data, error } = await supabase
    .from("resident_case_notes")
    .select("id,case_id,author_id,body,created_at,edited_at")
    .eq("case_id", caseId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .order("id");
  fail(error);
  return data || [];
}

export async function addCaseNote(caseId, body) {
  const { data, error } = await supabase.rpc("add_resident_case_note", { p_case_id: caseId, p_body: body });
  fail(error);
  return data;
}

export async function editCaseNote(noteId, body) {
  const { error } = await supabase.rpc("edit_resident_case_note", { p_note_id: noteId, p_body: body });
  fail(error);
}

export async function deleteCaseNote(noteId) {
  const { error } = await supabase.rpc("delete_resident_case_note", { p_note_id: noteId });
  fail(error);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test tests/resident-cases-api.test.mjs` then `npm test`
Expected: PASS; whole suite green. (`npm run build` is exercised in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add src/residentCasesApi.js tests/resident-cases-api.test.mjs
git commit -m $'feat: add data layer for resident admission cases\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_019U9dRCDpwvXnbJPN6TtMSZ'
```

---

### Task 4: Shared UI parts + New admissions screen

**Files:**
- Create: `src/features/CaseParts.jsx`
- Create: `src/features/ResidentCases.jsx`
- Modify: `src/resident.css` (append a `case-*` block)
- Test: `tests/resident-cases-ui.test.mjs`

**Interfaces:**
- Consumes: everything produced by Tasks 1 and 3; `XIcon`, `PlusIcon`, `ShieldIcon` from `src/components/Icons.jsx`; `bangkokIsoDate` from `src/roundSchedule.js`.
- Produces:
  - `CaseParts.jsx` named exports: `thaiDate(iso)`, `thaiDateTime(isoTimestamp)`, `personName(people, id)`, `CaseModal({ title, onClose, children })`, `CaseStatusChip({ status })`, `PrivacyNotice()`, `CaseNotes({ caseId, user, people })`.
  - `ResidentCases.jsx` default export `ResidentCases({ user, onPresent })` — `user` is `workspace.user` (`{id, role, name, pgy}`); `onPresent({ id, admit_date })` is called when the user clicks "นำเสนอเคสนี้".

- [ ] **Step 1: Write the failing UI source test**

Create `tests/resident-cases-ui.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("cases screen validates, blocks double submit, and handles conflicts", async () => {
  const ui = await read("src/features/ResidentCases.jsx");
  assert.match(ui, /validateCaseForm\(form\)/);
  assert.match(ui, /if \(busy\) return;/);
  assert.match(ui, /disabled=\{busy\}/);
  assert.match(ui, /isCaseConflict\(/);
  assert.match(ui, /โหลดข้อมูลล่าสุด/);
  assert.match(ui, /updateAdmissionCase\(initial\.id, initial\.updated_at, form\)/);
  assert.match(ui, /softDeleteAdmissionCase\(row\.id, row\.updated_at\)/);
});

test("cases screen gates actions with the permission helpers and warns about PHI", async () => {
  const ui = await read("src/features/ResidentCases.jsx");
  assert.match(ui, /canEditCase\(user, /);
  assert.match(ui, /canDeleteCase\(user, row\)/);
  assert.match(ui, /canDeleteMedia\(user, /);
  assert.match(ui, /user\.role === "admin"/);
  assert.match(ui, /<PrivacyNotice \/>/);
  const parts = await read("src/features/CaseParts.jsx");
  assert.match(parts, /ห้ามใส่ชื่อ-นามสกุล, HN/);
});

test("no patient identifier inputs exist", async () => {
  const ui = await read("src/features/ResidentCases.jsx");
  assert.doesNotMatch(ui, /name="(hn|patient_name|patient)"|label>\s*(HN|ชื่อผู้ป่วย)/i);
});

test("modal does not use a header element (resident-app header is styled green)", async () => {
  const parts = await read("src/features/CaseParts.jsx");
  assert.doesNotMatch(parts, /<header[\s>]/);
  assert.match(parts, /Escape/);
});

test("notes use the append-only RPC helpers and reload after each action", async () => {
  const parts = await read("src/features/CaseParts.jsx");
  assert.match(parts, /addCaseNote\(caseId, /);
  assert.match(parts, /editCaseNote\(/);
  assert.match(parts, /deleteCaseNote\(/);
  assert.match(parts, /canEditNote\(user, /);
  assert.match(parts, /canDeleteNote\(user, /);
  assert.match(parts, /seq\.current/);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/resident-cases-ui.test.mjs`
Expected: FAIL — `ENOENT ... src/features/ResidentCases.jsx`.

- [ ] **Step 3: Write `CaseParts.jsx`**

Create `src/features/CaseParts.jsx`:

```jsx
import React, { useEffect, useRef, useState } from "react";
import { ShieldIcon, XIcon } from "../components/Icons";
import { CASE_LIMITS, canDeleteNote, canEditNote, caseErrorMessage, caseStatusLabel } from "../residentCases";
import { addCaseNote, deleteCaseNote, editCaseNote, loadCaseNotes } from "../residentCasesApi";

export const thaiDate = (value) =>
  value ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(`${value}T12:00:00+07:00`)) : "—";
export const thaiDateTime = (value) =>
  value ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value)) : "—";
export const personName = (people, id) => people.find((person) => person.user_id === id)?.full_name || "ไม่ทราบชื่อ";

export function CaseModal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="case-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="case-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="case-modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="ปิด"><XIcon /></button>
        </div>
        <div className="case-modal-body">{children}</div>
      </section>
    </div>
  );
}

export function CaseStatusChip({ status }) {
  return <span className={`case-status case-status-${status}`}>{caseStatusLabel(status)}</span>;
}

export function PrivacyNotice() {
  return (
    <p className="case-privacy-note">
      <ShieldIcon size={16} /> ห้ามใส่ชื่อ-นามสกุล, HN หรือข้อมูลระบุตัวผู้ป่วยในช่องใดๆ รวมถึงในภาพ
    </p>
  );
}

// Append-only discussion notes: every author adds their own row, so two people
// typing at the same time never overwrite each other.
export function CaseNotes({ caseId, user, people }) {
  const [notes, setNotes] = useState(null);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const seq = useRef(0);

  async function reload() {
    const mine = ++seq.current;
    try {
      const rows = await loadCaseNotes(caseId);
      if (mine === seq.current) setNotes(rows);
    } catch (nextError) {
      if (mine === seq.current) setError(caseErrorMessage(nextError));
    }
  }
  useEffect(() => {
    setNotes(null);
    setEditing(null);
    setBody("");
    setError("");
    reload();
  }, [caseId]);

  async function run(action) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      await reload();
    } catch (nextError) {
      setError(caseErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="case-notes">
      <h3>ข้ออภิปราย / Learning points <span className="case-count">{notes?.length ?? "…"}</span></h3>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notes?.length === 0 && <p className="case-muted">ยังไม่มีโน้ต</p>}
      {(notes || []).map((note) => (
        <div className="case-note" key={note.id}>
          <small>
            {personName(people, note.author_id)} · {thaiDateTime(note.created_at)}
            {note.edited_at ? " · แก้ไขแล้ว" : ""}
          </small>
          {editing?.id === note.id ? (
            <>
              <textarea rows={2} maxLength={CASE_LIMITS.note} value={editing.body} onChange={(event) => setEditing({ id: note.id, body: event.target.value })} />
              <div className="button-row">
                <button type="button" className="primary-button" disabled={busy || !editing.body.trim()} onClick={() => run(async () => { await editCaseNote(note.id, editing.body); setEditing(null); })}>บันทึก</button>
                <button type="button" className="secondary-button" onClick={() => setEditing(null)}>ยกเลิก</button>
              </div>
            </>
          ) : (
            <>
              <p>{note.body}</p>
              <div className="button-row">
                {canEditNote(user, note) && <button type="button" className="link-button" onClick={() => setEditing({ id: note.id, body: note.body })}>แก้ไข</button>}
                {canDeleteNote(user, note) && (
                  <button type="button" className="link-button" disabled={busy} onClick={() => { if (window.confirm("ลบโน้ตนี้?")) run(() => deleteCaseNote(note.id)); }}>ลบ</button>
                )}
              </div>
            </>
          )}
        </div>
      ))}
      <label>
        เพิ่มโน้ต (ทุกคนจดพร้อมกันได้ ไม่ทับกัน)
        <textarea rows={2} maxLength={CASE_LIMITS.note} value={body} onChange={(event) => setBody(event.target.value)} placeholder="พิมพ์ประเด็นอภิปราย…" />
      </label>
      <div className="button-row">
        <button type="button" className="primary-button" disabled={busy || !body.trim()} onClick={() => run(async () => { await addCaseNote(caseId, body); setBody(""); })}>เพิ่มโน้ต</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write `ResidentCases.jsx`**

Create `src/features/ResidentCases.jsx`:

```jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { PlusIcon } from "../components/Icons";
import {
  CASE_LIMITS,
  CASE_MIN_ADMIT_DATE,
  CASE_SEXES,
  CASE_STATUSES,
  CASE_UNITS,
  canDeleteCase,
  canDeleteMedia,
  canEditCase,
  caseErrorMessage,
  caseSexLabel,
  isCaseConflict,
  validateCaseForm,
  validateCaseImageFile,
} from "../residentCases";
import { bangkokIsoDate } from "../roundSchedule";
import {
  createAdmissionCase,
  deleteCaseMedia,
  loadAdmissionCases,
  loadCaseMedia,
  loadCasePeople,
  purgeAdmissionCase,
  softDeleteAdmissionCase,
  updateAdmissionCase,
  uploadCaseImage,
} from "../residentCasesApi";
import { CaseModal, CaseStatusChip, PrivacyNotice, personName, thaiDate, thaiDateTime } from "./CaseParts";

const emptyForm = (user) => ({
  admit_date: bangkokIsoDate(),
  age_years: "",
  sex: "male",
  diagnosis: "",
  management: "",
  operation: "",
  unit_name: CASE_UNITS[0],
  status: "admit",
  owner_id: user.role === "resident" ? user.id : "",
});
const caseToForm = (row) => ({
  admit_date: row.admit_date,
  age_years: String(row.age_years),
  sex: row.sex,
  diagnosis: row.diagnosis,
  management: row.management,
  operation: row.operation,
  unit_name: row.unit_name,
  status: row.status,
  owner_id: row.owner_id,
});

function CaseForm({ user, people, initial, onSaved, onReload, onClose }) {
  const [form, setForm] = useState(() => (initial ? caseToForm(initial) : emptyForm(user)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const owners = useMemo(
    () => people.filter((person) => person.role === "resident" && (person.active || person.user_id === form.owner_id)),
    [people, form.owner_id],
  );
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const problem = validateCaseForm(form);
    if (problem) return setError(problem);
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      if (initial) await updateAdmissionCase(initial.id, initial.updated_at, form);
      else await createAdmissionCase(form);
      await onSaved();
    } catch (nextError) {
      setConflict(isCaseConflict(nextError));
      setError(caseErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="case-form" onSubmit={submit}>
      <PrivacyNotice />
      {error && <p className="form-error" role="alert">{error}</p>}
      {conflict && (
        <div className="button-row">
          <button type="button" className="secondary-button" onClick={async () => { await onReload(); onClose(); }}>โหลดข้อมูลล่าสุดและปิด</button>
        </div>
      )}
      <div className="case-grid">
        <label>วันที่รับ<input type="date" value={form.admit_date} min={CASE_MIN_ADMIT_DATE} max={bangkokIsoDate()} onChange={set("admit_date")} required /></label>
        <label>อายุ (ปี)<input type="number" inputMode="numeric" min={0} max={120} step={1} value={form.age_years} onChange={set("age_years")} required /></label>
        <label>เพศ<select value={form.sex} onChange={set("sex")}>{CASE_SEXES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>หน่วย<select value={form.unit_name} onChange={set("unit_name")}>{CASE_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
        <label className="case-full">Diagnosis<input maxLength={CASE_LIMITS.diagnosis} value={form.diagnosis} onChange={set("diagnosis")} required /></label>
        <label className="case-full">Management<textarea rows={2} maxLength={CASE_LIMITS.management} value={form.management} onChange={set("management")} /></label>
        <label className="case-full">Operation<input maxLength={CASE_LIMITS.operation} value={form.operation} onChange={set("operation")} /></label>
        <label>สถานะ<select value={form.status} onChange={set("status")}>{CASE_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Owner (Resident)
          <select value={form.owner_id} onChange={set("owner_id")} required>
            <option value="">เลือก Resident</option>
            {owners.map((person) => <option key={person.user_id} value={person.user_id}>{person.full_name}</option>)}
          </select>
        </label>
      </div>
      <div className="button-row case-actions">
        <button type="button" className="secondary-button" onClick={onClose}>ยกเลิก</button>
        <button type="submit" className="primary-button" disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึก"}</button>
      </div>
    </form>
  );
}

function CaseDetail({ user, people, row, onEdit, onPresent, onChanged, onClose }) {
  const [media, setMedia] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reloadMedia = useCallback(async () => {
    try {
      setMedia(await loadCaseMedia(row.id));
    } catch (nextError) {
      setError(caseErrorMessage(nextError));
    }
  }, [row.id]);
  useEffect(() => { reloadMedia(); }, [reloadMedia]);

  async function run(action) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (nextError) {
      setError(caseErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }
  async function onFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const problem = validateCaseImageFile(file);
    if (problem) return setError(problem);
    await run(async () => { await uploadCaseImage(row.id, file); await reloadMedia(); await onChanged(); });
  }

  const fields = [["Management", row.management], ["Operation", row.operation]];
  return (
    <>
      <p className="case-muted">{caseSexLabel(row.sex)} {row.age_years} ปี · {row.unit_name} · รับไว้ {thaiDate(row.admit_date)} · Owner: {personName(people, row.owner_id)}</p>
      <p><CaseStatusChip status={row.status} /> <small className="case-muted">แก้ล่าสุด {thaiDateTime(row.updated_at)} โดย {personName(people, row.updated_by)}</small></p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="case-split">
        <div>
          {fields.map(([label, value]) => <div className="case-field" key={label}><small>{label}</small>{value || "ยังไม่ระบุ"}</div>)}
          <div className="button-row">
            <button type="button" className="secondary-button" disabled={!canEditCase(user, row)} onClick={onEdit}>แก้ไขข้อมูล</button>
            <button type="button" className="primary-button" onClick={() => onPresent({ id: row.id, admit_date: row.admit_date })}>นำเสนอเคสนี้</button>
            {canDeleteCase(user, row) && (
              <button type="button" className="danger-button" disabled={busy} onClick={() => { if (window.confirm("ลบเคสนี้? (ซ่อนจากทุกคนยกเว้น Admin)")) run(async () => { await softDeleteAdmissionCase(row.id, row.updated_at); await onChanged(); onClose(); }); }}>ลบเคส</button>
            )}
            {user.role === "admin" && (
              <button type="button" className="danger-button" disabled={busy} onClick={() => { if (window.confirm("ลบถาวรพร้อมภาพและโน้ตทั้งหมด ไม่สามารถกู้คืนได้ ยืนยัน?")) run(async () => { await purgeAdmissionCase(row.id); await onChanged(); onClose(); }); }}>ลบถาวร</button>
            )}
          </div>
        </div>
        <div>
          <strong>ภาพแนบ ({media?.length ?? "…"})</strong>
          <div className="case-media">
            {(media || []).map((item, index) => (
              <figure key={item.id}>
                {item.url ? <img src={item.url} alt={item.caption || `ภาพ ${index + 1}`} /> : <div className="case-media-empty">โหลดภาพไม่สำเร็จ</div>}
                <figcaption>{item.caption || `ภาพ ${index + 1}`}
                  {canDeleteMedia(user, item) && <button type="button" className="link-button" disabled={busy} onClick={() => { if (window.confirm("ลบภาพนี้?")) run(async () => { await deleteCaseMedia(item.id); await reloadMedia(); await onChanged(); }); }}> ลบ</button>}
                </figcaption>
              </figure>
            ))}
            {media?.length === 0 && <div className="case-media-empty">ยังไม่มีภาพแนบ</div>}
          </div>
          <label className="case-upload">เพิ่มภาพ<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || !canEditCase(user, row)} onChange={onFile} /></label>
          <p className="case-muted">ระบบย่อภาพและลบ EXIF/GPS ก่อนอัปโหลด · อย่าถ่ายติดใบหน้า/ป้ายชื่อ</p>
        </div>
      </div>
    </>
  );
}

export default function ResidentCases({ user, onPresent }) {
  const [cases, setCases] = useState(null);
  const [people, setPeople] = useState([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [unit, setUnit] = useState("all");
  const [dialog, setDialog] = useState(null); // { type: "form" | "detail", id? }

  const load = useCallback(async () => {
    try {
      const [rows, ppl] = await Promise.all([loadAdmissionCases(), loadCasePeople()]);
      setCases(rows);
      setPeople(ppl);
      setError("");
    } catch (nextError) {
      setError(caseErrorMessage(nextError));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (cases || []).filter((row) =>
      (status === "all" || row.status === status) &&
      (unit === "all" || row.unit_name === unit) &&
      (!needle || `${row.diagnosis} ${row.case_code}`.toLowerCase().includes(needle)));
  }, [cases, search, status, unit]);
  const current = dialog?.id ? (cases || []).find((row) => row.id === dialog.id) : null;
  const count = (key) => (cases || []).filter((row) => row.status === key).length;

  return (
    <section className="resident-panel">
      <div className="panel-title-row">
        <div><h2>เคสรับใหม่ของภาควิชา</h2><p>ทุกคนที่ active เห็นเคสร่วมกัน · ห้ามบันทึกข้อมูลระบุตัวผู้ป่วย</p></div>
        <button type="button" className="primary-button" onClick={() => setDialog({ type: "form" })}><PlusIcon size={16} /> เพิ่มเคส</button>
      </div>
      {error && <p className="form-error" role="alert">{error} <button type="button" className="link-button" onClick={load}>ลองใหม่</button></p>}
      <div className="case-stats">
        <div><small>เคสทั้งหมด</small><strong>{cases?.length ?? "…"}</strong></div>
        <div><small>Admit อยู่</small><strong>{cases ? count("admit") : "…"}</strong></div>
        <div><small>รออัปเดตสถานะ</small><strong>{cases ? count("pending_update") : "…"}</strong></div>
      </div>
      <div className="history-filters">
        <label>ค้นหา<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Diagnosis หรือรหัสเคส" /></label>
        <label>สถานะ<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">ทุกสถานะ</option>{CASE_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>หน่วย<select value={unit} onChange={(event) => setUnit(event.target.value)}><option value="all">ทุกหน่วย</option>{CASE_UNITS.map((name) => <option key={name}>{name}</option>)}</select></label>
      </div>
      <div className="resident-table-wrap">
        <table>
          <thead><tr><th>เคส / วันที่รับ</th><th>Diagnosis</th><th>หน่วย / Owner</th><th>สถานะ</th><th>ภาพ</th><th /></tr></thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id}>
                <td><strong>{row.case_code}</strong><br /><small>{thaiDate(row.admit_date)}</small></td>
                <td><button type="button" className="link-button" onClick={() => setDialog({ type: "detail", id: row.id })}>{row.diagnosis}</button><br /><small>{caseSexLabel(row.sex)} · {row.age_years} ปี</small></td>
                <td>{row.unit_name}<br /><small>{personName(people, row.owner_id)}</small></td>
                <td><CaseStatusChip status={row.status} /></td>
                <td>{row.media_count}</td>
                <td><button type="button" className="secondary-button" disabled={!canEditCase(user, row)} title={canEditCase(user, row) ? "" : "Resident แก้ได้เฉพาะเคสที่ตนสร้างหรือเป็น Owner"} onClick={() => setDialog({ type: "form", id: row.id })}>แก้ไข</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {cases && visible.length === 0 && <p className="case-muted">ไม่พบเคสที่ตรงกับเงื่อนไข</p>}
        {!cases && !error && <p className="case-muted">กำลังโหลดเคส…</p>}
      </div>
      {dialog?.type === "form" && (!dialog.id || current) && (
        <CaseModal title={dialog.id ? `แก้ไข ${current.case_code}` : "เพิ่มเคสใหม่"} onClose={() => setDialog(null)}>
          <CaseForm user={user} people={people} initial={dialog.id ? current : null} onSaved={async () => { await load(); setDialog(null); }} onReload={load} onClose={() => setDialog(null)} />
        </CaseModal>
      )}
      {dialog?.type === "detail" && current && (
        <CaseModal title={`${current.case_code} · ${current.diagnosis}`} onClose={() => setDialog(null)}>
          <CaseDetail user={user} people={people} row={current} onEdit={() => setDialog({ type: "form", id: current.id })} onPresent={onPresent} onChanged={load} onClose={() => setDialog(null)} />
        </CaseModal>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Append the CSS block**

Append to the end of `src/resident.css`:

```css

/* New admissions + Friday conference */
.case-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:16px; }
.case-stats > div { border:1px solid var(--resident-line); border-radius:12px; background:#fff; padding:12px 16px; }
.case-stats small { display:block; color:var(--resident-muted); }
.case-stats strong { font-size:26px; color:var(--resident-green); }
.case-status { display:inline-block; padding:3px 10px; border-radius:999px; font-size:12.5px; font-weight:800; }
.case-status-admit { background:#ede9fe; color:#6d28d9; }
.case-status-discharged { background:#e5f5e9; color:#176b36; }
.case-status-pending_update { background:#fff4d6; color:#8a5a00; }
.case-privacy-note { display:flex; gap:8px; align-items:center; margin:0 0 14px; padding:10px 14px; border:1px solid #fde68a; border-radius:10px; background:#fffbeb; font-size:13.5px; }
.case-muted { color:var(--resident-muted); font-size:14px; }
.case-count { display:inline-block; padding:0 8px; border-radius:999px; background:var(--resident-soft); border:1px solid var(--resident-line); font-size:13px; }
.case-modal-backdrop { position:fixed; inset:0; z-index:60; display:grid; place-items:center; padding:16px; background:rgba(10,30,15,.45); }
.case-modal { width:min(780px,100%); max-height:90vh; display:flex; flex-direction:column; border-radius:14px; background:#fff; color:var(--resident-ink); box-shadow:0 20px 60px rgba(0,0,0,.3); }
.case-modal-head { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:14px 20px; border-bottom:1px solid var(--resident-line); }
.case-modal-head h2 { margin:0; font-size:18px; }
.case-modal-body { padding:20px; overflow:auto; }
.case-form label, .case-notes label { display:grid; gap:6px; font-size:14px; font-weight:700; }
.case-form input, .case-form select, .case-form textarea, .case-notes textarea { width:100%; border:1px solid #cbd8ce; border-radius:8px; padding:10px 12px; background:#fff; color:var(--resident-ink); font:inherit; }
.case-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.case-full { grid-column:1 / -1; }
.case-actions { justify-content:flex-end; margin-top:16px; }
.case-split { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
.case-field { margin-bottom:10px; }
.case-field small { display:block; color:var(--resident-muted); font-size:12px; }
.case-media { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; margin-top:8px; }
.case-media figure { margin:0; }
.case-media img { width:100%; aspect-ratio:4/3; object-fit:cover; border-radius:10px; border:1px solid var(--resident-line); }
.case-media figcaption { font-size:12px; color:var(--resident-muted); }
.case-media-empty { grid-column:1 / -1; aspect-ratio:4/3; display:grid; place-items:center; border-radius:10px; background:var(--resident-soft); color:var(--resident-muted); font-size:13px; }
.case-upload { display:grid; gap:6px; margin-top:12px; font-size:13px; font-weight:700; }
.case-notes { margin-top:22px; display:grid; gap:10px; }
.case-notes h3 { margin:0; }
.case-note { border-left:3px solid var(--resident-green); background:var(--resident-soft); padding:8px 12px; border-radius:0 8px 8px 0; }
.case-note small { color:var(--resident-muted); }
.case-note p { margin:4px 0; white-space:pre-wrap; }
.case-present { display:grid; gap:16px; }
.case-present h2 { font-size:28px; margin:8px 0; }
.case-present-image { aspect-ratio:16/10; width:100%; display:grid; place-items:center; overflow:hidden; border-radius:12px; background:var(--resident-soft); color:var(--resident-muted); }
.case-present-image img { width:100%; height:100%; object-fit:contain; }
.case-weekbar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:16px; }
@media (max-width:700px) { .case-grid, .case-split { grid-template-columns:1fr; } }
```

- [ ] **Step 6: Run the tests and a build**

Run: `node --test tests/resident-cases-ui.test.mjs` then `npm test` then `npm run build`
Expected: tests PASS; build succeeds (chunk-size warning is expected). The new components are not mounted yet (Task 6), but Vite only bundles imported modules, so run the build again in Task 6.

- [ ] **Step 7: Commit**

```bash
git add src/features/CaseParts.jsx src/features/ResidentCases.jsx src/resident.css tests/resident-cases-ui.test.mjs
git commit -m $'feat: add New admissions screen and shared case UI parts\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_019U9dRCDpwvXnbJPN6TtMSZ'
```

---

### Task 5: Friday conference screen

**Files:**
- Create: `src/features/ResidentConference.jsx`
- Modify: `tests/resident-cases-ui.test.mjs` (append one test)

**Interfaces:**
- Consumes: `loadAdmissionCases({from,to})`, `loadCasePeople()`, `loadCaseMedia(caseId)` (Task 3); `conferenceWeek`, `caseErrorMessage`, `caseSexLabel` (Task 1); `CaseNotes`, `CaseStatusChip`, `personName`, `thaiDate` (Task 4); `bangkokIsoDate`, `shiftIsoDate` (`src/roundSchedule.js`).
- Produces: default export `ResidentConference({ user, initialCase })` where `initialCase` is `null` or `{ id, admit_date }` (opens that case's week with that case selected).

- [ ] **Step 1: Append the failing test**

Append to `tests/resident-cases-ui.test.mjs`:

```js
test("conference loads one Mon-Fri week, guards stale loads, and shows notes per case", async () => {
  const ui = await read("src/features/ResidentConference.jsx");
  assert.match(ui, /conferenceWeek\(/);
  assert.match(ui, /loadAdmissionCases\(\{ from: week\.start, to: week\.end \}\)/);
  assert.match(ui, /shiftIsoDate\(weekStart, -7\)/);
  assert.match(ui, /shiftIsoDate\(weekStart, 7\)/);
  assert.match(ui, /seq\.current/);
  assert.match(ui, /<CaseNotes key=\{current\.id\}/);
  assert.match(ui, /initialCase/);
  assert.doesNotMatch(ui, /<header[\s>]/);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/resident-cases-ui.test.mjs`
Expected: the new test FAILS (`ENOENT ... ResidentConference.jsx`); earlier tests still pass.

- [ ] **Step 3: Write the implementation**

Create `src/features/ResidentConference.jsx`:

```jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { caseErrorMessage, caseSexLabel, conferenceWeek } from "../residentCases";
import { bangkokIsoDate, shiftIsoDate } from "../roundSchedule";
import { loadAdmissionCases, loadCaseMedia, loadCasePeople } from "../residentCasesApi";
import { CaseNotes, CaseStatusChip, personName, thaiDate } from "./CaseParts";

export default function ResidentConference({ user, initialCase = null }) {
  const [weekStart, setWeekStart] = useState(() => conferenceWeek(initialCase?.admit_date || bangkokIsoDate()).start);
  const [cases, setCases] = useState(null);
  const [people, setPeople] = useState([]);
  const [index, setIndex] = useState(0);
  const [media, setMedia] = useState([]);
  const [photo, setPhoto] = useState(0);
  const [error, setError] = useState("");
  const pendingId = useRef(initialCase?.id || null);
  const seq = useRef(0);
  const mediaSeq = useRef(0);
  const week = useMemo(() => conferenceWeek(weekStart), [weekStart]);

  useEffect(() => { loadCasePeople().then(setPeople).catch((nextError) => setError(caseErrorMessage(nextError))); }, []);

  useEffect(() => {
    const mine = ++seq.current;
    setCases(null);
    setError("");
    loadAdmissionCases({ from: week.start, to: week.end })
      .then((rows) => {
        if (mine !== seq.current) return;
        // Present oldest first: Monday's admissions before Friday's.
        const ordered = [...rows].sort((a, b) => a.admit_date.localeCompare(b.admit_date) || a.case_code.localeCompare(b.case_code));
        const wanted = pendingId.current ? ordered.findIndex((row) => row.id === pendingId.current) : -1;
        pendingId.current = null;
        setCases(ordered);
        setIndex(wanted >= 0 ? wanted : 0);
        setPhoto(0);
      })
      .catch((nextError) => { if (mine === seq.current) setError(caseErrorMessage(nextError)); });
  }, [week.start, week.end]);

  const current = cases?.[Math.min(index, (cases?.length || 1) - 1)] || null;
  useEffect(() => {
    const mine = ++mediaSeq.current;
    setMedia([]);
    setPhoto(0);
    if (!current) return;
    loadCaseMedia(current.id)
      .then((rows) => { if (mine === mediaSeq.current) setMedia(rows); })
      .catch((nextError) => { if (mine === mediaSeq.current) setError(caseErrorMessage(nextError)); });
  }, [current?.id]);

  const label = `${thaiDate(week.start)} – ${thaiDate(week.end)}`;
  return (
    <section className="resident-panel case-present">
      <div className="case-weekbar">
        <button type="button" className="secondary-button" onClick={() => setWeekStart(shiftIsoDate(weekStart, -7))}>สัปดาห์ก่อน</button>
        <strong>{label}</strong>
        <button type="button" className="secondary-button" onClick={() => setWeekStart(shiftIsoDate(weekStart, 7))}>สัปดาห์ถัดไป</button>
        <button type="button" className="link-button" onClick={() => setWeekStart(conferenceWeek(bangkokIsoDate()).start)}>สัปดาห์นี้</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!cases && !error && <p className="case-muted">กำลังโหลดเคส…</p>}
      {cases?.length === 0 && <p className="case-muted">ไม่มีเคสรับใหม่ในสัปดาห์นี้</p>}
      {current && (
        <>
          <div className="case-weekbar">
            <select aria-label="เลือกเคส" value={index} onChange={(event) => setIndex(Number(event.target.value))}>
              {cases.map((row, position) => <option key={row.id} value={position}>{row.case_code} · {row.diagnosis}</option>)}
            </select>
            <button type="button" className="secondary-button" disabled={index === 0} onClick={() => setIndex(index - 1)}>ก่อนหน้า</button>
            <strong>{index + 1} / {cases.length}</strong>
            <button type="button" className="secondary-button" disabled={index >= cases.length - 1} onClick={() => setIndex(index + 1)}>ถัดไป</button>
          </div>
          <div className="case-split">
            <div>
              <p><span className="case-count">{current.case_code}</span> <span className="case-count">{current.unit_name}</span> <CaseStatusChip status={current.status} /></p>
              <h2>{current.diagnosis}</h2>
              <p className="case-muted">{caseSexLabel(current.sex)} {current.age_years} ปี · รับไว้ {thaiDate(current.admit_date)} · Owner: {personName(people, current.owner_id)}</p>
              <div className="case-field"><small>Management</small>{current.management || "ยังไม่ระบุ"}</div>
              <div className="case-field"><small>Operation</small>{current.operation || "ยังไม่ระบุ"}</div>
            </div>
            <div>
              <div className="case-present-image">
                {media[photo]?.url ? <img src={media[photo].url} alt={media[photo].caption || `ภาพ ${photo + 1}`} /> : <span>{media.length ? "โหลดภาพไม่สำเร็จ" : "ยังไม่มีภาพแนบ"}</span>}
              </div>
              <div className="button-row">
                {media.map((item, position) => <button key={item.id} type="button" className={position === photo ? "primary-button" : "secondary-button"} onClick={() => setPhoto(position)}>ภาพ {position + 1}</button>)}
              </div>
            </div>
          </div>
          <CaseNotes key={current.id} caseId={current.id} user={user} people={people} />
        </>
      )}
    </section>
  );
}
```

The test regexes `shiftIsoDate(weekStart, -7)` / `shiftIsoDate(weekStart, 7)` match the two week buttons above.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/resident-cases-ui.test.mjs` then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/ResidentConference.jsx tests/resident-cases-ui.test.mjs
git commit -m $'feat: add Friday conference presenter with shared notes\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_019U9dRCDpwvXnbJPN6TtMSZ'
```

---

### Task 6: Wire into the app, docs, build

**Files:**
- Modify: `src/features/ResidentPlatform.jsx` (imports at line ~20, nav at ~750, titles at ~775, state at ~729, render chain at ~833)
- Modify: `docs/superpowers/specs/2026-10-02-resident-cases-design.md` (§6)
- Modify: `CLAUDE.md` (status log)
- Modify: `README.md` (feature bullet)
- Modify: `tests/resident-cases-ui.test.mjs` (append wiring test)

**Interfaces:**
- Consumes: `ResidentCases({ user, onPresent })`, `ResidentConference({ user, initialCase })`.
- Produces: tabs `cases` ("New admissions") and `conference` ("ประชุมวันศุกร์") visible to all three roles.

- [ ] **Step 1: Append the failing wiring test**

Append to `tests/resident-cases-ui.test.mjs`:

```js
test("both new tabs are wired for every role and present-case jumps to the conference", async () => {
  const shell = await read("src/features/ResidentPlatform.jsx");
  assert.match(shell, /import ResidentCases from "\.\/ResidentCases"/);
  assert.match(shell, /import ResidentConference from "\.\/ResidentConference"/);
  assert.match(shell, /nav\.push\(\["cases", "New admissions"\], \["conference", "ประชุมวันศุกร์"\]\)/);
  assert.match(shell, /cases: "New admissions"/);
  assert.match(shell, /conference: "ประชุมวันศุกร์"/);
  assert.match(shell, /tab === "cases"/);
  assert.match(shell, /tab === "conference"/);
  assert.match(shell, /setPresentCase\(/);
  // Not role-gated: the push sits at function level (2-space indent) right after
  // the gated attendance push, not as that `if`'s body (4-space indent).
  assert.match(shell, /\]\);\n  nav\.push\(\["cases", "New admissions"\]/);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/resident-cases-ui.test.mjs`
Expected: the new test FAILS (imports not present).

- [ ] **Step 3: Edit `ResidentPlatform.jsx`**

Edit 1 — add imports. Old:
```jsx
import ResidentExams from "./ResidentExams";
```
New:
```jsx
import ResidentExams from "./ResidentExams";
import ResidentCases from "./ResidentCases";
import ResidentConference from "./ResidentConference";
```

Edit 2 — state. Old:
```jsx
  const [historyFocus, setHistoryFocus] = useState("completed");
```
New:
```jsx
  const [historyFocus, setHistoryFocus] = useState("completed");
  const [presentCase, setPresentCase] = useState(null);
```

Edit 3 — nav (visible to every role, before Notification). Old:
```jsx
  if (workspace.user.role === "resident" || workspace.user.role === "staff")
    nav.push(["attendance", "เช็กชื่อประชุม"]);
```
New:
```jsx
  if (workspace.user.role === "resident" || workspace.user.role === "staff")
    nav.push(["attendance", "เช็กชื่อประชุม"]);
  nav.push(["cases", "New admissions"], ["conference", "ประชุมวันศุกร์"]);
```

Edit 4 — page titles. Old:
```jsx
    exams: workspace.user.role === "resident" ? "ผลการสอบของฉัน" : "การสอบ",
  };
```
New:
```jsx
    exams: workspace.user.role === "resident" ? "ผลการสอบของฉัน" : "การสอบ",
    cases: "New admissions",
    conference: "ประชุมวันศุกร์",
  };
```

Edit 5 — render chain. Old:
```jsx
        ) : tab === "export" ? (
          <ResidentExportCenter workspace={workspace} />
```
New:
```jsx
        ) : tab === "cases" ? (
          <ResidentCases
            user={workspace.user}
            onPresent={(row) => {
              setPresentCase(row);
              setTab("conference");
            }}
          />
        ) : tab === "conference" ? (
          <ResidentConference key={presentCase?.id || "week"} user={workspace.user} initialCase={presentCase} />
        ) : tab === "export" ? (
          <ResidentExportCenter workspace={workspace} />
```

Also clear the preset when the user opens the conference from the nav: change the nav button handler. Old (inside the nav `onClick`):
```jsx
            onClick={() => {
              setTab(id);
              setSelectedRequest(null);
            }}
```
New:
```jsx
            onClick={() => {
              if (id === "conference" && tab !== "conference") setPresentCase(null);
              setTab(id);
              setSelectedRequest(null);
            }}
```

- [ ] **Step 4: Update the spec §6 to match the RPC-only design**

In `docs/superpowers/specs/2026-10-02-resident-cases-design.md`, replace the first bullet of §6 ("INSERT/UPDATE ตรงผ่าน RLS ได้ แต่ **trigger** …") with:

```md
- **ทุกการเขียนผ่าน RPC แบบ SECURITY DEFINER** (สร้าง/แก้/soft delete เคส, เพิ่ม/ลบภาพ, เพิ่ม/แก้/ลบโน้ต) โดย `authenticated` มีสิทธิ์ SELECT อย่างเดียวบนตารางใหม่ (กรองด้วย RLS) ไม่มี policy หรือ grant สำหรับ INSERT/UPDATE/DELETE ตรง ฟังก์ชันตรวจ role ตามข้อ 4 และประทับ `created_by`, `updated_by`, `updated_at`, `case_code` ฝั่ง server เอง (client ส่งมาไม่ได้)
```
Leave the remaining §6 bullets (optimistic RPC, purge, soft delete) unchanged except: in the third bullet replace "soft delete เคส = UPDATE `deleted_at` โดยผู้มีสิทธิ์ตามข้อ 4 (ไม่มี DELETE policy ตรง)" with "soft delete เคส = RPC `soft_delete_resident_admission_case` ตามสิทธิ์ข้อ 4 (ตรวจ `updated_at` เหมือนการแก้)".

- [ ] **Step 5: Update CLAUDE.md and README.md**

In `CLAUDE.md`, under `## Status log`, add as the last bullet:

```md
- 2026-10-02 (branch `feat/resident-admission-cases`, **not yet deployed**): New admissions + ประชุมวันศุกร์ (phase 1).
  Migration `20261002090000_resident_admission_cases.sql` adds `resident_admission_cases`, `resident_case_media`,
  `resident_case_notes`, private bucket `resident-case-media`; SELECT-only RLS, every write is a SECURITY DEFINER RPC
  with an `updated_at` optimistic check (`CASE_CONFLICT`). Not applied until the owner runs it, then
  `tests/resident-cases-db.sql` and `tests/resident-cases-rls-rollback.sql`. Spec/plan in `docs/superpowers/`.
```

In `README.md`, in the "สิ่งที่ระบบรองรับ" list add the bullet:

```md
- New admissions และประชุมวันศุกร์: ทุกคนที่ active บันทึก/ดูเคส admit (ไม่มีชื่อหรือ HN), แนบภาพ (ลบ EXIF ก่อนอัปโหลด) และจดข้ออภิปรายร่วมกัน
```

- [ ] **Step 6: Run everything**

Run: `npm test` then `npm run build`
Expected: all tests PASS; build succeeds (chunk-size warning expected). Then `git diff --stat` to confirm only the planned files changed.

- [ ] **Step 7: Be honest about what is not verified**

The tabs sit behind login, so they cannot be rendered locally without a real session, and the data path needs the migration. Do **not** claim the UI works end to end. Report: unit/regex tests and build pass; SQL and UI behaviour are verified only in Task 7 by the owner's dry-run, the two SQL tests, and the live click-through.

- [ ] **Step 8: Commit**

```bash
git add src/features/ResidentPlatform.jsx docs/superpowers/specs/2026-10-02-resident-cases-design.md CLAUDE.md README.md tests/resident-cases-ui.test.mjs
git commit -m $'feat: wire New admissions and conference tabs into the app\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_019U9dRCDpwvXnbJPN6TtMSZ'
```

---

### Task 7: Owner-run deployment and verification (no code)

**Files:** none changed. Claude cannot run production writes; the owner runs the `!` commands, Claude verifies read-only afterwards.

- [ ] **Step 1: Confirm the target is empty (read-only)**

Claude runs via the Supabase tool: `select to_regclass('public.resident_admission_cases');` — expected `null`.

- [ ] **Step 2: Owner dry-run (rolls back, nothing is kept)**

```bash
! sed 's/^commit;$/rollback;/' supabase/migrations/20261002090000_resident_admission_cases.sql > /tmp/resident-cases-dryrun.sql && npx --yes supabase db query --linked --file /tmp/resident-cases-dryrun.sql
```
Expected: no error. Then re-run Step 1: still `null`. If the dry-run errors, stop and give Claude the message; do not apply.

- [ ] **Step 3: Owner applies the migration on its own**

```bash
! npx --yes supabase db query --linked --file supabase/migrations/20261002090000_resident_admission_cases.sql
```
Never `supabase db push`.

- [ ] **Step 4: Verify**

Claude re-runs Step 1 (expect a regclass name) and the owner runs:

```bash
! npx --yes supabase db query --linked --file tests/resident-cases-db.sql
! npx --yes supabase db query --linked --file tests/resident-cases-rls-rollback.sql
```
Expected: `resident cases db checks passed`; the rollback test prints `resident cases behaviour checks passed` and leaves zero rows (Claude confirms `select count(*) from public.resident_admission_cases;` = 0).

- [ ] **Step 5: Release the frontend (only after Step 4 passes)**

Owner decides: open a PR / merge `feat/resident-admission-cases` into `main` (Vercel deploys on push to `main`). Then a live click-through with a Resident, a Staff and an Admin account: add a case; edit the same case in two windows (second save shows the reload prompt); attach an image and open it in the conference; add notes from two accounts; Resident cannot edit someone else's case; Admin soft-deletes and purges a test case.

- [ ] **Step 6: Update the status log**

Change the CLAUDE.md status line from "not yet deployed" to the real deploy date and remaining follow-ups (PDPA/retention confirmation, audit trail).
