// RC-NOTIF-V1 — Edge harness. Runs the REAL supabase/functions/resident-assessment-notifier/index.ts in Node
// (type-stripping) against the REAL local PostgreSQL database (throwaway, all migrations applied). Only the
// platform edges are replaced: Deno globals, the Supabase client (every .rpc() becomes one psql call as
// service_role = one transaction, like PostgREST) and nodemailer (a mail sink that counts SMTP attempts).
// The database clock used by the decisions (private.rc_notif_now) reads harness.clock, so A/B run at the
// work-order times. Synthetic FIXTURE accounts only; refuses a database with Resident data.
// Usage: PGHOST=/tmp PGUSER=postgres PGDATABASE=<throwaway> node --experimental-strip-types tests/notification-edge-harness.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { register, createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
import { pathToFileURL } from 'node:url';

const psql = (sql, role = null) => {
  const text = (role ? `set role ${role};\n` : '') + sql;
  try {
    return execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (error) { const e = new Error(String(error.stderr || error.message).trim()); e.psql = true; throw e; }
};
let checks = 0;
const ok = (cond, label) => { assert.equal(cond, true, label); checks++; console.log(`PASS ${label}`); };

// ---------------------------------------------------------------- fake platform
const sink = []; let smtpAttempts = 0; let mailMode = 'ok';
globalThis.__harness = {
  sendMail(message) {
    smtpAttempts++;
    if (mailMode === 'fail_before') throw Object.assign(new Error('connect ECONNREFUSED (sink)'), { code: 'ECONNECTION', command: 'CONN' });
    if (mailMode === 'uncertain') throw Object.assign(new Error('timeout after DATA (sink)'), { code: 'ETIMEDOUT', command: 'DATA' });
    sink.push(message); return { messageId: `sink-${sink.length}` };
  },
};
const sqlType = (name) => /^p_(request_id|delivery_id|attempt_id)$/.test(name) ? 'uuid'
  : name === 'p_limit' ? 'integer' : name === 'p_failed_retry_after' ? 'interval' : 'text';
const lit = (v) => v === null || v === undefined ? 'null' : `'${String(v).replaceAll("'", "''")}'`;
const setReturning = new Set(['rc_notif_due_email_work']);
function rpc(fn, args = {}) {
  const call = `public.${fn}(${Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}::${sqlType(k)}`).join(', ')})`;
  const sql = setReturning.has(fn) ? `select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from ${call} x;` : `select to_jsonb(${call});`;
  try { const out = psql(sql, 'service_role'); return { data: out === '' ? null : JSON.parse(out), error: null }; }
  catch (error) { return { data: null, error: { message: error.message } }; }
}
function from(table) {   // minimal read-only builder for the deliver_initial auth checks
  const filters = []; let columns = '*';
  const b = {
    select(c) { columns = c; return b; },
    eq(col, val) { filters.push(`${col} = ${lit(val)}`); return b; },
    async maybeSingle() {
      try { const out = psql(`select row_to_json(x) from (select ${columns} from public.${table} where ${filters.join(' and ') || 'true'} limit 1) x;`, 'service_role');
            return { data: out ? JSON.parse(out) : null, error: null }; }
      catch (error) { return { data: null, error: { message: error.message } }; }
    },
  };
  return b;
}
globalThis.__harness.createClient = () => ({ rpc: async (fn, args) => rpc(fn, args), from, auth: { getUser: async (token) => ({ data: { user: token ? { id: token } : null } }) } });
const stub = (code) => 'data:text/javascript,' + encodeURIComponent(code);
const map = {
  'jsr:@supabase/functions-js/edge-runtime.d.ts': stub('export {};'),
  'jsr:@supabase/supabase-js@2.57.4': stub('export const createClient = (...a) => globalThis.__harness.createClient(...a);'),
  'npm:nodemailer@6.9.16': stub('export default { createTransport: () => ({ sendMail: async (m) => globalThis.__harness.sendMail(m) }) };'),
};
register('data:text/javascript,' + encodeURIComponent(`const m = ${JSON.stringify(map)};
export async function resolve(s, c, n) { return m[s] ? { url: m[s], shortCircuit: true } : n(s, c); }`));
const env = { SUPABASE_URL: 'http://harness.invalid', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', SMTP_HOST: 'sink.invalid', SMTP_USER: 'sink', SMTP_PASS: 'sink', RESIDENT_REMINDER_CRON_SECRET: 'harness-secret' };
let handler;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
await import(pathToFileURL(new URL('../supabase/functions/resident-assessment-notifier/index.ts', import.meta.url).pathname).href);
assert.equal(typeof handler, 'function', 'Edge handler registered');
const post = async (body, headers = {}) => {
  const res = await handler(new Request('http://harness.invalid/', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
const deliverDue = () => post({ action: 'deliver_due' }, { 'x-reminder-secret': 'harness-secret' });

// ---------------------------------------------------------------- database fixtures (throwaway only)
assert.equal(psql('select count(*) from public.resident_profiles'), '0', 'Refusing to run: database has Resident data');
const id = (n) => `10000000-0000-4000-8000-0000000000${n}`;
psql(`update public.resident_maintenance_pause set paused = false where scope = 'accounts';
create schema harness; create table harness.clock (now timestamptz not null); insert into harness.clock values ('2026-01-09 00:00:00+00');
create or replace function private.rc_notif_now() returns timestamptz language sql volatile set search_path = '' as $$ select now from harness.clock $$;
insert into auth.users(id, email) select ('10000000-0000-4000-8000-0000000000' || x)::uuid, x || '@fixture.test' from unnest(array['b1','b2','c1','c2']) x;
insert into public.resident_profiles(user_id, full_name, email, pgy, active) select ('10000000-0000-4000-8000-0000000000' || x)::uuid, 'Fixture ' || x, x || '@fixture.test', case when x like 'c%' then 2 end, true from unnest(array['b1','b2','c1','c2']) x;
insert into public.resident_user_roles(user_id, role, active) select ('10000000-0000-4000-8000-0000000000' || x)::uuid, case when x like 'b%' then 'staff'::public.resident_system_role else 'resident' end, true from unnest(array['b1','b2','c1','c2']) x;
insert into public.resident_staff_directory(email, full_name, unit_name, active, auth_user_id) select x || '@fixture.test', 'Fixture ' || x, 'Unit', true, ('10000000-0000-4000-8000-0000000000' || x)::uuid from unnest(array['b1','b2']) x;`);
const at = (t) => psql(`update harness.clock set now = '${t}'`);
const asUser = (u, sql) => psql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${id(u)}', true); ${sql}; commit;`).split('\n').filter((l) => l.trim().startsWith('{') || /^[0-9a-f-]{36}$/.test(l.trim())).pop();
const save = (u, prefs) => asUser(u, `select public.rc_notif_save_my_preferences((public.rc_notif_get_my_preferences()->>'version')::int, '${JSON.stringify(prefs)}'::jsonb)`);
const request = (r, s, code, submittedAt) => {
  at(submittedAt);
  const rid = asUser(r, `select public.submit_resident_assessment_request(d.id, '${id(s)}', '${submittedAt.slice(0, 10)}', 'ctx', 'activity ${code}',
    case when d.requires_self_assessment then d.outcome_options->>0 end,
    case when d.requires_self_assessment then 'fixture self assessment' end,
    case when d.requires_self_assessment then (select coalesce(jsonb_agg(jsonb_build_object('criterionId', c.id, 'score', d.score_options->>1, 'comment', '')), '[]'::jsonb)
      from public.resident_template_criteria c where c.template_id = d.id and c.active) else '[]'::jsonb end)
    from public.resident_template_definitions d where d.template_code = '${code}'`);
  psql(`update public.resident_assessment_requests set submitted_at = '${submittedAt}' where id = '${rid}'`);
  return rid;
};
const cronWeb = () => psql(`insert into public.resident_notifications (recipient_id, request_id, notification_type, title, message)
  select request.staff_id, request.id, 'assessment_reminder', 'แบบประเมินรอเกิน 24 ชั่วโมง', definition.template_code || ' ยังรอการประเมิน'
  from public.resident_assessment_requests request join public.resident_template_definitions definition on definition.id = request.template_id
  where request.status = 'pending' and request.submitted_at <= now() - interval '24 hours'
  on conflict (request_id, recipient_id, notification_type) do nothing;`);
