import test from 'node:test';import assert from 'node:assert/strict';import {qrDestination} from '../src/qrRouting.js';
const T='0b9d6c9e-1f2a-4c3b-8d4e-5f6a7b8c9d0e';
test('both QR scanners identify full attendance/evaluation links independently of their current page',()=>{
 for(const fallback of ['attendance','assessment'])for(const [route,kind] of [['attendance','attendance'],['evaluate','assessment']])for(const value of [`/${route}/${T}`,`https://resident-surgery-logbook.vercel.app/${route}/${T}/?a=1#fragment`])assert.deepEqual(qrDestination(value,fallback),{kind,token:T,path:`/${route}/${T}`});
});
test('legacy bare tokens retain context; routing never follows external hosts or trailing routes',()=>{
 assert.equal(qrDestination(T,'assessment').kind,'assessment');assert.equal(qrDestination(T,'attendance').kind,'attendance');
 assert.equal(qrDestination(`https://elsewhere.test/attendance/${T}`).path,`/attendance/${T}`);
 for(const input of ['',null,'javascript:alert(1)',`https://x.test/evaluate/${T}/extra`,`https://x.test/elsewhere?next=/attendance/${T}`,`https://user:pass@x.test/attendance/${T}`,`/attendance/not-a-uuid`,`data:text/html,/attendance/${T}`])assert.equal(qrDestination(input),null,String(input));
});
