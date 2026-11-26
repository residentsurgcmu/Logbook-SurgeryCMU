import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const base = new URL("../supabase/migrations/", import.meta.url);
const sql = (filename) => readFile(new URL(filename, base), "utf8");
const ADMIN = "00000000-0000-4000-8000-000000000001";
const STAFF = "00000000-0000-4000-8000-000000000002";
const RESIDENT = "00000000-0000-4000-8000-000000000003";
const INACTIVE = "00000000-0000-4000-8000-000000000004";

test("duty today survives reload and can only be set/cleared by an active Admin; old slots and URL rules survive", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create schema private;
      create type public.resident_system_role as enum ('admin','staff','resident');
      create table public.resident_profiles (user_id uuid primary key, active boolean);
      create table public.resident_user_roles (user_id uuid, role public.resident_system_role, active boolean);
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      insert into resident_profiles values ('${ADMIN}', true), ('${STAFF}', true), ('${RESIDENT}', true), ('${INACTIVE}', false);
      insert into resident_user_roles values ('${ADMIN}', 'admin', true), ('${STAFF}', 'staff', true),
        ('${RESIDENT}', 'resident', true), ('${INACTIVE}', 'admin', false);
    `);
    // Keep this focused on the original embed migrations, with real membership helper bodies.
    const roles = await sql("202609070001_resident_assessment_platform.sql");
    const members = await sql("20261002090000_resident_admission_cases.sql");
    await db.exec(roles.match(/create or replace function private\.resident_role_is\([\s\S]*?\$\$;/)[0]);
    await db.exec(members.match(/create or replace function private\.resident_case_member\([\s\S]*?\$\$;/)[0]);
    await db.exec(await sql("20261004120000_resident_embed_links.sql"));
    await db.exec(await sql("20261004140000_resident_embed_links_port_rule.sql"));
    const as = async (id, role = "authenticated") => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
      await db.exec(`set role ${role}`);
    };
    const set = (key, url) => db.query("select public.set_resident_embed_link($1, 'ตารางทดสอบ', $2)", [key, url]);
    const clear = (key) => db.query("select public.clear_resident_embed_link($1)", [key]);
    const keys = async () => (await db.query("select link_key, url from public.resident_embed_links order by link_key")).rows;
    await as(ADMIN);
    await set("rota", "https://example.invalid/rota");
    await set("or_schedule", "https://example.invalid/or");
    const original = await keys();
    await assert.rejects(set("duty_today", "https://example.invalid/today"), /Unknown link key/);
    await db.exec("reset role");
    const migration = (await readdir(base)).find((name) => name.endsWith("_resident_duty_today_embed_link.sql"));
    await db.exec(await sql(migration));
    await as(ADMIN);
    assert.deepEqual(await keys(), original, "migration seeds no URL and leaves the old ones unchanged");
    await set("duty_today", "https://example.invalid/today");
    await set("duty_today", "https://example.invalid:8443/today");
    await assert.rejects(set("duty_today", "http://example.invalid/today"), /Address must start/);
    await assert.rejects(set("duty_today", "https://example.invalid:65536/today"), /Address must start/);
    await assert.rejects(set("other", "https://example.invalid"), /Unknown link key/);
    for (const id of [STAFF, RESIDENT, INACTIVE]) {
      await as(id);
      assert.equal((await keys()).some((row) => row.link_key === "duty_today"), id !== INACTIVE);
      await assert.rejects(set("duty_today", "https://example.invalid"), /Admin account required/);
      await assert.rejects(clear("duty_today"), /Admin account required/);
      await assert.rejects(db.exec("delete from public.resident_embed_links"), /permission denied/);
    }
    await as("", "anon");
    await assert.rejects(keys(), /permission denied/);
    await assert.rejects(clear("duty_today"), /permission denied/);
    await assert.rejects(set("duty_today", "https://example.invalid"), /permission denied/);
    await as(ADMIN);
    assert.deepEqual((await keys()).find((row) => row.link_key === "duty_today"),
      { link_key: "duty_today", url: "https://example.invalid:8443/today" });
    await clear("duty_today");
    assert.deepEqual(await keys(), original);
  } finally {
    await db.close();
  }
});
