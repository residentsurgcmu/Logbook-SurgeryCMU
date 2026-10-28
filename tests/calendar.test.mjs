import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarRange,bangkokInput,bangkokIso} from '../src/calendarRules.js';
test('calendar month boundaries use Bangkok, including December rollover',()=>{
 assert.deepEqual(calendarRange('2026-12'),{from:'2026-11-30T17:00:00.000Z',to:'2026-12-31T17:00:00.000Z'});
 assert.equal(calendarRange('2028-02').to,'2028-02-29T17:00:00.000Z');
 assert.throws(()=>calendarRange('2026-13'));
});
test('calendar time roundtrip rejects impossible or incomplete dates',()=>{
 assert.equal(bangkokInput(bangkokIso('2026-10-28T09:00')),'2026-10-28T09:00');
 assert.equal(bangkokIso('2026-10-28T09:00'),'2026-10-28T02:00:00.000Z');
 assert.throws(()=>bangkokIso('2026-02-30T10:00'));assert.throws(()=>bangkokIso('2026-10-28'));
});