const web = (rid, type) => Number(psql(`select count(*) from public.resident_notifications where request_id = '${rid}' and notification_type = '${type}'`));
const delivery = (rid, type) => psql(`select coalesce((select status || '/' || attempt_count from public.resident_assessment_email_deliveries where request_id = '${rid}' and delivery_type = '${type}'), 'none')`);
const sinkTo = (code, reminder) => sink.filter((m) => m.subject.includes(code) && m.subject.startsWith('Reminder') === reminder).length;
const logRound = (label, rid, code) => console.log(`LOG ${label}: web=${web(rid, 'assessment_reminder')} delivery=${delivery(rid, 'reminder')} smtpAttemptsTotal=${smtpAttempts} sinkReminder(${code})=${sinkTo(code, true)}`);

// ================================================================ I03: release switch, cron + browser paths, runbook
const manual = (f) => psql(require_('fs').readFileSync(new URL(`../supabase/manual/${f}`, import.meta.url), 'utf8'));
const P0 = request('c1', 'b2', 'EPA-8', '2026-01-08 08:00:00+00');
at('2026-01-08 08:01:00+00');
let before0 = smtpAttempts;
// Before the DB cutover the candidate must fail closed on both routes.
psql('alter function public.rc_notif_worker_checkin(text) rename to rc_notif_worker_checkin_hidden');
let r0 = await deliverDue();
let rBrowser = await post({ action: 'deliver_initial', requestId: P0 }, { Authorization: `Bearer ${id('c1')}` });
psql('alter function public.rc_notif_worker_checkin_hidden(text) rename to rc_notif_worker_checkin');
ok([r0, rBrowser].every(x => x.status === 500 && x.body.workerVersion === 'rc-notif-v1-impl-v3' && /rc_notif_worker_checkin/.test(x.body.error))
  && smtpAttempts === before0, 'P0 pre-migration check-in unavailable: both candidate routes fail closed and identify the build');
