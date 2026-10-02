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

test("storage reads respect soft delete and the delete policy cannot bypass it", async () => {
  const sql = await read();
  assert.match(sql, /function private\.resident_case_media_path_live\(p_name text\)/);
  assert.match(sql, /function private\.resident_case_media_path_used\(p_name text\)/);
  const select = sql.slice(sql.indexOf("create policy resident_case_media_objects_select"), sql.indexOf("drop policy if exists resident_case_media_objects_insert"));
  assert.match(select, /private\.resident_role_is\('admin'\)/);
  assert.match(select, /private\.resident_case_media_path_live\(name\)/);
  assert.match(select, /not \(select private\.resident_case_media_path_used\(name\)\)/);
  const del = sql.slice(sql.indexOf("create policy resident_case_media_objects_delete"), sql.indexOf("-- RPCs"));
  assert.match(del, /private\.resident_case_media_path_used\(name\)/);
  assert.match(del, /private\.resident_case_member\(\)/);
  assert.doesNotMatch(del, /from public\.resident_case_media/);
  assert.match(sql, /grant execute on function private\.resident_case_media_path_live\(text\) to authenticated/);
  assert.match(sql, /grant execute on function private\.resident_case_media_path_used\(text\) to authenticated/);
});

test("a deactivated owner does not lock the case", async () => {
  const sql = await read();
  const update = sql.slice(sql.indexOf("function public.update_resident_admission_case"), sql.indexOf("function public.soft_delete_resident_admission_case"));
  assert.match(update, /if p_owner_id is distinct from v_case\.owner_id then\s+perform private\.resident_case_assert_owner\(p_owner_id\);\s+end if;/);
  assert.doesNotMatch(update.replace(/if p_owner_id is distinct[\s\S]*?end if;/, ""), /resident_case_assert_owner/);
});
