// Offline SQL regression for the 2026-10-30 Data API grant defaults change.
// Never connects to a Supabase project. A fresh in-memory PostgreSQL engine
// with no table/sequence default grants is constructed for every run.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { validateGrantsMatrix } from './data-api-grants-matrix.mjs';
const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const baseline = process.argv.find(a => a.startsWith('--baseline-ref='))?.split('=')[1];
if (baseline && !/^[a-f0-9]{40}$/.test(baseline)) throw new Error('baseline-ref must be a full commit SHA');
const db = new PGlite();
let checks = 0;
const ok = (value, label) => { assert.equal(value, true, label); checks++; console.log(`PASS ${label}`); };
const run = async (path) => {
  try { return await db.exec(await read(path)); }
  catch (error) { throw new Error(`${path}: ${error.code}: ${error.message}`); }
};
// These two files only install platform extensions / Vault / cron scheduling.
// Their absence is explicit; no executable SQL from other migrations is removed.
const excluded = new Map([
  ['20260909123956_schedule_resident_web_reminders.sql', 'platform-only cron extension'],
  ['20260928130000_schedule_assessment_email_delivery.sql', 'platform-only Vault/cron/HTTP'],
  ['20260825030857_start_year5_2569_and_staff_management.sql', 'retired Year 5 seed precedes curricula CREATE in repository history'],
  ['20260825094000_multi_curriculum_advisor_fixes.sql', 'retired advisor migration drops a policy absent from preceding repository migrations'],
]);
try {
  await run('tests/support/supabase-grants-bootstrap.sql');
  const defaults = await db.query(`select count(*)::int as n from pg_default_acl
    where defaclobjtype in ('r','S')`);
  ok(defaults.rows[0].n === 0, 'bootstrap has no automatic table or sequence grants');
  let applied = 0;
  for (const name of (await readdir(new URL('supabase/migrations/', root))).filter(n => n.endsWith('.sql')).sort()) {
    if (excluded.has(name)) { console.log(`SKIP ${name}: ${excluded.get(name)}`); continue; }
    try {
      const path = `supabase/migrations/${name}`;
      await db.exec(baseline ? execFileSync('git', ['show', `${baseline}:${path}`], { cwd: root, encoding: 'utf8' }) : await read(path));
    }
    catch (error) { throw new Error(`Migration failed: ${name}: ${error.code}: ${error.message}`); }
    applied++;
  }
  console.log(`Replayed ${applied} migrations without automatic grants`);
  const catalogSql = `select c.relname, c.relacl::text, c.relrowsecurity from pg_class c
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
    and c.relkind in ('r','p','S') order by c.relname`;
  const beforeProbes = (await db.query(catalogSql)).rows;
  const matrix = validateGrantsMatrix((await db.query(await read('supabase/manual/data_api_grants_check.sql'))).rows);
  for (const row of matrix) {
    ok(row.ok, row.check_name);
  }
  // Positive path + negative authorization probes use SQL roles, not mocks of
  // has_table_privilege. Everything (including synthetic fixtures) rolls back.
  await run('tests/data-api-grants-behavior.sql');
  console.log('PASS SQL role / RLS behavior probes'); checks++;
  for (const file of ['tests/rc04-managed-exams-behavior.sql', 'tests/rc04-managed-exams-b002.sql', 'tests/round-workflow-behavior.sql', 'tests/seat-map-behavior.sql']) {
    let sql = await read(file);
    if (file.endsWith('rc04-managed-exams-behavior.sql')) {
      // T18k/l/n/o deliberately exercise the trigger EVEN IF an old service
      // writer has legacy table grants. Supply only those privileges inside
      // the fixture transaction, after the real no-default matrix was checked.
      // They disappear with the suite's ROLLBACK; no rc04_* grant is added.
      assert.match(sql, /^begin;$/m);
      sql = sql.replace(/^begin;$/m, `begin;
        grant select, update, delete on public.resident_exam_events to service_role;
        grant insert on public.resident_exam_results to service_role;`);
      console.log('FIXTURE ONLY: legacy service grants to exercise RC04 trigger defense in depth');
    }
    try { await db.exec(sql); } catch (error) { throw new Error(`${file}: ${error.code}: ${error.message}`); }
    console.log(`PASS regression ${file}`); checks++;
  }
  assert.deepEqual((await db.query(catalogSql)).rows, beforeProbes, 'fixture grants must roll back');
  ok((await db.query('select count(*)::int as n from public.resident_profiles')).rows[0].n === 0,
    'probe fixtures and temporary legacy grants rolled back');
  console.log(`ALL ${checks} checks passed; ${applied} migrations; ${excluded.size} explicitly listed skips`);
} finally {
  await db.close();
}