r0 = await deliverDue();
ok(r0.status === 200 && r0.body.paused === true && r0.body.workerVersion === 'rc-notif-v1-impl-v3' && smtpAttempts === before0, 'P1 right after the migration e-mail is paused: deliver_due (cron path) does nothing');
r0 = await post({ action: 'deliver_initial', requestId: P0 }, { Authorization: `Bearer ${id('c1')}` });
ok(r0.status === 200 && r0.body.paused === true && r0.body.workerVersion === 'rc-notif-v1-impl-v3' && smtpAttempts === before0, 'P2 browser path (deliver_initial) does nothing while paused');
let legacy = ''; try { psql(`select public.claim_resident_assessment_email_delivery('${P0}', 'initial', 'b2@fixture.test')`, 'service_role'); } catch (e) { legacy = e.message; }
ok(/RC_NOTIF_LEGACY_CLAIM_RETIRED/.test(legacy), 'P3 an old worker using the legacy claim is refused');
manual('notif_v1_mail_worker_pause.sql');
ok(psql(`select (select active from cron.job where jobname = 'resident-assessment-email-delivery')::text || '/' || (select paused from public.resident_notification_mail_control)::text`) === 'false/true', 'P4 pause script: cron job inactive and mail paused');
psql(`insert into public.resident_assessment_email_deliveries (request_id, delivery_type, recipient_email, status, attempted_at) values ('${P0}', 'initial', 'b2@fixture.test', 'sending', now() - interval '20 minutes')`); // an old-Edge send left open
let refusal = ''; try { manual('notif_v1_mail_worker_resume.sql'); } catch (e) { refusal = e.message; }
ok(/RESUME REFUSED: pause and wait/.test(refusal), 'P4a a live check-in alone cannot shorten the drain window');
psql(`update public.resident_notification_mail_control set paused_at = clock_timestamp() - interval '11 minutes'`);
refusal = ''; try { manual('notif_v1_mail_worker_resume.sql'); } catch (e) { refusal = e.message; }
ok(/RESUME REFUSED: no check-in/.test(refusal), 'P5 resume refused: the v1 worker has not checked in since the pause');
await deliverDue();   // the v1 worker checks in (still paused, sends nothing)
refusal = ''; try { manual('notif_v1_mail_worker_resume.sql'); } catch (e) { refusal = e.message; }
ok(/RESUME REFUSED: open reservations/.test(refusal), 'P6 resume refused while an old reservation is still open (drain)');
const Pnew = request('c2', 'b2', 'EPA-8', '2026-01-08 08:00:00+00');
psql(`insert into public.resident_assessment_email_deliveries (request_id,delivery_type,recipient_email,status,attempted_at,reservation_v3)
      values ('${Pnew}','initial','b2@fixture.test','sending',now()-interval '20 minutes',true)`);
