import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { EXPECTED_MATRIX_NAMES, validateGrantsMatrix } from '../scripts/data-api-grants-matrix.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const valid = () => EXPECTED_MATRIX_NAMES.map(check_name => ({ check_name, ok: true }));
test('matrix accepts all 48 unique identities in any order', () => {
  assert.equal(validateGrantsMatrix(valid().reverse()).length, 48);
});
for (const [label, mutate] of [
  ['empty', () => []],
  ['missing row', rows => rows.slice(1)],
  ['extra row', rows => [...rows, rows[0]]],
  ['duplicate replacing a missing identity', rows => [rows[1], ...rows.slice(1)]],
  ['unknown replacing an expected identity', rows => [{ check_name: 'unexpected', ok: true }, ...rows.slice(1)]],
  ['false', rows => [{ ...rows[0], ok: false }, ...rows.slice(1)]],
  ['null', rows => [{ ...rows[0], ok: null }, ...rows.slice(1)]],
  ['truthy string', rows => [{ ...rows[0], ok: 'true' }, ...rows.slice(1)]],
]) {
  test(`matrix rejects ${label}`, () => assert.throws(() => validateGrantsMatrix(mutate(valid()))));
}

test('real runner exits nonzero for truncated or substituted SQL result sets', { timeout: 120000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'rc-grants-runner-'));
  try {
    // Copy source into an isolated sandbox. Never alter the reviewed checkout
    // or connect to a project. Only the returned matrix query is faulted.
    for (const name of ['scripts', 'tests', 'supabase']) await cp(join(root, name), join(dir, name), { recursive: true });
    await symlink(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
    await writeFile(join(dir, 'package.json'), '{"type":"module"}');
    const path = join(dir, 'supabase/manual/data_api_grants_check.sql');
    const original = (await readFile(path, 'utf8')).trim().replace(/;$/, '');
    const faults = [
      ['empty', `select * from (${original}) m where false`],
      ['47 rows', `select * from (${original}) m limit 47`],
      ['48 rows with duplicate/missing identity', `with m as (${original}) (select * from m offset 1) union all select * from (select * from m offset 1 limit 1) d`],
      ['48 rows with unknown identity', `with m as (${original}) select 'unexpected'::text as check_name, true as ok union all select * from (select * from m offset 1) d`],
    ];
    for (const [label, query] of faults) await t.test(label, () => {
      return writeFile(path, query + ';\n').then(() => {
        const result = spawnSync(process.execPath, ['scripts/test-data-api-grants.mjs'], { cwd: dir, encoding: 'utf8', timeout: 25000 });
        assert.ifError(result.error);
        assert.equal(result.signal, null, 'Must be a deliberate failure, not a killed process');
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.match(result.stderr, /Matrix must (return exactly 48 checks|contain every expected check exactly once)/);
        assert.doesNotMatch(result.stdout, /ALL \d+ checks passed/);
        assert.doesNotMatch(result.stdout, /PASS (required |closed |notification )/, 'No matrix PASS before completeness check');
      });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