manual('notif_v1_mail_drain_abandoned.sql');
ok(delivery(P0, 'initial') === 'uncertain/0', 'P7 drain marks the abandoned old send uncertain (never re-sent)');
ok(delivery(Pnew, 'initial') === 'failed/0', 'P7a v3 reservation not yet authorized is released for retry');
manual('notif_v1_mail_worker_resume.sql');
ok(psql(`select (select active from cron.job where jobname = 'resident-assessment-email-delivery')::text || '/' || (select paused from public.resident_notification_mail_control)::text`) === 'true/false', 'P8 resume: cron job active, mail resumed');
// Still no user preference change: the released reservation can send once on resume.
at('2026-01-08 08:02:00+00'); await deliverDue();
ok(delivery(Pnew, 'initial') === 'sent/1' && delivery(P0, 'initial') === 'uncertain/0',
  'P9 released reservation sends once; legacy uncertain is never retried');
asUser('c2', `select public.cancel_resident_assessment_request('${Pnew}')`);
asUser('c1', `select public.cancel_resident_assessment_request('${P0}')`);   // keep the P0 probe out of the A/B scenarios

// ================================================================ Case A through the Edge worker
const A = request('c1', 'b1', 'EPA-1', '2026-01-09 09:05:00+00');           // due 2026-01-10 09:05
at('2026-01-09 09:06:00+00'); { const a0 = await deliverDue(); ok(a0.body.sent === 1 && delivery(A, 'initial') === 'sent/1', 'A0 Edge sends the initial e-mail the day before'); }
at('2026-01-10 09:01:00+00'); save('b1', { reminder_email: false });
at('2026-01-10 09:09:00+00'); save('b1', { reminder_email: true });
at('2026-01-10 09:15:00+00'); cronWeb();
let before = smtpAttempts; let r = await deliverDue(); logRound('A round 1 (09:15)', A, 'EPA-1');
ok(r.status === 200 && smtpAttempts === before, 'A1 Edge 09:15: zero SMTP attempts for the old reminder');
ok(web(A, 'assessment_reminder') === 1 && delivery(A, 'reminder') === 'suppressed/0', 'A2 one web reminder; e-mail terminal suppressed with 0 attempts');
at('2026-01-10 09:30:00+00'); cronWeb(); before = smtpAttempts; await deliverDue(); logRound('A round 2 (09:30)', A, 'EPA-1');
ok(smtpAttempts === before && web(A, 'assessment_reminder') === 1 && delivery(A, 'reminder') === 'suppressed/0', 'A3 next round: unchanged, no attempt');
const A2 = request('c2', 'b1', 'EPA-2', '2026-01-09 09:20:00+00');          // due 09:20, after re-enable
at('2026-01-10 09:45:00+00'); cronWeb(); await deliverDue();
ok(sinkTo('EPA-2', true) === 1 && delivery(A2, 'reminder') === 'sent/1', 'A4 a reminder that became due after re-enable is sent once');
at('2026-01-10 10:00:00+00'); await deliverDue();
ok(sinkTo('EPA-2', true) === 1 && sinkTo('EPA-1', true) === 0, 'A5 following round: no repeat');

// ================================================================ Case B through the Edge worker
const B = request('c1', 'b2', 'EPA-3', '2026-01-09 10:05:00+00');           // due 2026-01-10 10:05
at('2026-01-09 10:06:00+00'); await deliverDue();
at('2026-01-10 10:06:00+00'); cronWeb(); mailMode = 'fail_before'; before = smtpAttempts; r = await deliverDue(); mailMode = 'ok';
logRound('B attempt 1 (10:06, SMTP refused the connection)', B, 'EPA-3');
ok(smtpAttempts === before + 1 && delivery(B, 'reminder') === 'failed/1', 'B1 attempt 1 fails before SMTP accepted it → failed (retryable)');
at('2026-01-10 10:10:00+00'); save('b2', { reminder_email: false });
at('2026-01-10 10:20:00+00'); save('b2', { reminder_email: true });
at('2026-01-10 16:30:00+00'); cronWeb(); before = smtpAttempts; await deliverDue(); logRound('B retry round (16:30)', B, 'EPA-3');
ok(smtpAttempts === before && delivery(B, 'reminder') === 'suppressed/1' && sinkTo('EPA-3', true) === 0, 'B2 retry: no new attempt (count stays 1), terminal suppressed');
ok(web(B, 'assessment_reminder') === 1, 'B3 one web reminder');
at('2026-01-11 00:00:00+00'); cronWeb(); before = smtpAttempts; await deliverDue(); logRound('B next round', B, 'EPA-3');
ok(smtpAttempts === before && delivery(B, 'reminder') === 'suppressed/1', 'B4 next round: unchanged');
const B2 = request('c2', 'b2', 'EPA-4', '2026-01-10 10:25:00+00');
at('2026-01-11 10:30:00+00'); cronWeb(); await deliverDue();
ok(sinkTo('EPA-4', true) === 1 && delivery(B2, 'reminder') === 'sent/1', 'B5 a new reminder after re-enable is sent once');

// ================================================================ outcome classification, failures, initial path
const U = request('c1', 'b1', 'EPA-5', '2026-01-12 08:00:00+00');
at('2026-01-12 08:01:00+00'); mailMode = 'uncertain'; await deliverDue(); mailMode = 'ok';
ok(delivery(U, 'initial') === 'uncertain/1', 'U1 timeout after DATA → uncertain (terminal)');
at('2026-01-12 20:00:00+00'); before = smtpAttempts; await deliverDue();
ok(smtpAttempts === before && delivery(U, 'initial') === 'uncertain/1', 'U2 uncertain is never retried automatically');
// a decision that cannot be made → no SMTP attempt
const F = request('c2', 'b1', 'EPA-6', '2026-01-12 09:00:00+00');
psql(`alter function public.rc_notif_authorize_email_attempt(uuid) rename to rc_notif_authorize_email_attempt_x`);
at('2026-01-12 09:01:00+00'); before = smtpAttempts; r = await deliverDue();
psql(`alter function public.rc_notif_authorize_email_attempt_x(uuid) rename to rc_notif_authorize_email_attempt`);
ok(smtpAttempts === before && r.body.failures.length >= 1, 'F1 authorization unavailable → the Edge sends nothing (fails closed) and reports it');
// browser path (deliver_initial) by the request owner goes through the same permission
const I = request('c2', 'b2', 'EPA-7-L3', '2026-01-12 10:00:00+00');
at('2026-01-12 10:00:30+00'); save('b2', { request_email: false });
before = smtpAttempts;
r = await post({ action: 'deliver_initial', requestId: I }, { Authorization: `Bearer ${id('c2')}` });
ok(r.status === 200 && smtpAttempts === before && delivery(I, 'initial') === 'suppressed/0', 'I1 deliver_initial respects the setting (request e-mail off → no attempt)');
r = await post({ action: 'deliver_initial', requestId: I }, { Authorization: `Bearer ${id('c1')}` });
ok(r.status === 403, 'I2 deliver_initial by someone who is not the request owner is refused');
r = await post({ action: 'deliver_due' }, { 'x-reminder-secret': 'wrong' });
ok(r.status === 401, 'I3 deliver_due without the cron secret is refused');

// I02a: lose the finish response altogether, including a request no longer pending.
const priorLostCode = sinkTo('EPA-2', false);
const Lost = request('c1', 'b1', 'EPA-2', '2026-01-14 08:00:00+00');
at('2026-01-14 08:01:00+00');
const lostId = JSON.parse(psql(`select public.rc_notif_reserve_email('${Lost}', 'initial')`, 'service_role')).delivery_id;
const lost = JSON.parse(psql(`select public.rc_notif_authorize_email_attempt('${lostId}')`, 'service_role'));
ok(lost.allowed, 'Z1 authorized delivery with no reported outcome');
asUser('c1', `select public.cancel_resident_assessment_request('${Lost}')`);
at('2026-01-14 08:20:00+00'); await deliverDue();
ok(delivery(Lost, 'initial') === 'uncertain/1', 'Z2 cron reconciles the abandoned authorization even after cancellation');
const Next = request('c2', 'b1', 'EPA-3', '2026-01-14 09:00:00+00');
at('2026-01-14 09:01:00+00'); await deliverDue();
console.log(`LOG Z3: old=${delivery(Lost, 'initial')} new=${delivery(Next, 'initial')} oldCodeInitialSinkBefore=${priorLostCode} after=${sinkTo('EPA-2', false)}`);
ok(delivery(Next, 'initial') === 'sent/1' && delivery(Lost, 'initial') === 'uncertain/1'
   && sinkTo('EPA-2', false) === priorLostCode, 'Z3 following round serves new mail and never resends the abandoned attempt');

// N1-I02b: run the real Gmail fallback with fake OAuth and Gmail responses.
// Count provider calls per message, not just reservations in the database.
delete env.SMTP_HOST;
Object.assign(env, { GOOGLE_GMAIL_CLIENT_ID: 'fixture', GOOGLE_GMAIL_CLIENT_SECRET: 'fixture',
  GOOGLE_GMAIL_REFRESH_TOKEN: 'fixture', GOOGLE_GMAIL_FROM_EMAIL: 'sender@fixture.test' });
let tokenUnavailable = false;
const gmailCalls = new Map();
globalThis.fetch = async (url, init) => {
  assert.equal(init.method, 'POST');
  if (url === 'https://oauth2.googleapis.com/token') {
    if (tokenUnavailable) throw new TypeError('fixture OAuth network failure');
    return Response.json({ access_token: 'fixture-token' });
  }
  assert.equal(url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  assert.equal(init.headers.Authorization, 'Bearer fixture-token');
  const raw = Buffer.from(JSON.parse(init.body).raw, 'base64url').toString('utf8');
  const code = raw.match(/activity ([A-Z0-9-]+)<\/p>/)?.[1];
  assert.ok(code, 'Gmail message has a known synthetic activity');
  gmailCalls.set(code, (gmailCalls.get(code) || 0) + 1);
  if (code === 'PBA-07') return new Response('{"id":', { status: 200 });
  if (code === 'PBA-13') return Response.json({ threadId: 'fixture-thread' });
  return Response.json({ id: 'gmail-fixture-' + code });
};
const sentViaGmail = (code) => gmailCalls.get(code) || 0;
const browserSend = (rid) => post({ action: 'deliver_initial', requestId: rid }, { Authorization: `Bearer ${id('c1')}` });
const providerId = (rid) => psql(`select coalesce(provider_message_id,'') from public.resident_assessment_email_deliveries
  where request_id = '${rid}' and delivery_type = 'initial'`);
const broken = request('c1', 'b1', 'PBA-07', '2026-01-15 08:00:00+00');
at('2026-01-15 08:01:00+00'); await browserSend(broken);
ok(delivery(broken, 'initial') === 'uncertain/1' && sentViaGmail('PBA-07') === 1,
  'Gmail G1 HTTP 200 + truncated JSON: uncertain, one messages.send call');
const noId = request('c1', 'b1', 'PBA-13', '2026-01-15 08:02:00+00');
at('2026-01-15 08:03:00+00'); await browserSend(noId);
ok(delivery(noId, 'initial') === 'uncertain/1' && sentViaGmail('PBA-13') === 1,
  'Gmail G2 HTTP 200 + well-formed JSON without id: uncertain, one messages.send call');
const tokenFail = request('c1', 'b1', 'PBA-14', '2026-01-15 08:04:00+00');
at('2026-01-15 08:05:00+00'); tokenUnavailable = true; await browserSend(tokenFail); tokenUnavailable = false;
ok(delivery(tokenFail, 'initial') === 'failed/1' && sentViaGmail('PBA-14') === 0,
  'Gmail G3 OAuth fails before messages.send: failed and retryable, no provider send');
const fresh = request('c1', 'b1', 'PBA-15', '2026-01-15 14:10:00+00');
at('2026-01-15 14:11:00+00'); await deliverDue(); // beyond the six-hour retry window, all remain pending.
ok(delivery(broken, 'initial') === 'uncertain/1' && sentViaGmail('PBA-07') === 1,
  'Gmail G4 past the retry window: truncated JSON remains uncertain/1; one provider call');
ok(delivery(noId, 'initial') === 'uncertain/1' && sentViaGmail('PBA-13') === 1,
  'Gmail G5 past the retry window: no-id response remains uncertain/1; one provider call');
ok(delivery(tokenFail, 'initial') === 'sent/2' && sentViaGmail('PBA-14') === 1,
  'Gmail G6 pre-send OAuth failure retries successfully, with one actual provider send');
ok(delivery(fresh, 'initial') === 'sent/1' && sentViaGmail('PBA-15') === 1
   && providerId(fresh) === 'gmail-fixture-PBA-15',
  'Gmail G7 a new message sends once and its provider ID is persisted');

console.log(`ALL NOTIFICATION EDGE HARNESS TESTS PASSED (${checks} checks, ${smtpAttempts} SMTP attempts in the sink, ${sink.length} messages delivered)`);
